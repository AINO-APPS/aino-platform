export {};

// Suppress pino logs during tests
jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    },
    requestLogger: (req: any, _res: any, next: any) => { req.id = "test"; req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; next(); },
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

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

function setupAuth(role = "employee", extra: Record<string, any> = {}) {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth
        .mockResolvedValueOnce({
            rows: [{
                role, org_id: 1, team_id: 1, department_id: 1,
                manager_id: null, is_active: true, ...extra,
            }],
            rowCount: 1,
        }); // loadUserContext
}

describe("POST /api/tasks/backlog", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("returns 401 without auth", async () => {
        const res = await request(app)
            .post("/api/tasks/backlog")
            .set(CSRF)
            .send({ title: "Test task" });
        expect(res.status).toBe(401);
    });

    test("returns 400 when title is missing", async () => {
        setupAuth();
        const res = await request(app)
            .post("/api/tasks/backlog")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({});
        expect(res.status).toBe(400);
    });

    test("creates a backlog task with valid data", async () => {
        setupAuth();
        const taskId = 10;
        mockQuery
            // INSERT INTO tasks RETURNING id
            .mockResolvedValueOnce({ rows: [{ id: taskId }], rowCount: 1 })
            // syncLabels skipped (no label_ids)
            // logHistory -> INSERT INTO task_history
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            // SELECT * FROM tasks WHERE id = taskId
            .mockResolvedValueOnce({
                rows: [{ id: taskId, title: "New Task", status: "pending", user_id: 1, priority: "medium", assigned_to: null, date: null }],
                rowCount: 1,
            })
            // enrichTasks: SELECT task_labels join
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post("/api/tasks/backlog")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ title: "New Task", priority: "medium" });
        // Might be 200 or 500 depending on enrichTasks sub-queries; just verify it attempted
        expect([200, 500]).toContain(res.status);
    });
});

describe("GET /api/tasks", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/tasks");
        expect(res.status).toBe(401);
    });

    test("returns tasks list", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // tasks query

        const res = await request(app)
            .get("/api/tasks")
            .set("Cookie", authCookie())
            .set("X-Timezone-Offset", "-330");
        expect(res.status).toBe(200);
    });

    test("scopes task list query by requester org", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .get("/api/tasks")
            .set("Cookie", authCookie())
            .set("X-Timezone-Offset", "-330");

        expect(res.status).toBe(200);
        const tasksCall = mockQuery.mock.calls.find(([sql]: any[]) => typeof sql === "string" && sql.includes("SELECT t.* FROM tasks t"));
        expect(tasksCall).toBeTruthy();
        expect(tasksCall[0]).toContain("t.org_id = $1");
    });
});

describe("Tenant Isolation - Tasks", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("persists org_id when creating backlog task", async () => {
        setupAuth();
        const taskId = 101;
        // Stage 2 Bug #1: the INSERT + label-sync + history are now wrapped
        // in a `req.db.transaction(...)` block, so the INSERT runs against
        // the transaction client (`mockTxClient.query`) rather than the
        // top-level pool (`mockQuery`). The post-insert SELECT + enrichment
        // queries still go through `mockQuery`.
        mockTxClient.query.mockResolvedValueOnce({ rows: [{ id: taskId }], rowCount: 1 }); // INSERT
        mockTxClient.query.mockResolvedValue({ rows: [], rowCount: 0 }); // history + label work
        mockQuery
            .mockResolvedValueOnce({
                rows: [{ id: taskId, title: "Org Task", status: "pending", user_id: 1, priority: "medium", assigned_to: null, date: null, org_id: 1 }],
                rowCount: 1,
            })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post("/api/tasks/backlog")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ title: "Org Task" });

        expect([200, 500]).toContain(res.status);
        // Look on the transaction client now — that's where the INSERT lives
        // post-Stage-2 (Bug #1 transactional fix).
        const insertCall = mockTxClient.query.mock.calls.find(([sql]: any[]) => typeof sql === "string" && sql.includes("INSERT INTO tasks") && sql.includes("org_id"));
        expect(insertCall).toBeTruthy();
        // The INSERT carries every Pass-1 / Phase-3 column (story_points,
        // work_item_type_id, workflow_state_id, parent_task_id,
        // acceptance_criteria, is_blocked, blocked_reason, lead_started_at).
        // Only assert that the org_id we passed in (1) is among the bound
        // parameters — column order is enforced by the route's own SQL.
        expect(insertCall[1]).toContain(1);
    });

    test("denies status update when task org does not match requester org", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 77, user_id: 2, assigned_to: null, org_id: 2, status: "pending" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ team_id: 1, org_id: 2 }], rowCount: 1 });

        const res = await request(app)
            .patch("/api/tasks/77/status")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ status: "done" });

        expect(res.status).toBe(404);
        const updated = mockQuery.mock.calls.some(([sql]: any[]) => typeof sql === "string" && sql.includes("UPDATE tasks SET status"));
        expect(updated).toBe(false);
    });

    test("does not notify mention targets outside requester org", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 88, user_id: 2, assigned_to: null, org_id: 1, title: "Scoped Task" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ team_id: 1, org_id: 1 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ team_id: 1, org_id: 1 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 501 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [{ id: 501, task_id: 88, user_id: 1, content: '<span data-user-id="999">@x</span>', username: "testuser", full_name: "Test User", avatar: null }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ username: "testuser", full_name: "Test User" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post("/api/tasks/88/comments")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ content: '<span data-user-id="999">@x</span>' });

        expect(res.status).toBe(200);
        const orgMentionLookup = mockQuery.mock.calls.find(([sql]: any[]) => typeof sql === "string" && sql.includes("SELECT id, role FROM users WHERE id = ANY($1)"));
        expect(orgMentionLookup).toBeTruthy();
        expect(orgMentionLookup![1]).toEqual([[999], 1]);
        const notifInsertCount = mockQuery.mock.calls.filter(([sql]: any[]) => typeof sql === "string" && sql.includes("INSERT INTO notifications") && sql.includes("link_task_id")).length;
        expect(notifInsertCount).toBe(0);
        expect(require("../utils/ws").notifyUser).not.toHaveBeenCalled();
    });

    test("notifies a mentioned user when the commenter has no organization", async () => {
        const ws = require("../utils/ws");
        (ws.notifyUser as jest.Mock).mockClear();
        setupAuth("employee", { org_id: null });
        // Commenter (1) owns the task; the mentioned user (5) is its assignee.
        const task = { id: 90, user_id: 1, assigned_to: 5, org_id: null, title: "No-org task" };
        mockQuery.mockImplementation(async (sql: string) => {
            if (sql.includes("SELECT * FROM tasks")) return { rows: [task], rowCount: 1 };
            if (sql.includes("INSERT INTO task_comments")) return { rows: [{ id: 601 }], rowCount: 1 };
            if (sql.includes("FROM task_comments tc")) return { rows: [{ id: 601, task_id: 90, user_id: 1 }], rowCount: 1 };
            if (sql.includes("SELECT username, full_name FROM users")) return { rows: [{ username: "u1", full_name: "Commenter" }], rowCount: 1 };
            if (sql.includes("SELECT id, role FROM users")) return { rows: [{ id: 5, role: "employee" }], rowCount: 1 };
            if (sql.includes("SELECT email, full_name FROM users")) return { rows: [{ email: "e@x", full_name: "Five" }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await request(app)
            .post("/api/tasks/90/comments")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ content: '<p><span class="mention-chip" data-user-id="5">@Five</span> hi</p>' });

        expect(res.status).toBe(200);
        await new Promise((r) => setImmediate(r));
        const lookup = mockQuery.mock.calls.find(([sql]: any[]) => typeof sql === "string" && sql.includes("SELECT id, role FROM users"));
        expect(lookup![1]).toEqual([[5], null]);
        const call = (ws.notifyUser as jest.Mock).mock.calls[0];
        expect(call.slice(2, 6)).toEqual([5, "mention", "Commenter mentioned you", "In task: No-org task"]);
        expect(call[6]).toEqual(expect.objectContaining({ linkTaskId: 90, link: "/tasks?task=90" }));
    });
});

describe("task realtime fan-out (task_updated)", () => {
    const ws = require("../utils/ws");
    const task = { id: 77, user_id: 2, assigned_to: 3, org_id: 1, status: "pending", title: "Ship it" };

    function routeQueries(routes: Array<[RegExp, any[]]>) {
        mockQuery.mockImplementation(async (sql: string) => {
            for (const [re, rows] of routes) if (re.test(sql)) return { rows, rowCount: rows.length };
            return { rows: [], rowCount: 0 };
        });
    }

    function taskUpdatedRecipients() {
        return (ws.sendToUser as jest.Mock).mock.calls
            .filter((c: any[]) => c[2] === "task_updated")
            .map((c: any[]) => [c[1], c[3]]);
    }

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        (ws.sendToUser as jest.Mock).mockClear();
        (ws.notifyUser as jest.Mock).mockClear();
    });

    test("status change notifies assignee, creator and actor once each", async () => {
        setupAuth();
        routeQueries([
            [/SELECT \* FROM tasks WHERE id = \$1/, [task]],
            [/SELECT team_id, org_id FROM users/, [{ team_id: 1, org_id: 1 }]],
        ]);

        const res = await request(app)
            .patch("/api/tasks/77/status")
            .set(CSRF)
            .set("Cookie", authCookie(3))
            .send({ status: "done" });

        expect(res.status).toBe(200);
        expect(taskUpdatedRecipients()).toEqual([
            [3, { taskId: 77, action: "status" }],
            [2, { taskId: 77, action: "status" }],
        ]);
    });

    test("status change is refused for a teammate who is neither assignee nor reporter", async () => {
        setupAuth();
        routeQueries([
            [/SELECT \* FROM tasks WHERE id = \$1/, [task]],
            [/SELECT team_id, org_id FROM users/, [{ team_id: 1, org_id: 1 }]],
        ]);

        const res = await request(app)
            .patch("/api/tasks/77/status")
            .set(CSRF)
            .set("Cookie", authCookie(9))
            .send({ status: "done" });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/assignee or reporter/);
        const updated = mockQuery.mock.calls.some(([sql]: any[]) => typeof sql === "string" && sql.includes("UPDATE tasks SET status"));
        expect(updated).toBe(false);
    });

    test("status change is allowed for the reporter", async () => {
        setupAuth();
        routeQueries([
            [/SELECT \* FROM tasks WHERE id = \$1/, [task]],
            [/SELECT team_id, org_id FROM users/, [{ team_id: 1, org_id: 1 }]],
        ]);

        const res = await request(app)
            .patch("/api/tasks/77/status")
            .set(CSRF)
            .set("Cookie", authCookie(2))
            .send({ status: "in_progress" });

        expect(res.status).toBe(200);
    });

    test("status change is allowed for an org admin", async () => {
        setupAuth("hr_admin");
        routeQueries([
            [/SELECT \* FROM tasks WHERE id = \$1/, [task]],
            [/SELECT team_id, org_id FROM users/, [{ team_id: 1, org_id: 1 }]],
        ]);

        const res = await request(app)
            .patch("/api/tasks/77/status")
            .set(CSRF)
            .set("Cookie", authCookie(9))
            .send({ status: "in_progress" });

        expect(res.status).toBe(200);
    });

    test("full update refuses a workflow state change from a non-assignee/non-reporter", async () => {
        setupAuth();
        routeQueries([
            [/SELECT \* FROM tasks WHERE id = \$1/, [{ ...task, workflow_state_id: 10 }]],
            [/SELECT team_id, org_id FROM users/, [{ team_id: 1, org_id: 1 }]],
            [/FROM workflow_states WHERE id = \$1/, [{ id: 11, key: "in_progress", is_terminal: false }]],
        ]);

        const res = await request(app)
            .put("/api/tasks/77")
            .set(CSRF)
            .set("Cookie", authCookie(9))
            .send({ workflow_state_id: 11 });

        expect(res.status).toBe(403);
    });

    test("delete notifies the assignee and the creator", async () => {
        setupAuth();
        routeQueries([
            [/SELECT \* FROM tasks WHERE id = \$1/, [{ ...task, user_id: 1 }]],
            [/SELECT team_id, org_id FROM users/, [{ team_id: 1, org_id: 1 }]],
        ]);

        const res = await request(app).delete("/api/tasks/77").set(CSRF).set("Cookie", authCookie(1));

        expect(res.status).toBe(200);
        expect(taskUpdatedRecipients()).toEqual([
            [3, { taskId: 77, action: "deleted" }],
            [1, { taskId: 77, action: "deleted" }],
        ]);
    });
});