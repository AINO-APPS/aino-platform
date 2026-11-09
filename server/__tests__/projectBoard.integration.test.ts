import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
jest.setTimeout(120_000);
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => { req.userId = 1; next(); });
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        Object.assign(req, { userOrgId: 1, userTeamId: 1, userRole: "employee", projectOwnership: true });
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
    ROLE_LEVEL: { employee: 1, team_lead: 2, hr_admin: 4, super_admin: 5 },
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn(), broadcast: jest.fn(), sendToUser: jest.fn() }));

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
async function retryConnection<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try { return await operation(); }
        catch (err) {
            if (attempt === 2 || !/ECONNREFUSED|ETIMEDOUT|Connection terminated|timeout expired/.test(String(err))) throw err;
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }
}
(databaseUrl ? describe : describe.skip)("project boards (PostgreSQL)", () => {
    const request = require("supertest");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    let states: Record<string, number>;
    beforeAll(async () => {
        database = await retryConnection(() => createTestDatabase(databaseUrl!, "project_board"));
        pool = new Pool({ connectionString: database.url, max: 3, connectionTimeoutMillis: 10_000 });
        const query = (sql: string, params: unknown[] = []) => retryConnection(() => pool.query(sql, params as any[]));
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        app = require("express")();
        app.use(require("express").json());
        app.use((req: any, _res: any, next: any) => {
            req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
            req.tenant = { id: 1, plan: "enterprise", features: { agile: false, team_visibility: true } };
            req.tenantId = 1;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/projects", require("../routes/projects"));
        app.use("/api/projects", require("../routes/projectWorkflow"));
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/sprints", require("../routes/sprints"));
    });
    afterAll(async () => { await pool?.end(); if (database) await retryConnection(database.drop); });
    beforeEach(async () => {
        await pool.query("TRUNCATE tasks, sprints, projects, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug, project_ownership) VALUES (1, 'Flow', 'flow', TRUE)");
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Team')");
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES (1, 'member', 'x', 'Member', 1, 1)");
        await pool.query(`INSERT INTO projects (id, org_id, key, name, type) VALUES
            (10, 1, 'FLOW', 'Flow', 'kanban'), (20, 1, 'OTHER', 'Other', 'kanban')`);
        await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES (10, 1, 'project_admin')");
        states = Object.fromEntries((await pool.query("SELECT key, id FROM workflow_states WHERE project_id = 10")).rows.map((row) => [row.key, row.id]));
    });
    async function ticket(title: string, key: string, projectId = 10) {
        const state = projectId === 10 ? states[key] : (await pool.query(
            "SELECT id FROM workflow_states WHERE project_id = $1 AND key = $2", [projectId, key])).rows[0].id;
        return (await pool.query(`INSERT INTO tasks (title, user_id, org_id, project_id, workflow_state_id)
            VALUES ($1, 1, 1, $2, $3) RETURNING id`, [title, projectId, state])).rows[0].id;
    }

    test("Task list calendar reads inclusive spans, single dates and undated open work within one project", async () => {
        await request(app).put("/api/projects/10").send({ type: "task_list" }).expect(200);
        const create = async (title: string, start_date: string | null, due_date: string | null) => {
            const result = await request(app).post("/api/tasks").send({ project_id: 10, title, start_date, due_date });
            expect(result.status).toBe(200);
            return result.body.id;
        };
        const span = await create("Spans the whole range", "2026-11-01", "2026-11-30");
        const end = await create("Ends on first day", "2026-11-01", "2026-11-09");
        const start = await create("Starts on last day", "2026-11-15", null);
        const due = await create("Only a deadline", null, "2026-11-10");
        const undated = await create("Not yet dated", null, null);
        await create("Outside range", "2026-11-16", "2026-11-17");
        await ticket("Other project", "pending", 20);
        const done = await ticket("Done", "done");
        await ticket("Cancelled", "cancelled");
        const calendar = await request(app).get("/api/tasks").query({
            scope: "calendar", project_id: 10, start_date: "2026-11-09", end_date: "2026-11-15",
        }).expect(200);
        expect(calendar.body.tasks.map((row: any) => row.id).sort()).toEqual([span, end, start, due].sort());
        const tray = await request(app).get("/api/tasks").query({ scope: "calendar", project_id: 10, undated: "1" }).expect(200);
        expect(tray.body.tasks.map((row: any) => row.id)).toEqual([undated]);
        const list = await request(app).get("/api/tasks").query({ scope: "list", project_id: 10 }).expect(200);
        expect(list.body.tasks.map((row: any) => row.id)).toEqual(expect.arrayContaining([span, undated, done]));
        expect(list.body.tasks.map((row: any) => row.title)).not.toContain("Other project");
        await request(app).get("/api/tasks").query({ scope: "list", project_id: 20 }).expect(403);
        const day = await request(app).get("/api/tasks").query({ scope: "calendar", project_id: 10, date: "2026-11-10" }).expect(200);
        expect(day.body.tasks.map((row: any) => row.id).sort()).toEqual([span, due].sort());
    });

    test("Task list reads filter and sort all eight fields, with literal key/title matching and pagination", async () => {
        await request(app).put("/api/projects/10").send({ type: "task_list" }).expect(200);
        const bugType = (await pool.query("SELECT id FROM work_item_types WHERE org_id = 1 AND key = 'bug'")).rows[0].id;
        const first = (await request(app).post("/api/tasks").send({
            project_id: 10, title: "Zulu 100%", priority: "high", assigned_to: 1,
            start_date: "2026-11-09", due_date: "2026-11-12",
        }).expect(200)).body;
        const second = (await request(app).post("/api/tasks").send({
            project_id: 10, title: "Alpha", priority: "low", work_item_type_id: bugType,
            start_date: "2026-11-10", due_date: "2026-11-13", workflow_state_id: states.in_progress,
        }).expect(200)).body;
        for (const [field, value] of Object.entries({
            key: first.ticket_key, title: "100%", work_item_type_id: first.work_item_type_id, status: "pending",
            assignee: "1", priority: "high", start_on: "2026-11-09", due_on: "2026-11-12",
        })) {
            const list = await request(app).get("/api/tasks").query({ scope: "list", project_id: 10, [field]: value }).expect(200);
            expect({ field, ids: list.body.tasks.map((row: any) => row.id) }).toEqual({ field, ids: [first.id] });
        }
        for (const [sort, expected] of Object.entries({
            key: [first.id, second.id], title: [second.id, first.id], type: [second.id, first.id],
            status: [second.id, first.id], assignee: [first.id, second.id], priority: [first.id, second.id],
            start_date: [first.id, second.id], due_date: [first.id, second.id],
        })) {
            const list = await request(app).get("/api/tasks").query({ scope: "list", project_id: 10, sort }).expect(200);
            expect({ sort, ids: list.body.tasks.map((row: any) => row.id) }).toEqual({ sort, ids: expected });
        }
        const descending = await request(app).get("/api/tasks").query({ scope: "list", project_id: 10, sort: "due_date", direction: "desc", offset: 1 }).expect(200);
        expect(descending.body.tasks.map((row: any) => row.id)).toEqual([first.id]);
        expect(descending.body.pagination).toEqual({ offset: 1, hasMore: false });
        const unassigned = await request(app).get("/api/tasks").query({ scope: "list", project_id: 10, assignee: "unassigned" }).expect(200);
        expect(unassigned.body.tasks.map((row: any) => row.id)).toEqual([second.id]);
    });

    test("calendar date edits are atomic, validated and capability-guarded through public reads", async () => {
        await request(app).put("/api/projects/10").send({ type: "task_list" }).expect(200);
        const created = (await request(app).post("/api/tasks").send({
            project_id: 10, title: "Calendar edits", start_date: "2026-11-09", due_date: "2026-11-12",
        }).expect(200)).body;
        await request(app).put(`/api/tasks/${created.id}`).send({ start_date: "2026-11-15" }).expect(400);
        await request(app).put(`/api/tasks/${created.id}`).send({ start_date: "2026-11-15", due_date: "2026-11-18" }).expect(200);
        const read = await request(app).get("/api/tasks").query({ scope: "calendar", project_id: 10, date: "2026-11-16" }).expect(200);
        expect(read.body.tasks).toEqual([expect.objectContaining({ id: created.id, start_date: "2026-11-15", due_date: "2026-11-18", sprint_id: null })]);
        const history = await request(app).get(`/api/tasks/${created.id}/history`).expect(200);
        expect(history.body).toEqual(expect.arrayContaining([expect.objectContaining({ field: "start_date", new_value: "2026-11-15" })]));
        await pool.query("UPDATE project_members SET role = 'viewer' WHERE project_id = 10 AND user_id = 1");
        const viewer = await request(app).get("/api/tasks").query({ scope: "calendar", project_id: 10, date: "2026-11-16" }).expect(200);
        expect(viewer.body.tasks[0].capabilities.can.edit.allowed).toBe(false);
        await request(app).put(`/api/tasks/${created.id}`).send({ due_date: "2026-11-20" }).expect(403);
        for (const query of [
            { scope: "calendar", project_id: 10 }, { scope: "list" },
            { scope: "calendar", project_id: 10, start_date: "2026-11-12", end_date: "2026-11-01" },
            { scope: "calendar", project_id: 10, date: "2026-02-30" },
        ]) await request(app).get("/api/tasks").query(query).expect(400);
    });

    test("continuous board includes all project work, recent Done only, and never Cancelled", async () => {
        const open = await ticket("Open with dates", "pending");
        await pool.query("UPDATE tasks SET start_date = '2026-01-01', planned_date = '2026-01-01' WHERE id = $1", [open]);
        const recent = await ticket("Recent done", "done");
        const old = await ticket("Old done", "done");
        await pool.query("ALTER TABLE tasks DISABLE TRIGGER trg_tasks_completed_at_from_workflow_state");
        await pool.query("UPDATE tasks SET completed_at = NOW() - INTERVAL '15 days' WHERE id = $1", [old]);
        await pool.query("ALTER TABLE tasks ENABLE TRIGGER trg_tasks_completed_at_from_workflow_state");
        await ticket("Cancelled", "cancelled");
        await ticket("Other project", "in_progress", 20);
        const board = await request(app).get("/api/projects/10/board");
        expect(board.status).toBe(200);
        expect(board.body.tickets.map((row: any) => row.id).sort()).toEqual([open, recent].sort());
        expect(board.body.columns.find((column: any) => column.stateId === states.done)).toMatchObject({ count: 1 });
        expect(board.body.columns.some((column: any) => column.stateId === states.cancelled)).toBe(false);
        expect(board.body.tickets[0].capabilities.can.placeInSprint).toMatchObject({ allowed: false, reason: "PROJECT_HAS_NO_SPRINTS" });
    });

    test("project admin toggles the optional backlog without moving tickets or dates", async () => {
        const initial = await ticket("To plan", "pending");
        const started = await ticket("Started", "in_progress");
        expect((await request(app).get("/api/projects/10")).body.kanban_backlog_enabled).toBe(false);
        const saved = await request(app).patch("/api/projects/10/board-settings")
            .send({ kanban_backlog_enabled: true, enable_wip_limits: true });
        expect(saved.status).toBe(200);
        expect(saved.body).toMatchObject({ kanban_backlog_enabled: true, enable_wip_limits: true, planTabs: ["backlog", "board"] });
        const board = await request(app).get("/api/projects/10/board");
        expect(board.body.tickets.map((row: any) => row.id)).toEqual([started]);
        expect(board.body.columns.some((column: any) => column.stateId === states.pending)).toBe(false);
        const backlog = await request(app).get("/api/projects/10/backlog");
        expect(backlog.status).toBe(200);
        expect(backlog.body.tickets.map((row: any) => row.id)).toEqual([initial]);
        await request(app).patch("/api/projects/10/board-settings").send({ kanban_backlog_enabled: false });
        expect((await request(app).get("/api/projects/10/board")).body.tickets).toHaveLength(2);
        expect((await request(app).get("/api/projects/10/backlog")).body.code).toBe("PROJECT_HAS_NO_BACKLOG");
    });

    test("project WIP switch is authoritative; full moves report the board count and limit", async () => {
        await request(app).patch("/api/projects/10/board-settings").send({ enable_wip_limits: true });
        await pool.query("UPDATE org_agile_settings SET enable_wip_limits = FALSE WHERE org_id = 1");
        await pool.query("UPDATE workflow_states SET wip_limit = 1 WHERE id = $1", [states.in_progress]);
        const first = await ticket("First", "pending");
        const second = await ticket("Second", "pending");
        await ticket("Other project occupant", "in_progress", 20);
        const moved = await request(app).patch(`/api/tasks/${first}/status`).send({ workflow_state_id: states.in_progress });
        expect(moved.status).toBe(200);
        const board = await request(app).get("/api/projects/10/board");
        expect(board.body.columns.find((column: any) => column.stateId === states.in_progress))
            .toMatchObject({ count: 1, limit: 1, accepting: false });
        expect(board.body.tickets.find((row: any) => row.id === second).capabilities.transitions
            .find((transition: any) => transition.to === states.in_progress).allowed).toBe(true);
        const refused = await request(app).patch(`/api/tasks/${second}/status`).send({ workflow_state_id: states.in_progress });
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({ code: "WIP_EXCEEDED", occupancy: 1, wip_limit: 1 });
        expect(refused.body.error).toContain("1/1");
        await request(app).patch("/api/projects/10/board-settings").send({ enable_wip_limits: false });
        await pool.query("UPDATE org_agile_settings SET enable_wip_limits = TRUE WHERE org_id = 1");
        expect((await request(app).patch(`/api/tasks/${second}/status`).send({ workflow_state_id: states.in_progress })).status).toBe(200);
    });

    test("Scrum board and WIP count the current sprint only; the sprint read uses the same window", async () => {
        await pool.query("UPDATE projects SET type = 'scrum', enable_wip_limits = TRUE WHERE id = 10");
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status) VALUES
            (100, 10, 'Current', '2026-11-01', '2026-11-14', 'active'),
            (101, 10, 'Next', '2026-11-15', '2026-11-28', 'planned')`);
        await pool.query("UPDATE workflow_states SET wip_limit = 1 WHERE id = $1", [states.in_progress]);
        const next = await ticket("Next sprint occupancy", "in_progress");
        const unsprinted = await ticket("Backlog occupancy", "in_progress");
        const current = await ticket("Current", "pending");
        await pool.query("UPDATE tasks SET sprint_id = 101 WHERE id = $1", [next]);
        await pool.query("UPDATE tasks SET sprint_id = 100 WHERE id = $1", [current]);
        expect((await request(app).patch(`/api/tasks/${current}/status`).send({ workflow_state_id: states.in_progress })).status).toBe(200);
        const board = await request(app).get("/api/projects/10/board");
        const legacy = await request(app).get("/api/sprints/100/board");
        expect(board.body.tickets.map((row: any) => row.id)).toEqual([current]);
        expect(board.body.tickets[0].sprint_end_date).toBe("2026-11-14");
        expect(legacy.body.columns.find((column: any) => column.stateId === states.in_progress))
            .toMatchObject({ count: 1, limit: 1, accepting: false });
        expect(legacy.body.tickets).toEqual(board.body.tickets);
        const selected = await request(app).get("/api/projects/10/board?sprint_id=101");
        expect(selected.body.tickets.map((row: any) => row.id)).toEqual([next]);
        expect((await request(app).get("/api/projects/10/backlog")).body.tickets.map((row: any) => row.id)).toEqual([unsprinted]);
    });

    test("concurrent moves cannot overfill the last slot", async () => {
        await request(app).patch("/api/projects/10/board-settings").send({ enable_wip_limits: true });
        await pool.query("UPDATE workflow_states SET wip_limit = 1 WHERE id = $1", [states.in_progress]);
        const ids = await Promise.all([ticket("A", "pending"), ticket("B", "pending")]);
        // A slow database write makes simultaneous requests overlap reliably.
        await pool.query(`CREATE OR REPLACE FUNCTION board_test_slow_write() RETURNS trigger AS $$
            BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END; $$ LANGUAGE plpgsql;
            CREATE TRIGGER board_test_slow_write BEFORE UPDATE OF workflow_state_id ON tasks
            FOR EACH ROW EXECUTE FUNCTION board_test_slow_write()`);
        try {
            const moves = await Promise.all(ids.map((id) => request(app).patch(`/api/tasks/${id}/status`).send({ workflow_state_id: states.in_progress })));
            expect(moves.map((result: any) => result.status).sort()).toEqual([200, 409]);
            expect(moves.find((result: any) => result.status === 409).body).toMatchObject({ code: "WIP_EXCEEDED", occupancy: 1, wip_limit: 1 });
        } finally { await pool.query("DROP TRIGGER board_test_slow_write ON tasks; DROP FUNCTION board_test_slow_write()"); }
    });

    test("project viewers may read but not configure; inaccessible and foreign projects stay private", async () => {
        await pool.query("UPDATE project_members SET role = 'viewer' WHERE project_id = 10");
        expect((await request(app).get("/api/projects/10/board")).status).toBe(200);
        expect((await request(app).patch("/api/projects/10/board-settings").send({ enable_wip_limits: true })).status).toBe(403);
        expect((await request(app).get("/api/projects/20/board")).status).toBe(404);
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Foreign', 'foreign')");
        await pool.query("INSERT INTO projects (id, org_id, key, name, type) VALUES (30, 2, 'FOREIGN', 'Foreign', 'kanban')");
        expect((await request(app).get("/api/projects/30/board")).status).toBe(404);
        expect((await request(app).get("/api/projects/10/board?sprint_id=1")).body.code).toBe("PROJECT_HAS_NO_SPRINTS");
        expect((await request(app).post("/api/sprints").send({ project_id: 10, name: "No", start_date: "2026-11-01", end_date: "2026-11-14" })).body.code).toBe("PROJECT_HAS_NO_SPRINTS");
    });

    test("settings reject malformed inputs, archived writes and non-Kanban backlog switches", async () => {
        for (const body of [{ enable_wip_limits: "true" }, { kanban_backlog_enabled: 1 }, { unknown: true }]) {
            expect((await request(app).patch("/api/projects/10/board-settings").send(body)).status).toBe(400);
        }
        await pool.query("UPDATE projects SET type = 'task_list' WHERE id = 10");
        expect((await request(app).patch("/api/projects/10/board-settings").send({ kanban_backlog_enabled: true })).body.code).toBe("PROJECT_HAS_NO_KANBAN_BACKLOG");
        await pool.query("UPDATE projects SET is_archived = TRUE WHERE id = 10");
        expect((await request(app).patch("/api/projects/10/board-settings").send({ enable_wip_limits: true })).body.code).toBe("PROJECT_ARCHIVED");
        expect((await request(app).get("/api/projects/10/board")).body.project.capabilities.canCreateTickets).toBe(false);
    });

    test("Task list uses the same continuous board, including dated and undated work", async () => {
        await pool.query("UPDATE projects SET type = 'task_list', enable_wip_limits = TRUE WHERE id = 10");
        const undated = await ticket("Undated", "pending");
        const dated = await ticket("Dated", "in_progress");
        await pool.query("UPDATE tasks SET start_date = '2026-01-01', due_date = '2026-12-01' WHERE id = $1", [dated]);
        const board = await request(app).get("/api/projects/10/board");
        expect(board.body.tickets.map((row: any) => row.id)).toEqual([undated, dated]);
        expect(board.body.project.planTabs).toEqual(["list", "board", "calendar"]);
        expect((await request(app).get("/api/projects/10/backlog")).body.code).toBe("PROJECT_HAS_NO_BACKLOG");
    });

    test("migration copies org WIP once and preserves subsequent project choices on replay", async () => {
        const migration = require("fs").readFileSync(require("path").join(__dirname, "../platform/db/migrations/0030_project_board_settings.sql"), "utf8");
        await pool.query("UPDATE org_agile_settings SET enable_wip_limits = TRUE WHERE org_id = 1");
        await pool.query("ALTER TABLE projects DROP COLUMN enable_wip_limits");
        await pool.query(migration);
        const read = await request(app).get("/api/projects/10/board");
        expect(read.body.project.enable_wip_limits).toBe(true);
        await request(app).patch("/api/projects/10/board-settings").send({ enable_wip_limits: false });
        await pool.query(migration);
        expect((await request(app).get("/api/projects/10/board")).body.project.enable_wip_limits).toBe(false);
    });
});
