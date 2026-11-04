import { Pool } from "pg";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { createProjectAccess } from "../modules/tasks/tasks.projectAccess";

installPgTypeParsers();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1);
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-test-role") || "employee";
        req.userOrgId = 1;
        req.userTeamId = req.get("x-test-team") ? Number(req.get("x-test-team")) : null;
        next();
    },
    requireRole: (required: string) => (req: any, res: any, next: any) => {
        const levels: Record<string, number> = {
            employee: 1, team_lead: 2, manager: 3, hr_admin: 4, super_admin: 5, platform_admin: 6,
        };
        if ((levels[req.userRole] ?? 1) < (levels[required] ?? 1)) {
            return res.status(403).json({ error: "Insufficient role" });
        }
        next();
    },
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
jest.mock("../routes/tasks/_helpers/enrich", () => ({ enrichTasks: async (tasks: any[]) => tasks }));

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe("project access and member routes (PostgreSQL)", () => {
    const request = require("supertest");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    let db: any;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_access");
        pool = new Pool({ connectionString: database.url, max: 3 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        const migrations = await require("../platform/db/migrations").runTenantMigrations(query, { label: "project_access" });
        expect(migrations.failed).toEqual([]);

        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenant = { id: 1, plan: "enterprise", features: { agile: true } };
            req.tenantId = 1;
            req.db = db;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/projects", require("../routes/projects"));
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE project_members, projects, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Projects', 'projects')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Beta')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id, role) VALUES
            (1, 'lead', 'x', 'Lead', 1, 1, 'team_lead'),
            (2, 'member', 'x', 'Member', 1, 1, 'employee'),
            (3, 'other', 'x', 'Other', 1, 2, 'employee')`);
    });

    test("team leads create projects with their own admin grant and independent team grants", async () => {
        const denied = await request(app)
            .post("/api/projects")
            .set("x-test-user", "2")
            .set("x-test-role", "employee")
            .send({ key: "LOW", name: "Not allowed" });
        expect(denied.status).toBe(403);

        const created = await request(app)
            .post("/api/projects")
            .set("x-test-role", "team_lead")
            .send({ key: "ALPHA", name: "Alpha Stream", team_ids: [1, 2] });
        expect(created.status).toBe(200);
        expect(created.body.capabilities).toEqual({ canAdminister: true, canManageMembers: true });

        const grants = (await pool.query(
            "SELECT user_id, team_id, role FROM project_members WHERE project_id = $1 ORDER BY user_id NULLS LAST, team_id",
            [created.body.id],
        )).rows;
        expect(grants).toEqual([
            expect.objectContaining({ user_id: 1, role: "project_admin" }),
            expect.objectContaining({ team_id: 1, role: "member" }),
            expect.objectContaining({ team_id: 2, role: "member" }),
        ]);
        const listed = await request(app)
            .get("/api/projects")
            .set("x-test-role", "team_lead")
            .set("x-test-team", "1");
        expect(listed.status).toBe(200);
        expect(listed.body.find((project: any) => project.id === created.body.id).capabilities)
            .toEqual({ canAdminister: true, canManageMembers: true });

        const second = await request(app)
            .post("/api/projects")
            .set("x-test-role", "team_lead")
            .send({ key: "BETA", name: "Beta Stream", team_ids: [1] });
        expect(second.status).toBe(200);
        expect((await pool.query(
            "SELECT COUNT(*)::int AS count FROM project_members WHERE team_id = 1 AND role = 'member'",
        )).rows[0].count).toBe(2);
    });

    test("personal and several team grants resolve to the highest role across projects", async () => {
        await pool.query(`INSERT INTO projects (id, org_id, key, name) VALUES
            (10, 1, 'ONE', 'One'), (11, 1, 'TWO', 'Two')`);
        await pool.query(`INSERT INTO project_members (project_id, user_id, role) VALUES (10, 2, 'viewer')`);
        await pool.query(`INSERT INTO project_members (project_id, team_id, role) VALUES
            (10, 1, 'member'), (10, 2, 'project_admin'), (11, 2, 'viewer')`);

        const access = createProjectAccess(db, {
            userId: 2, orgId: 1, orgRole: "employee", teamIds: [1, 2],
        });
        expect(await access.roleForProject(10)).toBe("project_admin");
        expect(await access.roleForProject(11)).toBe("viewer");
        expect(await access.accessibleProjectIds()).toEqual(expect.arrayContaining([10, 11]));
        expect(await access.capabilities(10)).toEqual({ canAdminister: true, canManageMembers: true });
        expect(await access.capabilitiesForProjects([10, 11])).toEqual(new Map([
            [10, { canAdminister: true, canManageMembers: true }],
            [11, { canAdminister: false, canManageMembers: false }],
        ]));
    });

    test("organization admins can administer projects without a project grant", async () => {
        await pool.query(`INSERT INTO projects (id, org_id, key, name) VALUES
            (10, 1, 'ONE', 'One'), (11, 1, 'TWO', 'Two')`);
        const access = createProjectAccess(db, { userId: 3, orgId: 1, orgRole: "hr_admin" });
        expect(await access.roleForProject(10)).toBe("project_admin");
        expect(await access.accessibleProjectIds()).toEqual(expect.arrayContaining([10, 11]));

        const granted = await request(app)
            .post("/api/projects/10/members")
            .set("x-test-user", "3")
            .set("x-test-role", "hr_admin")
            .send({ subject_type: "team", subject_id: 2, role: "member" });
        expect(granted.status).toBe(200);
    });

    test("project admins can grant, change and remove access but cannot remove or downgrade the last admin", async () => {
        await pool.query("INSERT INTO projects (id, org_id, key, name) VALUES (10, 1, 'ONE', 'One')");
        await pool.query(
            "INSERT INTO project_members (project_id, user_id, role, granted_by) VALUES (10, 1, 'project_admin', 1)",
        );

        const grant = (subjectId: number, role: string) => request(app)
            .post("/api/projects/10/members")
            .set("x-test-user", "1")
            .set("x-test-role", "employee")
            .send({ subject_type: "user", subject_id: subjectId, role });
        const member = await grant(2, "member");
        expect(member.status).toBe(200);
        const upgraded = await grant(2, "project_admin");
        expect(upgraded.status).toBe(200);
        expect(upgraded.body.id).toBe(member.body.id);

        const listed = await request(app)
            .get("/api/projects/10/members")
            .set("x-test-user", "1");
        expect(listed.status).toBe(200);
        expect(listed.body).toEqual(expect.arrayContaining([
            expect.objectContaining({ user_id: 1, role: "project_admin", user_name: "Lead" }),
            expect.objectContaining({ user_id: 2, role: "project_admin", user_name: "Member" }),
        ]));

        const changed = await request(app)
            .put(`/api/projects/10/members/${member.body.id}`)
            .set("x-test-user", "1")
            .send({ role: "viewer" });
        expect(changed.status).toBe(200);
        const removed = await request(app)
            .delete(`/api/projects/10/members/${member.body.id}`)
            .set("x-test-user", "1");
        expect(removed.status).toBe(200);

        const denied = await request(app)
            .post("/api/projects/10/members")
            .set("x-test-user", "2")
            .send({ subject_type: "team", subject_id: 2, role: "member" });
        expect(denied.status).toBe(403);

        const downgrade = await request(app)
            .put("/api/projects/10/members/1")
            .set("x-test-user", "1")
            .send({ role: "viewer" });
        expect(downgrade.status).toBe(409);
        expect(downgrade.body.code).toBe("LAST_PROJECT_ADMIN");
        const deleteLastAdmin = await request(app)
            .delete("/api/projects/10/members/1")
            .set("x-test-user", "1");
        expect(deleteLastAdmin.status).toBe(409);
        expect(deleteLastAdmin.body.code).toBe("LAST_PROJECT_ADMIN");
    });
});
