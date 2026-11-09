import { Pool } from "pg";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { createProjectAccess } from "../modules/tasks/tasks.projectAccess";
import * as workflow from "../modules/tasks/tasks.projectWorkflowRepository";

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
        app.use("/api/projects", require("../routes/projectWorkflow"));
        app.use("/api/agile", require("../routes/agile"));
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
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
    });

    test("workflow repository reads and mutations ignore project and state ids from another org", async () => {
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Other', 'other')");
        const created = await request(app).post("/api/projects")
            .set("x-test-role", "team_lead").send({ key: "SCOPED", name: "Scoped" });
        expect(created.status).toBe(200);
        const projectId = Number(created.body.id);
        const states = await workflow.listProjectWorkflowStates(db, 1, projectId);
        const initial = states.find((state) => state.is_initial)!;
        const graph = await require("../modules/tasks/tasks.workflow").loadLifecycleContext(db, 1, projectId);
        await pool.query(`INSERT INTO tasks (title, user_id, org_id, project_id, workflow_state_id)
            VALUES ('Scoped ticket', 1, 1, $1, $2)`, [projectId, initial.id]);

        expect(await workflow.findProjectWorkflowState(db, 2, projectId, initial.id)).toBeNull();
        expect(await workflow.listActiveProjectWorkflowStates(db, 2, projectId)).toEqual([]);
        expect(await workflow.missingProjectWorkflowCategories(db, 2, projectId))
            .toEqual(["open", "in_progress", "in_review", "done"]);
        expect(await workflow.countTasksInWorkflowState(db, 2, initial.id)).toBe(0);
        expect(await workflow.countTasksInWorkflowState(db, 1, initial.id)).toBe(1);

        await workflow.updateProjectWorkflowState(db, 2, projectId, initial.id, { name: "Foreign edit" });
        await workflow.reorderProjectWorkflowStates(db, 2, projectId, states.map((state) => state.id).reverse());
        await workflow.setOtherProjectWorkflowStatesNonInitial(db, 2, projectId, -1);
        await workflow.replaceProjectWorkflowTransitions(db, 2, projectId, []);
        await workflow.deleteProjectWorkflowState(db, 2, projectId, initial.id);

        expect(await workflow.listProjectWorkflowStates(db, 1, projectId)).toEqual(states);
        expect(await require("../modules/tasks/tasks.workflow").loadLifecycleContext(db, 1, projectId)).toEqual(graph);
    });

    test("project workflows are isolated and org workflow writes are read-only", async () => {
        const create = (key: string) => request(app)
            .post("/api/projects")
            .set("x-test-role", "team_lead")
            .send({ key, name: key });
        const first = await create("FLOWA");
        const second = await create("FLOWB");
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);

        const createdState = await request(app)
            .post(`/api/projects/${first.body.id}/workflow-states`)
            .set("x-test-role", "team_lead")
            .send({ key: "blocked", name: "Blocked", category: "in_progress" });
        expect(createdState.status).toBe(201);
        const firstWorkflow = await request(app)
            .get(`/api/projects/${first.body.id}/workflow-states`)
            .set("x-test-role", "team_lead");
        const secondWorkflow = await request(app)
            .get(`/api/projects/${second.body.id}/workflow-states`)
            .set("x-test-role", "team_lead");
        expect(firstWorkflow.body.workflowStates.map((state: any) => state.key)).toContain("blocked");
        expect(secondWorkflow.body.workflowStates.map((state: any) => state.key)).not.toContain("blocked");
        expect(firstWorkflow.body.canEditWorkflow).toBe(true);

        const firstPending = firstWorkflow.body.workflowStates.find((state: any) => state.key === "pending");
        const secondPending = secondWorkflow.body.workflowStates.find((state: any) => state.key === "pending");
        const secondInProgress = secondWorkflow.body.workflowStates.find((state: any) => state.key === "in_progress");
        const saved = await request(app)
            .put(`/api/projects/${first.body.id}/workflow-transitions`)
            .set("x-test-role", "team_lead")
            .send({ transitions: [{ from_state_id: firstPending.id, to_state_id: createdState.body.id }] });
        expect(saved.status).toBe(200);

        const { loadLifecycleContext, allowsTransition } = require("../modules/tasks/tasks.workflow");
        const firstGraph = await loadLifecycleContext(pool, 1, first.body.id);
        const secondGraph = await loadLifecycleContext(pool, 1, second.body.id);
        expect(allowsTransition(firstGraph, firstPending.id, firstWorkflow.body.workflowStates.find((state: any) => state.key === "in_progress").id)).toBe(false);
        expect(allowsTransition(secondGraph, secondPending.id, secondInProgress.id)).toBe(true);

        const orgRead = await request(app)
            .get(`/api/agile/workflow-states?project_id=${first.body.id}`)
            .set("x-test-role", "team_lead");
        expect(orgRead.status).toBe(200);
        expect(orgRead.body.map((state: any) => state.key)).toContain("blocked");
        const defaultOrgRead = await request(app)
            .get("/api/agile/workflow-states")
            .set("x-test-role", "team_lead");
        expect(defaultOrgRead.status).toBe(200);
        const generalProjectId = Number((await pool.query(
            "SELECT id FROM projects WHERE org_id = 1 AND is_general = TRUE",
        )).rows[0].id);
        const generalStateIds = (await pool.query(
            "SELECT id FROM workflow_states WHERE project_id = $1 ORDER BY sort_order, id",
            [generalProjectId],
        )).rows.map((state) => Number(state.id));
        expect(defaultOrgRead.body.map((state: any) => state.id)).toEqual(generalStateIds);
        const invalidOrgRead = await request(app)
            .get("/api/agile/workflow-states?project_id=not-a-project")
            .set("x-test-role", "team_lead");
        expect(invalidOrgRead.status).toBe(400);
        const orgWrite = await request(app)
            .post("/api/agile/workflow-states")
            .set("x-test-role", "team_lead")
            .send({ name: "Forbidden", category: "open" });
        expect(orgWrite.status).toBe(405);
    });

    test("ticket07 project admins archive, only org admins unarchive, and deleted keys stay reserved", async () => {
        const created = await request(app).post("/api/projects").set("x-test-role", "team_lead")
            .send({ key: "ARC", name: "Archive" });
        const id = created.body.id;
        const archived = await request(app).patch(`/api/projects/${id}/archive`).send({ is_archived: true });
        expect(archived.status).toBe(200);
        expect(archived.body.capabilities.canCreateTickets).toBe(false);
        expect((await request(app).patch(`/api/projects/${id}/archive`).send({ is_archived: false })).status).toBe(403);
        expect((await request(app).patch(`/api/projects/${id}/archive`).set("x-test-role", "hr_admin")
            .send({ is_archived: false })).status).toBe(200);
        expect((await request(app).delete(`/api/projects/${id}`).set("x-test-role", "super_admin")).status).toBe(200);
        expect((await request(app).post("/api/projects").set("x-test-role", "team_lead")
            .send({ key: "ARC", name: "Reused" })).status).toBe(409);
    });

    test("ticket07 force cannot delete a project that has ever had tickets, even after they leave", async () => {
        const created = await request(app).post("/api/projects").set("x-test-role", "team_lead")
            .send({ key: "USED", name: "Used" });
        await pool.query("INSERT INTO tasks (title, user_id, org_id, project_id) VALUES ('History', 1, 1, $1)", [created.body.id]);
        const result = await request(app).delete(`/api/projects/${created.body.id}?force=1`).set("x-test-role", "super_admin");
        expect(result.status).toBe(409);
        await pool.query("DELETE FROM tasks WHERE project_id = $1", [created.body.id]);
        expect((await request(app).delete(`/api/projects/${created.body.id}`).set("x-test-role", "super_admin")).status).toBe(409);
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
        expect(created.body.capabilities).toEqual({ canAdminister: true, canManageMembers: true, canRenameKey: true, canCreateTickets: true, canEditWorkflow: true, canArchive: true, canChangeType: true });

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
            .toEqual({ canAdminister: true, canManageMembers: true, canRenameKey: true, canCreateTickets: true, canEditWorkflow: true, canArchive: true, canChangeType: true });

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
        expect(await access.capabilities(10)).toEqual({ canAdminister: true, canManageMembers: true, canRenameKey: true, canCreateTickets: true, canEditWorkflow: true, canArchive: true, canChangeType: true });
        expect(await access.capabilitiesForProjects([10, 11])).toEqual(new Map([
            [10, { canAdminister: true, canManageMembers: true, canRenameKey: true, canCreateTickets: true, canEditWorkflow: true, canArchive: true, canChangeType: true }],
            [11, { canAdminister: false, canManageMembers: false, canRenameKey: false, canCreateTickets: false, canEditWorkflow: false, canArchive: false, canChangeType: false }],
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
