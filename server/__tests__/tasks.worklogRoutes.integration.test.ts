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
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
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
        app.use('/api/admin', require('../routes/admin'));
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

    test('approved leave on an old day warns after saving the worklog', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Leave work' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', 'approved')");
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1h' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['ON_LEAVE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('day total across tickets warns above worked attendance, excluding breaks and deleted work', async () => {
        const first = (await request(app).post('/api/tasks/backlog').send({ title: 'First work' })).body.id;
        const second = (await request(app).post('/api/tasks/backlog').send({ title: 'Second work' })).body.id;
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES
            (1, 'clock_in', '2020-01-15T09:00:00Z'), (1, 'break_start', '2020-01-15T10:00:00Z'),
            (1, 'break_end', '2020-01-15T10:30:00Z'), (1, 'clock_out', '2020-01-15T11:00:00Z')`);
        await pool.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, minutes, deleted_at) VALUES
            ($1, 1, 1, '2020-01-15', 1000, NOW()), ($1, 2, 1, '2020-01-15', 1000, NULL),
            ($1, 1, 1, '2020-01-14', 1000, NULL)`, [first]);
        const atLimit = await request(app).post(`/api/tasks/${first}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '90m' });
        expect(atLimit.body.warnings).toEqual([]);
        const saved = await request(app).post(`/api/tasks/${second}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
        expect((await request(app).get(`/api/tasks/${second}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test.each(['pending', 'rejected', 'revoked', 'withdraw_pending'])('non-approved leave (%s) and no attendance do not warn or prevent saving', async status => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Unconfirmed leave' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', $1)", [status]);
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '3d' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual([]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('approved leave on a future day still warns without a recent-date window', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Future leave' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2099-01-15', 'planned', 'approved')");
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2099-01-15', time_spent: '1h' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['ON_LEAVE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('attendance follows the author local day, sums split shifts, and ignores rejected entries', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Local shifts' })).body.id;
        await pool.query('UPDATE users SET timezone_offset = -330 WHERE id = 1');
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp, approval_status) VALUES
            (1, 'clock_in', '2020-01-15T18:45:00Z', 'approved'), (1, 'clock_out', '2020-01-15T19:15:00Z', 'approved'),
            (1, 'clock_in', '2020-01-16T03:30:00Z', 'approved'), (1, 'clock_out', '2020-01-16T04:00:00Z', 'approved'),
            (1, 'clock_in', '2020-01-16T05:00:00Z', 'rejected'), (1, 'clock_out', '2020-01-16T15:00:00Z', 'rejected')`);
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-16', time_spent: '61m' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('an open historical clock-in uses the existing end-of-local-day attendance summary', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Open shift' })).body.id;
        await pool.query("INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES (1, 'clock_in', '2020-01-15T23:00:00Z')");
        const atLimit = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '60m' });
        expect(atLimit.body.warnings).toEqual([]);
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toHaveLength(2);
    });

    test('both warnings can be returned and warning read failures never roll back or fail a saved worklog', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Advisory only' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', 'approved')");
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES
            (1, 'clock_in', '2020-01-15T09:00:00Z'), (1, 'clock_out', '2020-01-15T10:00:00Z')`);
        const first = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '2h' });
        expect(first.status).toBe(201);
        expect(first.body.warnings).toEqual(['ON_LEAVE', 'EXCEEDS_ATTENDANCE']);
        await pool.query('ALTER TABLE leaves RENAME TO unavailable_leaves');
        try {
            const second = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
            expect(second.status).toBe(201);
            expect(second.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
            expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toHaveLength(2);
            await pool.query('ALTER TABLE time_entries RENAME TO unavailable_attendance');
            try {
                const third = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
                expect(third.status).toBe(201);
                expect(third.body.warnings).toEqual([]);
                expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toHaveLength(3);
            } finally { await pool.query('ALTER TABLE unavailable_attendance RENAME TO time_entries'); }
        } finally { await pool.query('ALTER TABLE unavailable_leaves RENAME TO leaves'); }
    });

    test("logs work through HTTP with org durations, visible history and refreshed ticket totals", async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Manual work' })).body.id;
        await pool.query('UPDATE organizations SET work_hours_per_day = 7 WHERE id = 1');
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({
            day_worked: '2026-11-01', start_time: '09:30', time_spent: '1d 30m', comment: 'Wrap-up',
        });
        expect(saved.status).toBe(201);
        expect(saved.body).toMatchObject({ worklog: { task_id: id, author_id: 1, logged_by_id: 1,
            day_worked: '2026-11-01', start_time: '09:30:00', minutes: 450, comment: 'Wrap-up', author: { full_name: 'Alice' } },
            ticket: { id, time_spent_minutes: 450, logged_minutes: 450 }, warnings: [] });
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body.time_spent_minutes).toBe(450);
        expect((await request(app).get(`/api/tasks/${id}/history`)).body).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'worklog_added', field: 'worklog', new_value: expect.any(String) }),
        ]));
    });

    test('invalid durations and fields save nothing; Done allows work and Cancelled refuses it', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Validate effort' })).body.id;
        for (const duration of ['abc', '0m', '-2h', '']) {
            const response = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: duration });
            expect(response.status).toBe(400);
            expect(response.body.code).toBe('INVALID_DURATION');
        }
        for (const fields of [{ day_worked: '2026-02-30' }, { start_time: '25:00' }, { comment: 123 }, { author_id: 2 }, { remaining_mode: 'auto' }]) {
            expect((await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h', ...fields })).status).toBe(400);
        }
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body).toEqual({ worklogs: [], time_spent_minutes: 0 });
        expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((h: any) => h.action === 'worklog_added')).toEqual([]);
        expect((await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-org', '2').send({ day_worked: '2026-11-01', time_spent: '1h' })).status).toBe(404);
        expect((await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-team', '2').send({ day_worked: '2026-11-01', time_spent: '1h' })).status).toBe(403);
        await pool.query("UPDATE tasks SET workflow_state_id = (SELECT id FROM workflow_states WHERE org_id = 1 AND key = 'done') WHERE id = $1", [id]);
        const done = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' });
        expect(done.status).toBe(201);
        expect(done.body.worklog).toMatchObject({ minutes: 60, start_time: null, comment: null });
        await pool.query("INSERT INTO workflow_states (org_id, key, name, category, is_terminal) VALUES (1, 'cancelled', 'Cancelled', 'done', TRUE)");
        await pool.query("UPDATE tasks SET workflow_state_id = (SELECT id FROM workflow_states WHERE org_id = 1 AND key = 'cancelled') WHERE id = $1", [id]);
        const cancelled = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' });
        expect(cancelled.status).toBe(403);
        expect(cancelled.body.code).toBe('WORKLOG_CANCELLED');
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.time_spent_minutes).toBe(60);
    });

    test('audit and history commit with work; realtime recipients can read the committed entry', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Auditable work' })).body.id;
        await pool.query('UPDATE users SET team_id = 1 WHERE id = 2');
        const received: Array<{ userId: number; event: string; payload: any; visible: Promise<any> }> = [];
        const send = require('../utils/ws').sendToUser;
        send.mockImplementation((_tenant: number, userId: number, event: string, payload: any) => {
            received.push({ userId, event, payload, visible: request(app).get(`/api/tasks/${id}/worklogs`).then((r: any) => r.body) });
        });
        try {
            const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '45m' });
            expect(saved.status).toBe(201);
            expect(received.map(({ userId, event, payload }) => ({ userId, event, payload }))).toEqual([
                { userId: 1, event: 'task_updated', payload: { taskId: id, action: 'updated' } },
                { userId: 2, event: 'task_updated', payload: { taskId: id, action: 'updated' } },
            ]);
            for (const message of received) expect((await message.visible).worklogs).toEqual([saved.body.worklog]);
            const audit = await request(app).get(`/api/admin/audit-logs?entity_type=task&entity_id=${id}&action=worklog_added`).set('x-test-role', 'super_admin');
            expect(audit.status).toBe(200);
            expect(audit.body).toMatchObject({ total: 1, logs: [{ actor_id: 1, org_id: 1 }] });
            expect(JSON.parse(audit.body.logs[0].details)).toMatchObject({ id: saved.body.worklog.id, minutes: 45 });
        } finally { send.mockReset(); }
    });

    test.each(['task_history', 'audit_logs'])('failure writing %s rolls back work and history and announces nothing', async table => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Atomic work' })).body.id;
        const messages: unknown[] = [];
        const send = require('../utils/ws').sendToUser;
        send.mockImplementation((...message: unknown[]) => messages.push(message));
        await pool.query(`CREATE FUNCTION reject_manual_work() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test record failure'; END $$;
            CREATE TRIGGER reject_manual_work BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_manual_work()`);
        try {
            expect((await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' })).status).toBe(500);
            expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body).toEqual({ worklogs: [], time_spent_minutes: 0 });
            expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((h: any) => h.action === 'worklog_added')).toEqual([]);
            expect((await request(app).get(`/api/admin/audit-logs?entity_id=${id}&action=worklog_added`).set('x-test-role', 'super_admin')).body.total).toBe(0);
            expect(messages).toEqual([]);
        } finally {
            await pool.query(`DROP TRIGGER reject_manual_work ON ${table}; DROP FUNCTION reject_manual_work()`);
            send.mockReset();
        }
    });

    test('concurrent manual worklogs return authoritative serialized totals and both remain visible', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Concurrent effort' })).body.id;
        const responses = await Promise.all(['30m', '45m'].map(time_spent => request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent })));
        expect(responses.map(r => r.status)).toEqual([201, 201]);
        expect(responses.map(r => r.body.ticket.time_spent_minutes).sort((a, b) => a - b)).toEqual(expect.arrayContaining([75]));
        const list = (await request(app).get(`/api/tasks/${id}/worklogs`)).body;
        expect(list.time_spent_minutes).toBe(75);
        expect(list.worklogs.map((w: any) => w.minutes).sort((a: number, b: number) => a - b)).toEqual([30, 45]);
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
