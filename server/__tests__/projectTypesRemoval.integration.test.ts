import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { createProjectTypesRemoval } from "../modules/projectTypesRemoval/projectTypesRemoval";
import { verifyProjectOwnership } from "../modules/projectTypesRemoval/projectTypesRemoval.repository";

jest.setTimeout(120_000);
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => { req.userId = 1; next(); });
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userOrgId = 1; req.userTeamId = 1; req.userRole = "super_admin"; req.projectOwnership = true; next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    ROLE_LEVEL: { employee: 1, team_lead: 2, hr_admin: 4, super_admin: 5, platform_admin: 6 },
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn(), broadcast: jest.fn(), sendToUser: jest.fn() }));

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("guarded removal and retained data (real PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: express.Express;
    let env: NodeJS.ProcessEnv;
    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_types_removal");
        pool = new Pool({ connectionString: database.url, max: 3 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        app = express();
        app.use(express.json());
        app.use(createProjectTypesRemoval({ env: () => env, verifyOwnership: () => verifyProjectOwnership(query) }));
        app.use((req: any, _res, next) => {
            req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
            req.tenantId = 1; req.tenant = { id: 1, features: { agile: true, team_visibility: true } };
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; next();
        });
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/sprints", require("../routes/sprints"));
        app.use("/api/projects", require("../routes/projects"));
    });
    beforeEach(async () => {
        env = { PROJECT_TYPES_REMOVAL: "api", CLIENT_VERSION_MODE: "enforce",
            CLIENT_VERSION_MIN_ANDROID: "0.27.18", CLIENT_VERSION_MIN_DESKTOP: "3.0.80", CLIENT_VERSION_MIN_WEB: "3.0.80" };
        await pool.query("TRUNCATE tasks, sprints, projects, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug, project_ownership, project_ownership_switched_at) VALUES (1, 'Test', 'test', TRUE, NOW()), (2, 'Other', 'other', FALSE, NULL)");
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Team')");
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id, team_id, role) VALUES (1, 'tester', 'x', 'Tester', 1, 1, 'super_admin')");
        await pool.query("INSERT INTO projects (id, org_id, key, name, type, key_published) VALUES (10, 1, 'TEST', 'Test project', 'scrum', TRUE)");
    });
    afterAll(async () => { await pool?.end(); await database?.drop(); });

    test("one unswitched organization refuses globally; normal migrations and EXPAND routes preserve legacy storage", async () => {
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(503);
        env = {};
        const created = await request(app).post("/api/tasks/backlog").send({ project_id: 10, title: "Keep", start_date: "2026-11-12" });
        expect(created.status).toBe(200);
        expect(created.body).toMatchObject({ planned_date: "2026-11-12", issue_key: "TEST-1", team_id: 1 });
        expect((await request(app).get("/api/tasks/scheduled")).body.tasks.map((t: any) => t.id)).toContain(created.body.id);
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).applied).toEqual([]);
        expect((await request(app).get(`/api/tasks/${created.body.id}/detail`)).body).toMatchObject({ ticket_key: "TEST-1", start_date: "2026-11-12" });
        const storage = await pool.query("SELECT team_id, planned_date, pre_sprint_due_date, logged_minutes FROM tasks WHERE id = $1", [created.body.id]);
        expect(storage.rows).toHaveLength(1);
    });

    test("after every organization is verified, real ticket/sprint reads and writes keep data while legacy routes return 404", async () => {
        await pool.query("UPDATE organizations SET project_ownership = TRUE, project_ownership_switched_at = NOW() WHERE id = 2");
        const sprint = await request(app).post("/api/sprints").send({ project_id: 10, name: "Sprint", start_date: "2026-11-12", end_date: "2026-11-25" });
        expect(sprint.status).toBe(200);
        expect(sprint.body.sprint).not.toHaveProperty("team_id");
        const created = await request(app).post("/api/tasks/backlog").send({ project_id: 10, title: "Retained", start_date: "2026-11-12", due_date: "2026-11-20", sprint_id: sprint.body.sprint.id });
        expect(created.status).toBe(200);
        expect(created.body).toMatchObject({ ticket_key: "TEST-1", start_date: "2026-11-12", due_date: "2026-11-20", sprint_id: sprint.body.sprint.id });
        for (const field of ["team_id", "issue_key", "planned_date", "logged_minutes", "estimated_minutes", "pre_sprint_due_date"]) expect(created.body).not.toHaveProperty(field);
        expect((await request(app).get(`/api/tasks/${created.body.id}/detail`)).body).toMatchObject({ ticket_key: "TEST-1", project_id: 10, due_date: "2026-11-20" });
        expect((await request(app).get("/api/sprints?project_id=10")).body.sprints[0]).not.toHaveProperty("team_id");
        for (const path of ["/api/tasks/scheduled", `/api/tasks/${created.body.id}/timer`]) expect((await request(app).get(path)).status).toBe(404);
        const edited = await request(app).put(`/api/tasks/${created.body.id}`).send({ title: "Edited", start_date: "2026-11-13" });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({ title: "Edited", start_date: "2026-11-13", due_date: "2026-11-20" });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        for (let repeat = 0; repeat < 2; repeat++) expect((await require("../platform/db/migrations").runTenantMigrations(query)).applied).toEqual([]);
        expect((await request(app).get(`/api/tasks/${created.body.id}/detail`)).body).toMatchObject({ title: "Edited", ticket_key: "TEST-1", sprint_id: sprint.body.sprint.id });
    });

    test("published timestamp is not proof after a switch-back, and inventory errors never retire routes", async () => {
        await pool.query("UPDATE organizations SET project_ownership_switched_at = NOW() WHERE id = 2");
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(503);
        await pool.query("UPDATE organizations SET project_ownership = TRUE WHERE id = 2");
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(404);
        await pool.query("UPDATE organizations SET project_ownership = FALSE WHERE id = 2");
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(503);
        env = {};
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(200);
    });
});
