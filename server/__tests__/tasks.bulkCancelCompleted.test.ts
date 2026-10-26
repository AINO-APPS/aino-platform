export {};

/**
 * A bulk cancel must not rewrite finished work.
 *
 * The single-ticket route refuses to cancel a ticket that already reached a
 * terminal state. The bulk route is the other way into the same action, so it
 * has to apply the same rule — otherwise selecting a mixed batch silently
 * re-states completed tickets as cancelled.
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

const openTask = {
    id: 10, title: "Open work", user_id: 1, assigned_to: null, org_id: 1,
    sprint_id: null, workflow_state_id: 11, completed_at: null,
};
const doneTask = {
    id: 11, title: "Finished work", user_id: 1, assigned_to: null, org_id: 1,
    sprint_id: null, workflow_state_id: 12, completed_at: "2026-10-20T10:00:00.000Z",
};

/** Answer each query by shape so auth and the route see the rows they expect. */
function routeQueries(tasks: any[]) {
    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
        if (/FROM app_settings/.test(sql)) return { rows: [{ value: "false" }], rowCount: 1 };
        if (/SELECT token_version FROM users/.test(sql)) return { rows: [{ token_version: 0 }], rowCount: 1 };
        if (/SELECT role, org_id, team_id/.test(sql)) {
            return {
                rows: [{ role: "employee", org_id: 1, team_id: 1, department_id: 1, manager_id: null, is_active: true }],
                rowCount: 1,
            };
        }
        if (/FROM tasks WHERE id = ANY/.test(sql)) {
            const wanted = (params?.[0] ?? []) as number[];
            const rows = tasks.filter((t) => wanted.includes(t.id));
            return { rows, rowCount: rows.length };
        }
        if (/FROM workflow_states/.test(sql)) {
            const rows = [{ id: 99, key: "cancelled", name: "Cancelled", category: "done", is_terminal: true }];
            return { rows, rowCount: rows.length };
        }
        return { rows: [], rowCount: 0 };
    });
}

describe("POST /api/tasks/bulk cancel", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("cancels the open ticket and refuses the completed one", async () => {
        routeQueries([openTask, doneTask]);

        const res = await request(app)
            .post("/api/tasks/bulk")
            .set(CSRF)
            .set("Cookie", authCookie(1))
            .send({ ids: [10, 11], action: "delete" });

        expect(res.status).toBe(200);
        const byId = Object.fromEntries(
            (res.body.results as any[]).map((r) => [r.id, r]),
        );
        expect(byId[10]).toMatchObject({ ok: true });
        expect(byId[11]).toMatchObject({ ok: false });
        expect(byId[11].error).toMatch(/already completed or cancelled/i);
        expect(res.body.changed).toBe(1);
    });

    test("never moves a completed ticket to the cancelled state", async () => {
        routeQueries([doneTask]);

        await request(app)
            .post("/api/tasks/bulk")
            .set(CSRF)
            .set("Cookie", authCookie(1))
            .send({ ids: [11], action: "delete" });

        const stateUpdates = mockQuery.mock.calls
            .map(([sql]: any[]) => String(sql))
            .filter((sql) => /UPDATE tasks SET workflow_state_id/i.test(sql));
        expect(stateUpdates).toHaveLength(0);
    });
});
