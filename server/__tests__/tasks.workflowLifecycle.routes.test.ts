export {};

/**
 * The enforced lifecycle at the HTTP boundary.
 *
 * The graph unit tests prove the rules; these mount the real routers and prove
 * every write path applies them: PATCH status, the full update, bulk, and
 * cancel. They also pin the side effects — a per-ticket bulk result, a status
 * notification for the assignee and reporter only, and the realtime frame
 * reaching the owning team.
 */

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn() },
    requestLogger: (req: any, _res: any, next: any) => {
        req.id = "test";
        req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        next();
    },
}));

jest.mock("../utils/mailer", () => ({
    getTransporter: jest.fn(() => null),
    sendMail: jest.fn(),
    notifyByEmail: jest.fn(),
    esc: (s: any) => String(s ?? ""),
}));

jest.mock("../utils/ws", () => ({
    setupWebSocket: jest.fn(),
    sendToUser: jest.fn(),
    broadcast: jest.fn(),
    notifyUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../realtime/fanout", () => ({
    INSTANCE_ID: "test-instance",
    deliverLocal: jest.fn(),
    sendToUser: jest.fn(),
    broadcast: jest.fn(),
    broadcastLocal: jest.fn(),
    notifyUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/audit", () => ({
    logAction: jest.fn(),
    queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");

const mockQuery: jest.Mock = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockTxClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
const mockTransaction: jest.Mock = jest.fn(async (fn: any) => fn(mockTxClient));

jest.mock("../db", () => ({
    pool: { end: jest.fn() },
    query: (...args: any[]) => mockQuery(...args),
    masterQuery: (...args: any[]) => mockQuery(...args),
    masterTransaction: (...args: any[]) => mockTransaction(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
    initDB: jest.fn(),
}));

const { app } = require("../index");
const fanout = require("../realtime/fanout");
const ws = require("../utils/ws");
const { logAction } = require("../utils/audit");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

// ── Workflow fixture ────────────────────────────────────────────────────────

const PENDING = { id: 10, key: "pending", name: "New", category: "open", is_initial: true, is_terminal: false, sort_order: 1, wip_limit: null };
const IN_PROGRESS = { id: 11, key: "in_progress", name: "In Progress", category: "in_progress", is_initial: false, is_terminal: false, sort_order: 2, wip_limit: 1 };
const IN_REVIEW = { id: 12, key: "in_review", name: "In Review", category: "in_review", is_initial: false, is_terminal: false, sort_order: 3, wip_limit: null };
const DONE = { id: 13, key: "done", name: "Done", category: "done", is_initial: false, is_terminal: true, sort_order: 4, wip_limit: null };
const CANCELLED = { id: 14, key: "cancelled", name: "Cancelled", category: "done", is_initial: false, is_terminal: true, sort_order: 5, wip_limit: null };
const STATES = [PENDING, IN_PROGRESS, IN_REVIEW, DONE, CANCELLED];

let tasksById: Record<number, any>;
let wipEnabled: boolean;
let teamMembers: number[];

function makeTask(overrides: Record<string, any> = {}) {
    return {
        id: 77,
        title: "Refund webhook retries",
        user_id: 4,
        assigned_to: 2,
        org_id: 1,
        team_id: 1,
        sprint_id: null,
        workflow_state_id: PENDING.id,
        completed_at: null,
        priority: "medium",
        is_blocked: false,
        acceptance_criteria: null,
        project_id: null,
        task_number: null,
        story_points: null,
        work_item_type_id: null,
        parent_task_id: null,
        blocked_reason: null,
        planned_date: null,
        due_date: null,
        created_at: "2026-10-01",
        ...overrides,
    };
}

function rows(values: any[]) {
    return { rows: values, rowCount: values.length };
}

function occupancyOf(stateId: number, excludeTaskId: number) {
    return Object.values(tasksById).filter(
        (task) => Number(task.workflow_state_id) === Number(stateId) && Number(task.id) !== Number(excludeTaskId),
    ).length;
}

/** Answer each query by shape so auth, policy and the route see their rows. */
function routeQueries() {
    mockQuery.mockImplementation(async (sql: string, params: any[] = []) => {
        const text = String(sql).replace(/\s+/g, " ").trim();

        // Auth / context
        if (/FROM app_settings/.test(text)) return rows([{ value: "false" }]);
        if (/SELECT token_version FROM users/.test(text)) return rows([{ token_version: 0 }]);
        if (/SELECT role, org_id, team_id/.test(text)) {
            return rows([{ role: "employee", org_id: 1, team_id: 1, department_id: 1, manager_id: null, is_active: true }]);
        }

        // Workflow catalog
        if (/FROM workflow_states/.test(text)) {
            if (/key = 'cancelled'/.test(text)) return rows([CANCELLED]);
            if (/WHERE id = \$1 AND org_id = \$2/.test(text)) {
                return rows(STATES.filter((state) => state.id === Number(params[0])));
            }
            if (/WHERE key = \$1 AND org_id = \$2/.test(text)) {
                return rows(STATES.filter((state) => state.key === params[0]));
            }
            return rows(STATES);
        }
        if (/FROM workflow_transitions/.test(text)) return rows([]);
        if (/FROM org_agile_settings/.test(text)) return rows([{ enable_wip_limits: wipEnabled }]);

        // Tickets
        if (/COUNT\(\*\)::int AS c FROM tasks/.test(text)) {
            return rows([{ c: occupancyOf(Number(params[0]), Number(params[1])) }]);
        }
        if (/FROM tasks WHERE id = ANY/.test(text)) {
            const wanted = (params[0] ?? []) as number[];
            // Rows are separate objects from the stored table, as a real
            // SELECT returns snapshots rather than live references.
            return rows(wanted.map((id) => tasksById[id]).filter(Boolean).map((task) => ({ ...task })));
        }
        if (/UPDATE tasks SET workflow_state_id = \$1/.test(text)) {
            const task = tasksById[Number(params[1])];
            if (task) {
                task.workflow_state_id = Number(params[0]);
                task.completed_at = [DONE.id, CANCELLED.id].includes(Number(params[0]))
                    ? "2026-10-27T10:00:00.000Z"
                    : null;
            }
            return rows([]);
        }
        if (/SELECT \* FROM tasks WHERE id = \$1/.test(text)) {
            const task = tasksById[Number(params[0])];
            return task ? rows([{ ...task }]) : rows([]);
        }
        if (/INSERT INTO task_history/.test(text)) return rows([]);

        // People
        if (/FROM users WHERE team_id = \$1/.test(text)) {
            return rows(teamMembers.map((id) => ({ id })));
        }
        if (/SELECT full_name, username FROM users WHERE id = \$1/.test(text)) {
            return rows([{ full_name: `User ${params[0]}`, username: `user${params[0]}` }]);
        }

        return rows([]);
    });
}

function send(method: "patch" | "put" | "delete" | "post", url: string, userId = 1, body?: unknown) {
    const req = request(app)[method](url).set(CSRF).set("Cookie", authCookie(userId));
    return body === undefined ? req : req.send(body as any);
}

function taskUpdatedRecipients(): number[] {
    return (ws.sendToUser as jest.Mock).mock.calls
        .filter((call: any[]) => call[2] === "task_updated")
        .map((call: any[]) => Number(call[1]));
}

function notifiedUserIds(): number[] {
    return (fanout.notifyUser as jest.Mock).mock.calls.map((call: any[]) => Number(call[2]));
}

beforeEach(() => {
    tasksById = { 77: makeTask() };
    wipEnabled = false;
    teamMembers = [];
    mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    (ws.sendToUser as jest.Mock).mockClear();
    (fanout.notifyUser as jest.Mock).mockClear();
    (logAction as jest.Mock).mockClear();
    routeQueries();
});

// ── PATCH /:id/status ───────────────────────────────────────────────────────

describe("PATCH /api/tasks/:id/status applies the transition graph", () => {
    test.each([
        ["pending → in progress", PENDING.id, "in_progress"],
        ["in progress → done", IN_PROGRESS.id, "done"],
        ["in progress → new (back)", IN_PROGRESS.id, "pending"],
        ["in review → done", IN_REVIEW.id, "done"],
        ["done → in progress (reopen)", DONE.id, "in_progress"],
    ])("%s is accepted", async (_label, from, target) => {
        tasksById[77] = makeTask({ workflow_state_id: from, completed_at: from === DONE.id ? "2026-10-20" : null });

        const res = await send("patch", "/api/tasks/77/status", 1, { status: target });

        expect(res.status).toBe(200);
        const updates = mockQuery.mock.calls.filter(([sql]: any[]) => /UPDATE tasks SET workflow_state_id/.test(String(sql)));
        expect(updates).toHaveLength(1);
    });

    test.each([
        ["new → done", PENDING.id, "done"],
        ["new → in review", PENDING.id, "in_review"],
        ["review → new", IN_REVIEW.id, "pending"],
        ["done → cancelled", DONE.id, "cancelled"],
        ["cancelled → in progress", CANCELLED.id, "in_progress"],
    ])("%s is refused with a stable code", async (_label, from, target) => {
        tasksById[77] = makeTask({
            workflow_state_id: from,
            completed_at: [DONE.id, CANCELLED.id].includes(from) ? "2026-10-20" : null,
        });

        const res = await send("patch", "/api/tasks/77/status", 1, { status: target });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: "INVALID_TRANSITION", to_state_id: expect.any(Number) });
        expect(res.body.error).toMatch(/cannot move to/);
        const updates = mockQuery.mock.calls.filter(([sql]: any[]) => /UPDATE tasks SET workflow_state_id/.test(String(sql)));
        expect(updates).toHaveLength(0);
    });

    test("the refusal names the legal alternatives", async () => {
        const res = await send("patch", "/api/tasks/77/status", 1, { status: "done" });

        expect(res.status).toBe(409);
        expect(res.body.error).toContain('"New"');
        expect(res.body.error).toContain('"Done"');
        expect(res.body.error).toContain("In Progress");
    });

    test("a re-entered state does not write a history row", async () => {
        tasksById[77] = makeTask({ workflow_state_id: IN_PROGRESS.id });

        const res = await send("patch", "/api/tasks/77/status", 1, { status: "in_progress" });

        expect(res.status).toBe(200);
        const history = mockQuery.mock.calls.filter(([sql]: any[]) => /INSERT INTO task_history/.test(String(sql)));
        expect(history).toHaveLength(0);
    });
});

// ── WIP ─────────────────────────────────────────────────────────────────────

describe("WIP limits hard-block on every write path", () => {
    beforeEach(() => {
        wipEnabled = true;
        tasksById[78] = makeTask({ id: 78, workflow_state_id: IN_PROGRESS.id }); // fills the 1-slot column
    });

    test("PATCH refuses a full destination column", async () => {
        const res = await send("patch", "/api/tasks/77/status", 1, { status: "in_progress" });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: "WIP_EXCEEDED", wip_limit: 1, occupancy: 1 });
        expect(res.body.error).toMatch(/WIP limit reached for "In Progress"/);
    });

    test("PUT refuses a full destination column", async () => {
        const res = await send("put", "/api/tasks/77", 1, { workflow_state_id: IN_PROGRESS.id });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: "WIP_EXCEEDED" });
    });

    test("bulk skips the ticket that no longer fits and applies the rest", async () => {
        // Both start in New; the column holds one, so the first move fills it
        // and the second is skipped.
        tasksById[78] = makeTask({ id: 78, workflow_state_id: PENDING.id });

        const res = await send("post", "/api/tasks/bulk", 1, {
            ids: [77, 78],
            action: "status",
            value: "in_progress",
        });

        expect(res.status).toBe(200);
        const byId = Object.fromEntries((res.body.results as any[]).map((r) => [r.id, r]));
        expect(byId[77]).toMatchObject({ ok: true });
        expect(byId[78]).toMatchObject({ ok: false, code: "WIP_EXCEEDED" });
        expect(res.body).toMatchObject({ requested: 2, changed: 1, failed: 1 });
    });

    test("create is exempt from WIP", async () => {
        // A create has no "from" state; the lifecycle helper must not run.
        const res = await send("post", "/api/tasks", 1, { title: "Fresh" });
        expect(res.status).not.toBe(409);
    });
});

// ── PUT /:id ────────────────────────────────────────────────────────────────

describe("PUT /api/tasks/:id applies the same graph", () => {
    test.each([
        ["pending → in progress", PENDING.id, IN_PROGRESS.id],
        ["in progress → done", IN_PROGRESS.id, DONE.id],
        ["in progress → new (back)", IN_PROGRESS.id, PENDING.id],
        ["in review → done", IN_REVIEW.id, DONE.id],
        ["done → in progress (reopen)", DONE.id, IN_PROGRESS.id],
    ])("%s is accepted", async (_label, from, target) => {
        tasksById[77] = makeTask({ workflow_state_id: from, completed_at: from === DONE.id ? "2026-10-20" : null });

        const res = await send("put", "/api/tasks/77", 1, { workflow_state_id: target });

        expect(res.status).toBe(200);
    });

    test.each([
        ["new → done", PENDING.id, DONE.id],
        ["new → in review", PENDING.id, IN_REVIEW.id],
        ["review → new", IN_REVIEW.id, PENDING.id],
        ["done → cancelled", DONE.id, CANCELLED.id],
        ["cancelled → in progress", CANCELLED.id, IN_PROGRESS.id],
    ])("%s is refused", async (_label, from, target) => {
        tasksById[77] = makeTask({
            workflow_state_id: from,
            completed_at: [DONE.id, CANCELLED.id].includes(from) ? "2026-10-20" : null,
        });

        const res = await send("put", "/api/tasks/77", 1, { workflow_state_id: target });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: "INVALID_TRANSITION" });
    });

    test("an illegal state change is refused", async () => {
        const res = await send("put", "/api/tasks/77", 1, { workflow_state_id: DONE.id });

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: "INVALID_TRANSITION" });
        const updates = mockQuery.mock.calls.filter(([sql]: any[]) => /UPDATE tasks SET title/.test(String(sql)));
        expect(updates).toHaveLength(0);
    });

    test("a legal state change is accepted and audited", async () => {
        const res = await send("put", "/api/tasks/77", 1, { workflow_state_id: IN_PROGRESS.id });

        expect(res.status).toBe(200);
        expect(logAction).toHaveBeenCalledWith(
            expect.anything(), "update", "task", 77,
            expect.objectContaining({ field: "workflow_state", to: IN_PROGRESS.id }),
        );
    });
});

// ── Bulk ────────────────────────────────────────────────────────────────────

describe("POST /api/tasks/bulk reports a per-ticket result", () => {
    test("applies the legal ticket and skips the illegal one", async () => {
        tasksById[78] = makeTask({ id: 78, workflow_state_id: IN_PROGRESS.id });

        const res = await send("post", "/api/tasks/bulk", 1, {
            ids: [77, 78],
            action: "status",
            value: "done",
        });

        expect(res.status).toBe(200);
        const byId = Object.fromEntries((res.body.results as any[]).map((r) => [r.id, r]));
        // 77 is New → Done (illegal); 78 is In Progress → Done (legal).
        expect(byId[77]).toMatchObject({ ok: false, code: "INVALID_TRANSITION" });
        expect(byId[77].error).toMatch(/cannot move to "Done"/);
        expect(byId[78]).toMatchObject({ ok: true, previous: { workflow_state_id: IN_PROGRESS.id } });
        expect(res.body).toMatchObject({ requested: 2, changed: 1, failed: 1 });
    });

    test("cancel skips a done ticket and reports the stable code", async () => {
        tasksById[78] = makeTask({
            id: 78,
            workflow_state_id: DONE.id,
            completed_at: "2026-10-20T10:00:00.000Z",
        });

        const res = await send("post", "/api/tasks/bulk", 1, { ids: [77, 78], action: "delete" });

        const byId = Object.fromEntries((res.body.results as any[]).map((r) => [r.id, r]));
        expect(byId[77]).toMatchObject({ ok: true });
        expect(byId[78]).toMatchObject({ ok: false, code: "TASK_COMPLETED" });
    });
});

// ── Cancel ──────────────────────────────────────────────────────────────────

describe("DELETE /api/tasks/:id cancels through the lifecycle", () => {
    test("any owning-team member may cancel", async () => {
        tasksById[77] = makeTask({ user_id: 900, assigned_to: null });

        const res = await send("delete", "/api/tasks/77", 1);

        expect(res.status).toBe(200);
        expect(tasksById[77].workflow_state_id).toBe(CANCELLED.id);
        const sqls = mockQuery.mock.calls.map(([sql]: any[]) => String(sql));
        expect(sqls.some((sql) => /DELETE\s+FROM\s+tasks/i.test(sql))).toBe(false);
    });

    test.each([
        ["done", DONE.id],
        ["cancelled", CANCELLED.id],
    ])("a %s ticket is refused with TASK_COMPLETED", async (_label, stateId) => {
        tasksById[77] = makeTask({ workflow_state_id: stateId, completed_at: "2026-10-20T10:00:00.000Z" });

        const res = await send("delete", "/api/tasks/77", 1);

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: "TASK_COMPLETED" });
    });

    test("cancel records history and audit", async () => {
        const res = await send("delete", "/api/tasks/77", 1);

        expect(res.status).toBe(200);
        const history = mockQuery.mock.calls.map(([sql]: any[]) => String(sql));
        expect(history.some((sql) => /INSERT INTO task_history/.test(sql))).toBe(true);
        expect(logAction).toHaveBeenCalledWith(expect.anything(), "cancel", "task", 77, expect.anything());
    });
});

// ── Notifications and realtime ──────────────────────────────────────────────

describe("cancelled visibility", () => {
    test("the board query excludes cancelled tickets", async () => {
        const { listSprintTasks } = require("../modules/tasks/tasks.collection");
        const db = { query: jest.fn().mockResolvedValue({ rows: [] }) };

        await listSprintTasks(db, 1, 5, { kind: "org-admin" });

        const sql = String(db.query.mock.calls[0][0]);
        expect(sql).toMatch(/NOT EXISTS/);
        expect(sql).toMatch(/key = 'cancelled'/);
    });

    test("a cancelled ticket stays reachable in detail", async () => {
        tasksById[77] = makeTask({
            workflow_state_id: CANCELLED.id,
            completed_at: "2026-10-20T10:00:00.000Z",
        });

        const res = await request(app)
            .get("/api/tasks/77/detail")
            .set(CSRF)
            .set("Cookie", authCookie(1));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: 77, workflow_state_id: CANCELLED.id });
    });
});

describe("status transitions notify and fan out to the right people", () => {
    test("notifies the assignee and reporter, never the actor", async () => {
        tasksById[77] = makeTask({ user_id: 4, assigned_to: 2 });

        const res = await send("patch", "/api/tasks/77/status", 3, { status: "in_progress" });

        expect(res.status).toBe(200);
        expect(notifiedUserIds().sort()).toEqual([2, 4]);
    });

    test("the realtime frame reaches the owning team", async () => {
        teamMembers = [10, 11];
        tasksById[77] = makeTask({ user_id: 4, assigned_to: 2 });

        const res = await send("patch", "/api/tasks/77/status", 3, { status: "in_progress" });

        expect(res.status).toBe(200);
        const recipients = taskUpdatedRecipients();
        for (const userId of [2, 3, 4, 10, 11]) {
            expect(recipients).toContain(userId);
        }
    });

    test("cancel notifies the assignee and reporter and the team sees it move", async () => {
        teamMembers = [10];
        tasksById[77] = makeTask({ user_id: 4, assigned_to: 2 });

        const res = await send("delete", "/api/tasks/77", 3);

        expect(res.status).toBe(200);
        expect(notifiedUserIds().sort()).toEqual([2, 4]);
        expect(taskUpdatedRecipients()).toEqual(expect.arrayContaining([2, 4, 3, 10]));
    });
});
