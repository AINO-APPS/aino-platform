import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
jest.setTimeout(120_000);
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1);
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-test-role") || "employee";
        req.userOrgId = Number(req.get("x-test-org") || 1);
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

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe("project key rename HTTP routes (PostgreSQL)", () => {
    const request = require("supertest");
    const { broadcast } = require("../realtime/fanout");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let db: any;
    let app: any;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_key_rename");
        pool = new Pool({ connectionString: database.url, max: 4 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenantId = 1;
            req.db = db;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/projects", require("../routes/projects"));
        app.use("/api/tasks", require("../routes/tasks/byKey"));
    }, 120_000);

    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        broadcast.mockReset();
        await pool.query("TRUNCATE organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Org', 'org'), (2, 'Other', 'other')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id) VALUES
            (1, 'admin', 'x', 'Admin', 1), (2, 'member', 'x', 'Member', 1)`);
        await pool.query("INSERT INTO projects (id, org_id, key, name, next_task_number) VALUES (10, 1, 'OLD', 'Project', 9)");
        await pool.query(`INSERT INTO project_members (project_id, user_id, role) VALUES
            (10, 1, 'project_admin'), (10, 2, 'member')`);
        await pool.query(`INSERT INTO tasks (id, user_id, org_id, project_id, task_number, ticket_key, title) VALUES
            (100, 1, 1, 10, 2, 'OLD-2', 'First'), (101, 1, 1, 10, 8, 'OLD-8', 'Second')`);
    });

    test("preview counts without writing, then rename rewrites all stored keys and preserves published aliases", async () => {
        const preview = await request(app).post("/api/projects/10/key/preview").send({ key: "NEW" });
        expect(preview.status).toBe(200);
        expect(preview.body).toEqual({ project_id: 10, old_key: "OLD", new_key: "NEW", affected_tickets: 2 });
        expect((await request(app).get("/api/projects/10")).body.key).toBe("OLD");
        expect((await pool.query("SELECT COUNT(*)::int AS count FROM audit_logs")).rows[0].count).toBe(0);
        expect(broadcast).not.toHaveBeenCalled();

        const renamed = await request(app).post("/api/projects/10/key").send({ key: "NEW" });
        expect(renamed.status).toBe(200);
        expect(renamed.body).toMatchObject({ old_key: "OLD", new_key: "NEW", affected_tickets: 2 });
        expect((await request(app).get("/api/projects/10")).body).toMatchObject({ key: "NEW", next_task_number: 9 });
        const tickets = await request(app).get("/api/projects/10/tasks");
        expect(tickets.body.tasks.map((task: any) => task.ticket_key).sort()).toEqual(["NEW-2", "NEW-8"]);
        for (const [number, id] of [[2, 100], [8, 101]]) {
            const resolved = await request(app).get(`/api/tasks/by-key/OLD-${number}`);
            expect(resolved.status).toBe(200);
            expect(resolved.body).toMatchObject({ id, ticket_key: `NEW-${number}`, key_alias: true });
        }
        expect((await pool.query("SELECT key, reason FROM ticket_key_aliases ORDER BY key")).rows).toEqual([
            { key: "OLD-2", reason: "rename" }, { key: "OLD-8", reason: "rename" },
        ]);
        expect((await pool.query("SELECT actor_id, action, entity_type, entity_id, details::jsonb AS details FROM audit_logs")).rows).toEqual([
            { actor_id: 1, action: "rename_key", entity_type: "project", entity_id: 10,
                details: { old_key: "OLD", new_key: "NEW" } },
        ]);
        expect((await pool.query("SELECT * FROM task_history")).rows).toEqual([]);
        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith(1, "project_updated", {
            project_id: 10,
        });
    });

    test("only project admins and organization admins can preview or rename and receive canRenameKey", async () => {
        expect((await request(app).get("/api/projects/10")).body.capabilities.canRenameKey).toBe(true);
        expect((await request(app).get("/api/projects/10").set("x-test-user", "2")).body.capabilities.canRenameKey).toBe(false);
        for (const suffix of ["/key/preview", "/key"]) {
            expect((await request(app).post(`/api/projects/10${suffix}`)
                .set("x-test-user", "2").send({ key: "NEW" })).status).toBe(403);
            expect((await request(app).post(`/api/projects/10${suffix}`)
                .set("x-test-org", "2").set("x-test-role", "hr_admin").send({ key: "NEW" })).status).toBe(404);
        }
        expect((await request(app).post("/api/projects/10/key")
            .set("x-test-user", "2").set("x-test-role", "hr_admin").send({ key: "NEW" })).status).toBe(200);
    });

    test("unpublished keys are rewritten without aliases and stay unpublished", async () => {
        await pool.query("UPDATE projects SET key_published = FALSE WHERE id = 10");
        expect((await request(app).post("/api/projects/10/key").send({ key: "NEW" })).status).toBe(200);
        expect((await request(app).get("/api/projects/10")).body).toMatchObject({ key: "NEW", key_published: false });
        expect((await pool.query("SELECT * FROM ticket_key_aliases")).rows).toEqual([]);
        expect((await request(app).get("/api/tasks/by-key/OLD-2")).status).toBe(404);
        expect((await pool.query("SELECT ticket_key FROM tasks ORDER BY id")).rows).toEqual([
            { ticket_key: "NEW-2" }, { ticket_key: "NEW-8" },
        ]);
    });

    test("preview and rename reject malformed, current and reserved keys; renamed keys cannot be reused", async () => {
        await pool.query("INSERT INTO projects (id, org_id, key, name) VALUES (11, 1, 'TAKEN', 'Other')");
        await pool.query("INSERT INTO reserved_project_keys (org_id, key) VALUES (1, 'RESERVED')");
        for (const suffix of ["/key/preview", "/key"]) {
            for (const key of ["bad", "A", "1BAD", "TOOLONGKEY12", " NEW", "", null, 123]) {
                expect((await request(app).post(`/api/projects/10${suffix}`).send({ key })).status).toBe(400);
            }
            for (const key of ["TAKEN", "RESERVED", "OLD"]) {
                expect((await request(app).post(`/api/projects/10${suffix}`).send({ key })).status).toBe(409);
            }
        }
        expect((await request(app).post("/api/projects/10/key").send({ key: "NEW" })).status).toBe(200);
        expect((await request(app).post("/api/projects/10/key").send({ key: "OLD" })).status).toBe(409);
        expect((await request(app).post("/api/projects").set("x-test-role", "team_lead")
            .send({ key: "OLD", name: "Cannot reuse a renamed key" })).status).toBe(409);
    });

    test("failure at the audit write rolls back project, reservations, ticket keys and aliases without an event", async () => {
        await pool.query(`CREATE FUNCTION reject_rename_audit() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.action = 'rename_key' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END $$`);
        await pool.query("CREATE TRIGGER reject_rename_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_rename_audit()");
        try {
            expect((await request(app).post("/api/projects/10/key").send({ key: "NEW" })).status).toBe(500);
        } finally {
            await pool.query("DROP TRIGGER reject_rename_audit ON audit_logs; DROP FUNCTION reject_rename_audit()");
        }
        expect((await request(app).get("/api/projects/10")).body.key).toBe("OLD");
        expect((await pool.query("SELECT ticket_key FROM tasks ORDER BY id")).rows).toEqual([
            { ticket_key: "OLD-2" }, { ticket_key: "OLD-8" },
        ]);
        expect((await pool.query("SELECT * FROM reserved_project_keys WHERE key IN ('OLD', 'NEW')")).rows).toEqual([]);
        expect((await pool.query("SELECT * FROM ticket_key_aliases")).rows).toEqual([]);
        expect((await pool.query("SELECT * FROM audit_logs")).rows).toEqual([]);
        expect(broadcast).not.toHaveBeenCalled();
    });

    test("realtime is emitted only after commit is visible on another connection", async () => {
        let committed: Promise<any> | undefined;
        broadcast.mockImplementation(() => {
            committed = pool.query("SELECT key FROM projects WHERE id = 10");
        });
        expect((await request(app).post("/api/projects/10/key").send({ key: "NEW" })).status).toBe(200);
        expect((await committed).rows[0].key).toBe("NEW");
    });

    test("competing project renames cannot claim the same key", async () => {
        await pool.query("INSERT INTO projects (id, org_id, key, name) VALUES (11, 1, 'OTHER', 'Other')");
        const responses = await Promise.all([10, 11].map(id => request(app).post(`/api/projects/${id}/key`)
            .set("x-test-role", "hr_admin").send({ key: "NEW" })));
        expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
        expect((await pool.query("SELECT * FROM projects WHERE key = 'NEW'")).rows).toHaveLength(1);
        expect((await pool.query("SELECT * FROM audit_logs")).rows).toHaveLength(1);
    });
});
