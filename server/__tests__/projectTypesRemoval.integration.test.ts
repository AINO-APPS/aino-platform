import { Pool } from "pg";
import express from "express";
import request from "supertest";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { createProjectTypesRemoval } from "../modules/projectTypesRemoval/projectTypesRemoval";
import { runProjectTypesContraction } from "../modules/projectTypesRemoval/projectTypesRemoval.migrate";
import { verifyProjectOwnership } from "../platform/projectTypesRemoval";

jest.unmock("../modules/projectTypesRemoval/projectTypesRemoval");

jest.setTimeout(120_000);
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => { req.userId = 1; next(); });
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userOrgId = 1; req.userTeamId = 1; req.userRole = req.get("x-test-role") || "super_admin"; next();
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

    test("an unswitched organization blocks guarded requests with 503", async () => {
        const refused = await request(app).get("/api/tasks/scheduled");
        expect(refused.status).toBe(503);
        expect(refused.body.code).toBe("PROJECT_TYPES_REMOVAL_NOT_READY");
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

    test("published timestamp is not proof after a switch-back, and retired routes stay absent", async () => {
        await pool.query("UPDATE organizations SET project_ownership_switched_at = NOW() WHERE id = 2");
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(503);
        await pool.query("UPDATE organizations SET project_ownership = TRUE WHERE id = 2");
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(404);
        await pool.query("UPDATE organizations SET project_ownership = FALSE WHERE id = 2");
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(503);
        env = {};
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(503);
    });

    test("step-D contraction removes compatibility while retaining project-owned tickets and sprints", async () => {
        await pool.query("UPDATE organizations SET project_ownership = TRUE, project_ownership_switched_at = NOW()");
        const sprint = await request(app).post("/api/sprints").send({
            project_id: 10, name: "Retained sprint", start_date: "2026-11-12", end_date: "2026-11-25",
        });
        expect(sprint.status).toBe(200);
        const created = await request(app).post("/api/tasks/backlog").send({
            project_id: 10, title: "Retained ticket", start_date: "2026-11-12",
            due_date: "2026-11-20", sprint_id: sprint.body.sprint.id,
        });
        expect(created.status).toBe(200);

        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        const client = await pool.connect();
        const contracted = await runProjectTypesContraction({
            env: () => env,
            verifyOwnership: () => verifyProjectOwnership(query),
            tenantQueries: [{
                name: "project_types_removal",
                transaction: async (run) => {
                    try {
                        await client.query("BEGIN");
                        const result = await run((sql, params = []) => client.query(sql, params as any[]));
                        await client.query("COMMIT");
                        return result;
                    } catch (error) {
                        await client.query("ROLLBACK");
                        throw error;
                    } finally {
                        client.release();
                    }
                },
            }],
        });
        expect(contracted).toEqual(["project_types_removal"]);

        const detail = await request(app).get(`/api/tasks/${created.body.id}/detail`);
        expect(detail.status).toBe(200);
        expect(detail.body).toMatchObject({
            ticket_key: "TEST-1", project_id: 10, sprint_id: sprint.body.sprint.id, due_date: "2026-11-20",
        });
        for (const field of ["team_id", "issue_key", "planned_date", "pre_sprint_due_date", "logged_minutes", "estimated_minutes"]) {
            expect(detail.body).not.toHaveProperty(field);
        }

        const taskRow = await pool.query(
            "SELECT id, project_id, sprint_id, ticket_key, title FROM tasks WHERE id = $1", [created.body.id],
        );
        expect(taskRow.rows).toEqual([{
            id: created.body.id, project_id: 10, sprint_id: sprint.body.sprint.id,
            ticket_key: "TEST-1", title: "Retained ticket",
        }]);
        const sprintRow = await pool.query(
            "SELECT id, project_id, name FROM sprints WHERE id = $1", [sprint.body.sprint.id],
        );
        expect(sprintRow.rows).toEqual([{
            id: sprint.body.sprint.id, project_id: 10, name: "Retained sprint",
        }]);

        const after = await request(app).post("/api/tasks/backlog").send({
            project_id: 10, title: "Created after contraction", start_date: "2026-11-13",
        });
        expect(after.status).toBe(200);
        expect(after.body).toMatchObject({ ticket_key: "TEST-2", project_id: 10, start_date: "2026-11-13" });
        const edited = await request(app).put(`/api/tasks/${created.body.id}`).send({
            title: "Edited after contraction", due_date: "2026-11-21",
        });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({
            ticket_key: "TEST-1", sprint_id: sprint.body.sprint.id, due_date: "2026-11-21",
        });
        const nextSprint = await request(app).post("/api/sprints").send({
            project_id: 10, name: "Created after contraction", start_date: "2026-11-26", end_date: "2026-12-09",
        });
        expect(nextSprint.status).toBe(200);
        expect(nextSprint.body.sprint).toMatchObject({ project_id: 10, name: "Created after contraction" });
        for (const [table, reason] of [
            ["task_hierarchy_repairs", "Invalid parent detached"],
            ["task_hierarchy_repair_corrections", "Eligible leaf recovered"],
        ]) {
            await pool.query(`INSERT INTO ${table} (task_id, org_id, reason, before_value, after_value)
                VALUES ($1, 1, $2, '{"parent_task_id":123}', '{"parent_task_id":null}'),
                       (999, 2, 'Other organization', '{}', '{}')`, [created.body.id, reason]);
        }
        const repairs = await request(app).get("/api/projects/hierarchy-repairs");
        expect(repairs.status).toBe(200);
        expect(repairs.body.hierarchy_repairs).toEqual([
            expect.objectContaining({ task_id: created.body.id, ticket_key: "TEST-1", stage: "original", reason: "Invalid parent detached" }),
            expect.objectContaining({ task_id: created.body.id, ticket_key: "TEST-1", stage: "correction", reason: "Eligible leaf recovered" }),
        ]);
        expect((await request(app).get("/api/projects/hierarchy-repairs").set("x-test-role", "employee")).status).toBe(403);
        expect((await request(app).get("/api/tasks/scheduled")).status).toBe(404);
        expect((await request(app).get(`/api/tasks/${created.body.id}/timer`)).status).toBe(404);
    });
});
