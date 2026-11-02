/**
 * Ticket routes against real PostgreSQL (spec issue 03, seam B).
 *
 * Only the flows where the order of the move and the field update matters:
 * the mocked route suite cannot see which write wins. Runs only when
 * TASKS_SCHEMA_TEST_DATABASE_URL is set (`npm run test:pg`, or CI).
 */
import { Pool } from "pg";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";

installPgTypeParsers();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 1;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = "employee";
        req.userOrgId = 1;
        req.userTeamId = 1;
        req.roleLevel = 1;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn(), broadcast: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/mailer", () => ({ notifyByEmail: jest.fn(), sendMail: jest.fn() }));

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe("ticket routes place through the module (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    const request = require("supertest");

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "placement_routes");
        pool = new Pool({ connectionString: database.url, max: 3 });

        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        const migrations = await require("../platform/db/migrations").runTenantMigrations(query, { label: "placement_routes" });
        expect(migrations.failed).toEqual([]);
        await require("../platform/db/agileDefaults").seedAgileDefaults(query);

        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenant = { id: 1, plan: "enterprise", features: { team_visibility: true, agile: true } };
            req.tenantId = 1;
            req.db = db;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/notes", require("../routes/notes"));
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE audit_logs, task_history, tasks, sprints, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Routes', 'routes')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha')");
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES (1, 'alice', 'x', 'Alice', 1, 1)");
        await pool.query(
            "INSERT INTO sprints (id, team_id, name, start_date, end_date, status) VALUES (10, 1, 'Alpha 1', '2026-11-01', '2026-11-14', 'planned')",
        );
        // seedAgileDefaults keys workflow states by org; re-seed for org 1.
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
    });

    async function row(id: number) {
        return (await pool.query("SELECT sprint_id, planned_date, due_date, pre_sprint_due_date FROM tasks WHERE id = $1", [id])).rows[0];
    }

    test("creating straight into a sprint remembers the own due date and sets no planned day", async () => {
        const res = await request(app).post("/api/tasks").send({ title: "New", sprint_id: 10, due_date: "2026-11-20" });

        expect(res.status).toBe(200);
        expect(await row(res.body.id)).toEqual({
            sprint_id: 10, planned_date: null, due_date: "2026-11-14", pre_sprint_due_date: "2026-11-20",
        });
    });

    test("leaving a sprint with an explicit due date keeps the typed date over the restored one", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New", sprint_id: 10, due_date: "2026-11-20" });

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: null, due_date: "2026-12-01" });

        expect(res.status).toBe(200);
        expect(await row(created.body.id)).toEqual({
            sprint_id: null, planned_date: null, due_date: "2026-12-01", pre_sprint_due_date: null,
        });
    });

    test("scheduling a ticket in a sprint is refused and changes nothing", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New", sprint_id: 10 });
        const before = await row(created.body.id);

        const res = await request(app).patch(`/api/tasks/${created.body.id}/schedule`).send({ date: "2026-11-06" });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("IN_SPRINT");
        expect(await row(created.body.id)).toEqual(before);
    });

    test("the detail editor's full save (sprint_id: null) still plans the day", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New" });

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: null, planned_date: "2026-11-06" });

        expect(res.status).toBe(200);
        expect((await row(created.body.id)).planned_date).toBe("2026-11-06");
    });

    test("editing the due date of a sprinted ticket while resending its sprint keeps the typed date", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New", sprint_id: 10 });

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: 10, due_date: "2026-11-12" });

        expect(res.status).toBe(200);
        expect(await row(created.body.id)).toMatchObject({ sprint_id: 10, due_date: "2026-11-12" });
    });

    test("a note checklist item becomes a ticket in the user's org", async () => {
        const res = await request(app).post("/api/notes/convert-to-task").send({ title: "From note" });

        expect(res.status).toBe(200);
        expect(res.body.task).toMatchObject({ title: "From note", sprint_id: null, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
        expect((await pool.query("SELECT org_id FROM tasks WHERE id = $1", [res.body.task.id])).rows[0].org_id).toBe(1);
    });

    test("carry-forward records one planned-day history row per copy", async () => {
        await pool.query("UPDATE users SET timezone = 'UTC' WHERE id = 1").catch(() => undefined);
        const yesterday = (await pool.query("SELECT (CURRENT_DATE - 1)::text AS d")).rows[0].d;
        const created = await request(app).post("/api/tasks").send({ title: "Yesterday", date: yesterday });
        expect(created.status).toBe(200);

        const res = await request(app).post("/api/tasks/carry-forward").send({});

        expect(res.status).toBe(200);
        const copies = (await pool.query("SELECT id FROM tasks WHERE title = 'Yesterday' AND id <> $1", [created.body.id])).rows;
        expect(copies).toHaveLength(1);
        const history = (await pool.query(
            "SELECT action, field FROM task_history WHERE task_id = $1 AND field = 'planned_date'", [copies[0].id],
        )).rows;
        expect(history).toHaveLength(1);
    });

    test("a refused sprint move on PUT rolls back the other fields too", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Before" });
        await pool.query("UPDATE sprints SET status = 'completed' WHERE id = 10");

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: 10, title: "After" });

        expect(res.status).toBe(409);
        expect((await pool.query("SELECT title FROM tasks WHERE id = $1", [created.body.id])).rows[0].title).toBe("Before");
    });
});
