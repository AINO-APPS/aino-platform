import { Pool } from "pg";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";

installPgTypeParsers();
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1);
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-test-role") || "employee";
        req.userOrgId = Number(req.get("x-test-org") || 1);
        req.userTeamId = Number(req.get("x-test-team") || 1);
        req.roleLevel = req.userRole === "super_admin" ? 4 : 1;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    getVisibleUserIds: async () => [1, 2],
    ROLE_LEVEL: { employee: 1, manager: 2, super_admin: 4 },
}));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn(), broadcast: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/mailer", () => ({ notifyByEmail: jest.fn(), sendMail: jest.fn() }));
const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const pgDescribe = url ? describe : describe.skip;
const request = require("supertest");

pgDescribe("ticket worklogs through HTTP (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    beforeAll(async () => {
        database = await createTestDatabase(url!, "worklog_routes");
        pool = new Pool({ connectionString: database.url, max: 4 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenant = { id: 1, features: { team_visibility: true, agile: true } };
            req.tenantId = 1;
            req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/tracker", require("../modules/attendance/attendance.routes"));
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        await pool.query("TRUNCATE tasks, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Worklogs', 'worklogs'), (2, 'Other', 'other')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Beta'), (3, 2, 'Other')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
            (1, 'alice', 'unused', 'Alice', 1, 1), (2, 'bob', 'unused', 'Bob', 1, 2), (3, 'carol', 'unused', 'Carol', 2, 3)`);
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params));
    });

    test("lists newest work first, excludes deleted work, and enforces existing ticket visibility", async () => {
        const created = await request(app).post('/api/tasks/backlog').send({ title: 'Read worklogs' });
        const id = created.body.id;
        await pool.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, minutes, comment, created_at, deleted_at) VALUES
            ($1, 1, 1, '2026-10-01', 30, 'Earlier', '2026-11-03T09:00:00Z', NULL),
            ($1, 1, 1, '2026-11-02', 45, 'Newest day', '2026-11-02T09:00:00Z', NULL),
            ($1, 1, 1, '2026-11-02', 15, 'Later entry', '2026-11-02T10:00:00Z', NULL),
            ($1, 1, 1, '2026-11-03', 99, 'Deleted', NOW(), NOW())`, [id]);
        const visible = await request(app).get(`/api/tasks/${id}/worklogs`);
        expect(visible.status).toBe(200);
        expect(visible.body.time_spent_minutes).toBe(90);
        expect(visible.body.worklogs.map((w: any) => w.comment)).toEqual(['Later entry', 'Newest day', 'Earlier']);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body).toMatchObject({ time_spent_minutes: 90, logged_minutes: 90 });
        const tracker = await request(app).get('/api/tracker/task-time?from=2026-11-02&to=2026-11-03');
        expect(tracker.body).toEqual([{ date: '2026-11-02', minutes: 60, entries: [
            { task_id: id, title: 'Read worklogs', issue_key: null, date: '2026-11-02', minutes: 60 },
        ] }]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-team', '2')).status).toBe(403);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-org', '2').set('x-test-role', 'super_admin')).status).toBe(404);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-team', '2').set('x-test-role', 'super_admin')).status).toBe(200);
        expect((await request(app).get('/api/tasks/99999/worklogs')).status).toBe(404);
    });

    test("concurrent legacy stops record time only once, and start remains idempotent", async () => {
        const created = await request(app).post('/api/tasks/backlog').send({ title: 'Concurrent time' });
        const id = created.body.id;
        const starts = await Promise.all([request(app).post(`/api/tasks/${id}/timer/start`), request(app).post(`/api/tasks/${id}/timer/start`)]);
        expect(starts.map(r => r.status)).toEqual([200, 200]);
        expect(starts[0].body.startedAt).toBe(starts[1].body.startedAt);
        const stops = await Promise.all([request(app).post(`/api/tasks/${id}/timer/stop`), request(app).post(`/api/tasks/${id}/timer/stop`)]);
        expect(stops.map(r => r.status).sort()).toEqual([200, 409]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body).toMatchObject({ time_spent_minutes: 1, worklogs: [{ minutes: 1 }] });
        const history = await request(app).get(`/api/tasks/${id}/history`);
        expect(history.body.filter((h: any) => h.action === 'time_logged')).toHaveLength(1);
    });

    test("a failed worklog write leaves the timer running and no recorded time", async () => {
        const created = await request(app).post('/api/tasks/backlog').send({ title: 'Atomic stop' });
        const id = created.body.id;
        await request(app).post(`/api/tasks/${id}/timer/start`);
        await pool.query(`CREATE FUNCTION reject_test_worklog() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test write failure'; END $$;
            CREATE TRIGGER reject_test_worklog BEFORE INSERT ON task_worklogs
            FOR EACH ROW EXECUTE FUNCTION reject_test_worklog()`);
        try {
            expect((await request(app).post(`/api/tasks/${id}/timer/stop`)).status).toBe(500);
            expect((await request(app).get(`/api/tasks/${id}/timer`)).body.running).toBe(true);
            expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body).toEqual({ worklogs: [], time_spent_minutes: 0 });
        } finally {
            await pool.query('DROP TRIGGER reject_test_worklog ON task_worklogs; DROP FUNCTION reject_test_worklog()');
        }
        expect((await request(app).post(`/api/tasks/${id}/timer/stop`)).status).toBe(200);
    });

    test("legacy stops round partial minutes up and date work from the start instant, not the stop", async () => {
        const created = await request(app).post('/api/tasks/backlog').send({ title: 'Worked day' });
        const id = created.body.id;
        await pool.query("INSERT INTO task_timers (task_id, user_id, started_at) VALUES ($1, 1, NOW() - INTERVAL '80 seconds')", [id]);
        const rounded = await request(app).post(`/api/tasks/${id}/timer/stop`);
        expect(rounded.body.minutes).toBe(2);
        await pool.query("INSERT INTO task_timers (task_id, user_id, started_at) VALUES ($1, 1, '2026-11-02T23:45:00Z')", [id]);
        const stopped = await request(app).post(`/api/tasks/${id}/timer/stop`).set('x-timezone-offset', '-330');
        expect(stopped.status).toBe(200);
        const list = await request(app).get(`/api/tasks/${id}/worklogs`);
        expect(list.body.worklogs.find((w: any) => w.day_worked === '2026-11-03')).toMatchObject({
            start_time: '05:15:00', author_id: 1, logged_by_id: 1,
        });
    });

    test("legacy stop records one worklog and retains its response shape without writing the ticket total", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Time spent" });
        expect(created.status).toBe(200);
        const id = created.body.id;
        await pool.query("UPDATE tasks SET logged_minutes = 999, estimated_minutes = 120 WHERE id = $1", [id]);
        // The obsolete total must not be written, even to the same value.
        await pool.query(`CREATE OR REPLACE FUNCTION reject_stored_time() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'stored time must not be written'; END $$;
            CREATE TRIGGER reject_stored_time BEFORE UPDATE OF logged_minutes ON tasks
            FOR EACH ROW EXECUTE FUNCTION reject_stored_time()`);
        await pool.query("INSERT INTO task_timers (task_id, user_id, started_at) VALUES ($1, 1, NOW() - INTERVAL '20 seconds')", [id]);
        const stopped = await request(app).post(`/api/tasks/${id}/timer/stop`).set("x-timezone-offset", "-330");
        expect(stopped.status).toBe(200);
        expect(stopped.body).toEqual({ taskId: id, running: false, minutes: 1,
            time: { estimated: 120, logged: 1, remaining: 119, percent: 1, over: false } });
        const list = await request(app).get(`/api/tasks/${id}/worklogs`);
        expect(list.status).toBe(200);
        expect(list.body).toMatchObject({ time_spent_minutes: 1, worklogs: [{ task_id: id, author_id: 1, logged_by_id: 1, minutes: 1, author: { full_name: 'Alice' } }] });
        expect(list.body.worklogs).toHaveLength(1);
        expect((await request(app).get(`/api/tasks/${id}/timer`)).body.time.logged).toBe(1);
        const detail = await request(app).get(`/api/tasks/${id}/detail`);
        expect(detail.body).toMatchObject({ time_spent_minutes: 1, logged_minutes: 1 });
        const backlog = await request(app).get("/api/tasks/backlog");
        expect(backlog.body.tasks.find((t: any) => t.id === id)).toMatchObject({ time_spent_minutes: 1, logged_minutes: 1 });
        const day = list.body.worklogs[0].day_worked;
        const startInstant = (await pool.query('SELECT started_at FROM task_timers WHERE task_id = $1', [id])).rows[0].started_at;
        expect(day).toBe(new Date(new Date(startInstant).getTime() + 330 * 60_000).toISOString().slice(0, 10));
        const tracker = await request(app).get(`/api/tracker/task-time?from=${day}&to=${day}`).set("x-timezone-offset", "720");
        expect(tracker.body).toEqual([{ date: day, minutes: 1, entries: [{ task_id: id, title: 'Time spent', issue_key: null, date: day, minutes: 1 }] }]);
        expect((await request(app).post(`/api/tasks/${id}/timer/stop`)).status).toBe(409);
        await pool.query("DROP TRIGGER reject_stored_time ON tasks");
    });
});
