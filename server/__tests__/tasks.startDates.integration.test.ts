/** Ticket 02's agreed HTTP seam: real routers, disposable PostgreSQL per suite. */
import { Pool } from "pg";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";

installPgTypeParsers();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1);
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: async (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-test-role") || "employee";
        const user = (await req.db.query(
            "SELECT org_id, team_id FROM users WHERE id = $1",
            [req.userId],
        )).rows[0];
        req.userOrgId = user?.org_id ?? 1;
        req.userTeamId = user?.team_id ?? null;
        req.userTeamIds = user?.org_id == null ? [] : (await req.db.query(
            `SELECT team_id FROM (
                SELECT team_id FROM users WHERE id = $1 AND org_id = $2 AND team_id IS NOT NULL
                UNION
                SELECT utm.team_id FROM user_team_memberships utm
                JOIN teams t ON t.id = utm.team_id
                WHERE utm.user_id = $1 AND t.org_id = $2
            ) memberships ORDER BY team_id`,
            [req.userId, req.userOrgId],
        )).rows.map((row: any) => Number(row.team_id));
        req.roleLevel = req.userRole === "manager" || req.userRole === "super_admin" ? 2 : 1;
        req.projectOwnership = (await req.db.query(
            "SELECT project_ownership FROM organizations WHERE id = $1",
            [req.userOrgId],
        )).rows[0]?.project_ownership === true;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
    getVisibleUserIds: async () => [1, 2],
    ROLE_LEVEL: { employee: 1, manager: 2, super_admin: 4 },
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
jest.setTimeout(30_000);

postgresDescribe("start date routes (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    const request = require("supertest");

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "start_date_routes");
        pool = new Pool({ connectionString: database.url, max: 3 });

        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (9, 'Legacy memberships', 'legacy-memberships')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (9, 9, 'Legacy')");
        await pool.query(
            "INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES (9, 'legacy', 'x', 'Legacy', 9, 9)",
        );
        const migrations = await require("../platform/db/migrations").runTenantMigrations(query, { label: "start_date_routes" });
        expect(migrations.failed).toEqual([]);
        expect((await pool.query(
            "SELECT user_id, team_id FROM user_team_memberships WHERE user_id = 9",
        )).rows).toEqual([{ user_id: 9, team_id: 9 }]);
        await require("../platform/db/agileDefaults").seedAgileDefaults(query);
        // Daily Notes still reads these legacy meeting columns; that unrelated
        // production schema drift is outside the start-date slice.
        await pool.query("ALTER TABLE meetings ADD COLUMN IF NOT EXISTS scheduled_start TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS scheduled_end TIMESTAMPTZ");

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
        app.use("/api/projects", require("../routes/projects"));
        app.use("/api/manager", require("../routes/manager"));
        app.use("/api/notes", require("../routes/notes"));
        app.use("/api/search", require("../routes/search"));
        app.use("/api/export", require("../routes/export"));
        app.use("/api/attendance", require("../modules/attendance/attendance.routes"));
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE audit_logs, task_history, tasks, sprints, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Routes', 'routes')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Beta')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
            (1, 'alice', 'x', 'Alice', 1, 1), (2, 'admin', 'x', 'Admin', 1, 1)`);
        await pool.query("UPDATE projects SET type = 'scrum' WHERE org_id = 1");
        await pool.query(
            "INSERT INTO sprints (id, team_id, name, start_date, end_date, status) VALUES (10, 1, 'Alpha 1', '2026-11-01', '2026-11-14', 'planned')",
        );
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
    });

    test("legacy schedule shims edit sprint ticket dates without leaving its sprint or clearing its deadline", async () => {
        const created = await request(app).post("/api/tasks").send({ title: "Sprint dates", sprint_id: 10, start_date: "2026-11-09" });
        expect(created.body).toMatchObject({ sprint_id: 10, start_date: "2026-11-09" });
        const scheduled = await request(app).patch(`/api/tasks/${created.body.id}/schedule`).send({ date: "2026-11-11" });
        expect(scheduled.status).toBe(200);
        expect(scheduled.body).toMatchObject({ sprint_id: 10, start_date: "2026-11-11", planned_date: "2026-11-11", due_date: "2026-11-14" });
        const cleared = await request(app).patch(`/api/tasks/${created.body.id}/unschedule`).send({});
        expect(cleared.body).toMatchObject({ sprint_id: 10, start_date: null, planned_date: null, due_date: "2026-11-14" });
        const history = await request(app).get(`/api/tasks/${created.body.id}/history`);
        expect(history.body.filter((h: any) => h.field === "start_date")).toHaveLength(3);
        expect(history.body.filter((h: any) => ["scheduled", "unscheduled", "removed_from_sprint"].includes(h.action))).toEqual([]);
    });
    test("refuses impossible dates on create, either side of an edit and schedule, without changing dates or history", async () => {
        for (const route of ["/api/tasks", "/api/tasks/backlog"]) {
            const rejected = await request(app).post(route).send({ title: "Invalid dates", start_date: "2026-11-12", due_date: "2026-11-11" });
            expect(rejected).toMatchObject({ status: 400, body: { error: "Due date cannot be earlier than the start date" } });
        }
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Valid pair", planned_date: "2026-11-10", due_date: "2026-11-12" });
        expect(created.body).toMatchObject({ start_date: "2026-11-10", planned_date: "2026-11-10", due_date: "2026-11-12" });
        const history = await request(app).get(`/api/tasks/${created.body.id}/history`);
        for (const body of [{ due_date: "2026-11-09" }, { start_date: "2026-11-13" }, { planned_date: "2026-11-13" }]) {
            const rejected = await request(app).put(`/api/tasks/${created.body.id}`).send(body);
            expect(rejected).toMatchObject({ status: 400, body: { error: "Due date cannot be earlier than the start date" } });
        }
        const rejected = await request(app).patch(`/api/tasks/${created.body.id}/schedule`).send({ date: "2026-11-13" });
        expect(rejected.status).toBe(400);
        expect((await request(app).get(`/api/tasks/${created.body.id}/history`)).body).toEqual(history.body);
        expect((await request(app).get(`/api/tasks/${created.body.id}/detail`)).body).toMatchObject({ start_date: "2026-11-10", due_date: "2026-11-12" });
        const sameDay = await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: "2026-11-12" });
        expect(sameDay.status).toBe(200);
        expect((await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: "2026-02-30" })).status).toBe(400);
    });
    test("date-driven reads use the start date even when the retained legacy placement day differs", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Reader marker", start_date: "2026-11-10" });
        await pool.query("UPDATE tasks SET planned_date = '2026-10-01' WHERE id = $1", [created.body.id]);
        const day = await request(app).get("/api/tasks?date=2026-11-10");
        expect(day.body.tasks.map((t: any) => t.id)).toContain(created.body.id);
        const oldDay = await request(app).get("/api/tasks?date=2026-10-01");
        expect(oldDay.body.tasks.map((t: any) => t.id)).not.toContain(created.body.id);
        const week = await request(app).get("/api/tasks?start_date=2026-11-09&end_date=2026-11-15");
        expect(week.body.tasks.map((t: any) => t.id)).toContain(created.body.id);
        const manager = await request(app).get("/api/manager/member/1/tasks?date=2026-11-10").set("x-test-role", "manager");
        expect(manager.body.map((t: any) => t.id)).toContain(created.body.id);
        const search = await request(app).get("/api/search?q=Reader");
        expect(search.body.tasks.find((t: any) => t.id === created.body.id)).toMatchObject({ start_date: "2026-11-10", planned_date: "2026-11-10" });
        const scheduled = await request(app).get("/api/tasks/scheduled");
        expect(scheduled.body.tasks.find((t: any) => t.id === created.body.id)).toMatchObject({ start_date: "2026-11-10", planned_date: "2026-11-10" });
    });
    test("notes conversions create a start date without Scheduled placement", async () => {
        const response = await request(app).post("/api/notes/convert-to-task").send({ title: "From dated note" });
        expect(response.status).toBe(200);
        expect(response.body.task.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const detail = await request(app).get(`/api/tasks/${response.body.task.id}/detail`);
        expect(detail.body.start_date).toBe(response.body.task.date);
        expect(detail.body.container).toBe("backlog");
    });
    test("export, notes and attendance day views find start-dated work, not the old placement day", async () => {
        const today = new Date().toISOString().slice(0, 10);
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Today reader", start_date: today });
        await pool.query("UPDATE tasks SET planned_date = '2026-01-01' WHERE id = $1", [created.body.id]);
        const exported = await request(app).get(`/api/export/my-tasks?from=${today}&to=${today}`);
        expect(exported.status).toBe(200);
        expect(exported.text).toContain("Today reader");
        const absent = await request(app).get("/api/export/my-tasks?from=2026-01-01&to=2026-01-01");
        expect(absent.text).not.toContain("Today reader");
        const notes = await request(app).get("/api/notes/daily-prefill");
        expect(notes.status).toBe(200);
        expect(notes.body.tasks.map((t: any) => t.title)).toContain("Today reader");
        const attendance = await request(app).get("/api/attendance/task-summary");
        expect(attendance.status).toBe(200);
        expect(attendance.body.total).toBe(1);
    });
    test("concurrent date edits cannot commit an impossible pair and accepted due-date edits write history", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Concurrent dates", start_date: "2026-11-10", due_date: "2026-11-20" });
        const edits = await Promise.all([
            request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: "2026-11-18" }),
            request(app).put(`/api/tasks/${created.body.id}`).send({ due_date: "2026-11-12" }),
        ]);
        expect(edits.map((r) => r.status).sort()).toEqual([200, 400]);
        const detail = await request(app).get(`/api/tasks/${created.body.id}/detail`);
        expect(detail.body.start_date <= detail.body.due_date).toBe(true);
        const edited = await request(app).put(`/api/tasks/${created.body.id}`).send({ due_date: "2026-11-25" });
        expect(edited.status).toBe(200);
        const history = await request(app).get(`/api/tasks/${created.body.id}/history`);
        expect(history.body).toEqual(expect.arrayContaining([expect.objectContaining({ field: "due_date", action: "updated", new_value: "2026-11-25" })]));
    });
    test("project member date edits respect viewer and archived-project guards without granting placement rights", async () => {
        await pool.query("UPDATE organizations SET project_ownership = TRUE WHERE id = 1");
        const project = (await pool.query("SELECT id FROM projects WHERE org_id = 1 ORDER BY id LIMIT 1")).rows[0];
        await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, 1, 'member') ON CONFLICT (project_id, user_id) DO UPDATE SET role='member'", [project.id]);
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Project dates", project_id: project.id });
        expect(created.status).toBe(200);
        const edited = await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: "2026-11-10" });
        expect(edited.status).toBe(200);
        const history = await request(app).get(`/api/tasks/${created.body.id}/history`);
        await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: "2026-11-10" });
        expect((await request(app).get(`/api/tasks/${created.body.id}/history`)).body).toEqual(history.body);
        await pool.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=1", [project.id]);
        expect((await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: null })).status).toBe(403);
        expect((await request(app).patch(`/api/tasks/${created.body.id}/schedule`).send({ date: "2026-11-11" })).status).toBe(403);
        await pool.query("UPDATE projects SET is_archived=TRUE WHERE id=$1", [project.id]);
        expect((await request(app).put(`/api/tasks/${created.body.id}`).set("x-test-role", "super_admin").send({ start_date: null })).body.code).toBe("PROJECT_ARCHIVED");
    });
    test("start date edits and legacy aliases preserve placement and write date history", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Dated backlog" });
        expect(created.status).toBe(200);
        const edited = await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: "2026-11-10" });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({ start_date: "2026-11-10", planned_date: "2026-11-10", sprint_id: null });
        const backlog = await request(app).get("/api/tasks/backlog");
        expect(backlog.body.tasks.map((t: any) => t.id)).toContain(created.body.id);
        const history = await request(app).get(`/api/tasks/${created.body.id}/history`);
        expect(history.body).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: "updated", field: "start_date", new_value: "2026-11-10" }),
        ]));
        const aliased = await request(app).put(`/api/tasks/${created.body.id}`).send({ planned_date: "2026-11-11" });
        expect(aliased.body).toMatchObject({ start_date: "2026-11-11", planned_date: "2026-11-11", sprint_id: null });
        const canonical = await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: "2026-11-12", planned_date: "2026-11-01" });
        expect(canonical.body).toMatchObject({ start_date: "2026-11-12", planned_date: "2026-11-12" });
        const cleared = await request(app).put(`/api/tasks/${created.body.id}`).send({ start_date: null, planned_date: "2026-11-01" });
        expect(cleared.body).toMatchObject({ start_date: null, planned_date: null, sprint_id: null });
    });
});
