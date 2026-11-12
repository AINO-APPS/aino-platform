import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
jest.setTimeout(120_000);
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1); next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: async (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-test-role") || "super_admin";
        req.userOrgId = Number(req.get("x-test-org") || 1);
        req.userTeamId = 10;
        req.userTeamIds = [10];
        req.projectOwnership = (await req.db.query(
            "SELECT project_ownership FROM organizations WHERE id = $1", [req.userOrgId],
        )).rows[0]?.project_ownership === true;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ broadcast: jest.fn() }));
jest.mock("../routes/tasks/_helpers/enrich", () => ({ enrichTasks: async (tasks: any[]) => tasks }));

const postgresDescribe = process.env.TASKS_SCHEMA_TEST_DATABASE_URL ? describe : describe.skip;
postgresDescribe("migration review and switch-over HTTP (PostgreSQL)", () => {
    const request = require("supertest");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    beforeAll(async () => {
        database = await createTestDatabase(process.env.TASKS_SCHEMA_TEST_DATABASE_URL!, "migration_review");
        pool = new Pool({ connectionString: database.url, max: 6 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenantId = 1;
            req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
            req.log = { error: jest.fn() };
            next();
        });
        app.use("/api/projects", require("../routes/projects"));
        app.use("/api/tasks", require("../routes/tasks/byKey"));
    });
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        await pool.query("TRUNCATE task_hierarchy_repairs, task_hierarchy_repair_corrections");
        await pool.query("TRUNCATE organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Org', 'org'), (2, 'Other', 'other')");
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id) VALUES (1, 'admin', 'x', 'Admin', 1)");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (10, 1, 'Engineering')");
        await pool.query(`INSERT INTO projects (id, org_id, key, name, origin_team_id, key_published, type)
            VALUES (10, 1, 'ENG', 'Engineering', 10, FALSE, 'scrum')`);
        await pool.query("INSERT INTO project_members (project_id, team_id, role) VALUES (10, 10, 'member')");
        await pool.query(`INSERT INTO tasks (id, user_id, org_id, project_id, task_number, ticket_key, title)
            VALUES (100, 1, 1, 10, 1, 'ENG-1', 'Migrated')`);
        await pool.query(`INSERT INTO project_migration_moves (task_id, to_project_id, old_key, new_key)
            VALUES (100, 10, 'OLD-1', 'ENG-1')`);
    });
    test("review returns generated projects, grants, counts and migration moves, scoped to the org", async () => {
        const response = await request(app).get("/api/projects/migration/review");
        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
            project_ownership: false, switched_at: null,
            projects: expect.arrayContaining([expect.objectContaining({
                id: 10, key: "ENG", key_published: false, type: "scrum", ticket_count: 1,
                grants: [expect.objectContaining({ team_id: 10, role: "member", name: "Engineering" })],
            })]),
            moves: [expect.objectContaining({ task_id: 100, old_key: "OLD-1", new_key: "ENG-1", sprint_id: null })],
        });
        const other = await request(app).get("/api/projects/migration/review").set("x-test-org", "2");
        expect(other.body.projects.some((project: any) => project.id === 10)).toBe(false);
        expect(other.body.moves).toEqual([]);
    });
    test("super-admin review exposes immutable hierarchy repairs and corrections, including deleted work, only in its organization", async () => {
        await pool.query(`INSERT INTO task_hierarchy_repairs (task_id, org_id, reason, before_value, after_value) VALUES
            (100, 1, 'Cleared legacy parent', '{"parent_task_id":42,"work_item_type_id":3,"project_id":10,"sprint_id":null}',
                '{"parent_task_id":null,"work_item_type_id":3,"project_id":10,"sprint_id":null}'),
            (999, 1, 'Deleted ticket repair', '{"parent_task_id":42}', '{"parent_task_id":null}'),
            (200, 2, 'Other organization secret', '{}', '{}')`);
        await pool.query(`INSERT INTO task_hierarchy_repair_corrections (task_id, org_id, reason, before_value, after_value) VALUES
            (100, 1, 'Recovered as Subtask', '{"parent_task_id":null,"work_item_type_id":3,"sprint_id":null}',
                '{"parent_task_id":42,"work_item_type_id":9,"sprint_id":7}')`);
        const review = await request(app).get("/api/projects/migration/review").expect(200);
        expect(review.body.hierarchy_repairs).toEqual([
            expect.objectContaining({ task_id: 100, ticket_key: "ENG-1", stage: "original", reason: "Cleared legacy parent",
                before: expect.objectContaining({ parent_task_id: 42 }), after: expect.objectContaining({ parent_task_id: null }) }),
            expect.objectContaining({ task_id: 999, ticket_key: null, stage: "original", reason: "Deleted ticket repair" }),
            expect.objectContaining({ task_id: 100, stage: "correction", reason: "Recovered as Subtask",
                after: expect.objectContaining({ parent_task_id: 42, work_item_type_id: 9, sprint_id: 7 }) }),
        ]);
        await request(app).post("/api/projects/10/key").send({ key: "NEW" }).expect(200);
        const renamed = await request(app).get("/api/projects/migration/review").expect(200);
        expect(renamed.body.hierarchy_repairs[0]).toMatchObject({
            ticket_key: "NEW-1", before: { parent_task_id: 42 }, after: { parent_task_id: null },
        });
        const other = await request(app).get("/api/projects/migration/review").set("x-test-org", "2").expect(200);
        expect(other.body.hierarchy_repairs).toEqual([expect.objectContaining({ task_id: 200 })]);
        for (const role of ["employee", "team_lead", "manager", "hr_admin"]) {
            await request(app).get("/api/projects/migration/review").set("x-test-role", role).expect(403);
        }
    });
    test("switch publishes all keys atomically, is audited and remains one-time after emergency rollback", async () => {
        expect((await request(app).post("/api/projects/10/key").send({ key: "PRE" })).status).toBe(200);
        expect((await pool.query("SELECT * FROM ticket_key_aliases")).rows).toEqual([]);
        const reviewed = await request(app).get("/api/projects/migration/review");
        expect(reviewed.body.moves[0]).toMatchObject({ old_key: "OLD-1", new_key: "PRE-1", migration_key: "ENG-1" });
        const responses = await Promise.all([
            request(app).post("/api/projects/migration/switch"),
            request(app).post("/api/projects/migration/switch"),
        ]);
        expect(responses.map((response: any) => response.status).sort()).toEqual([200, 409]);
        const active = await request(app).get("/api/projects/migration/review");
        expect(active.body).toMatchObject({ project_ownership: true, switched_at: expect.any(String) });
        expect(active.body.projects.every((project: any) => project.key_published)).toBe(true);
        expect((await request(app).post("/api/projects/10/key").send({ key: "POST" })).status).toBe(200);
        expect((await pool.query("SELECT key FROM ticket_key_aliases")).rows).toEqual([{ key: "PRE-1" }]);
        const rollback = await request(app).post("/api/projects/migration/switch-back").set("x-test-role", "platform_admin");
        expect(rollback.status).toBe(200);
        const reverted = await request(app).get("/api/projects/migration/review");
        expect(reverted.body).toMatchObject({ project_ownership: false, switched_at: active.body.switched_at });
        expect(reverted.body.projects.every((project: any) => project.key_published)).toBe(true);
        expect((await request(app).post("/api/projects/migration/switch")).status).toBe(409);
        expect((await request(app).post("/api/projects/migration/switch-back").set("x-test-role", "platform_admin")).status).toBe(409);
        expect((await pool.query(`SELECT action, actor_id, entity_id FROM audit_logs
            WHERE entity_type = 'organization' ORDER BY id`)).rows).toEqual([
            { action: "project_ownership_enabled", actor_id: 1, entity_id: 1 },
            { action: "project_ownership_disabled", actor_id: 1, entity_id: 1 },
        ]);
        expect((await pool.query("SELECT project_ownership FROM organizations WHERE id = 2")).rows[0].project_ownership).toBe(false);
    });
    test("only super admins may switch, only platform admins may switch back, and mobile administration is refused", async () => {
        for (const role of ["employee", "team_lead", "manager", "hr_admin", "platform_admin"]) {
            expect((await request(app).post("/api/projects/migration/switch").set("x-test-role", role)).status).toBe(403);
        }
        for (const role of ["employee", "team_lead", "manager", "hr_admin"]) {
            expect((await request(app).get("/api/projects/migration/review").set("x-test-role", role)).status).toBe(403);
        }
        for (const role of ["employee", "hr_admin", "super_admin"]) {
            expect((await request(app).post("/api/projects/migration/switch-back").set("x-test-role", role)).status).toBe(403);
        }
        for (const path of ["/review", "/switch", "/switch-back"]) {
            const response = path === "/review"
                ? await request(app).get(`/api/projects/migration${path}`).set("X-AINO-Client", "android")
                : await request(app).post(`/api/projects/migration${path}`).set("X-AINO-Client", "android");
            expect(response.status).toBe(403);
        }
        expect((await request(app).get("/api/projects/migration/review")).body.project_ownership).toBe(false);
    });
    test("emergency rollback actually restores team visibility for tickets without a project grant", async () => {
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id)
            VALUES (2, 'employee', 'x', 'Employee', 1, 10)`);
        await pool.query("UPDATE tasks SET team_id = 10 WHERE id = 100");
        await pool.query("DELETE FROM project_members WHERE project_id = 10");
        const read = () => request(app).get("/api/tasks/by-key/ENG-1")
            .set("x-test-user", "2").set("x-test-role", "employee");
        expect((await read()).status).toBe(200);
        expect((await request(app).post("/api/projects/migration/switch")).status).toBe(200);
        expect((await read()).status).toBe(404);
        expect((await request(app).post("/api/projects/migration/switch-back").set("x-test-role", "platform_admin")).status).toBe(200);
        expect((await read()).status).toBe(200);
    });
    test("an audit failure rolls back publication and the ownership flag together", async () => {
        await pool.query(`CREATE FUNCTION reject_switch_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.action = 'project_ownership_enabled' THEN RAISE EXCEPTION 'audit unavailable'; END IF;
            RETURN NEW; END $$`);
        await pool.query(`CREATE TRIGGER reject_switch_audit BEFORE INSERT ON audit_logs
            FOR EACH ROW EXECUTE FUNCTION reject_switch_audit()`);
        try {
            expect((await request(app).post("/api/projects/migration/switch")).status).toBe(500);
            const review = await request(app).get("/api/projects/migration/review");
            expect(review.body).toMatchObject({ project_ownership: false, switched_at: null });
            expect(review.body.projects.find((project: any) => project.id === 10).key_published).toBe(false);
        } finally {
            await pool.query("DROP TRIGGER reject_switch_audit ON audit_logs; DROP FUNCTION reject_switch_audit()");
        }
        expect((await request(app).post("/api/projects/migration/switch")).status).toBe(200);
    });
});
