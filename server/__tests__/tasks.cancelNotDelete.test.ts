export {};

/**
 * A ticket is never hard-deleted once it exists.
 *
 * Jira's model: work is either completed or cancelled, and the record stays so
 * history, reports and links keep making sense. Deleting a ticket silently
 * destroys its comments, history and time entries, and there is no undo.
 *
 * `DELETE /api/tasks/:id` must therefore cancel the ticket (a terminal
 * "cancelled" state) rather than remove the row, and the response must say so.
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

function setupAuth(role = "employee", extra: Record<string, any> = {}) {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ value: "false" }], rowCount: 1 }) // maintenance_mode
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth
        .mockResolvedValueOnce({
            rows: [{
                role, org_id: 1, team_id: 1, department_id: 1,
                manager_id: null, is_active: true, ...extra,
            }],
            rowCount: 1,
        }); // loadUserContext
}

const task = {
    id: 77,
    title: "Refund webhook retries",
    user_id: 1,
    assigned_to: 3,
    org_id: 1,
    sprint_id: null,
    workflow_state_id: 11,
    completed_at: null,
};

/** Answer each query by shape, so auth and the route see the rows they expect. */
function routeQueries(overrides: Array<[RegExp, any[]]> = []) {
    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
        if (/FROM app_settings/.test(sql)) return { rows: [{ value: "false" }], rowCount: 1 };
        if (/SELECT token_version FROM users/.test(sql)) return { rows: [{ token_version: 0 }], rowCount: 1 };
        if (/SELECT role, org_id, team_id/.test(sql)) {
            return {
                rows: [{ role: "employee", org_id: 1, team_id: 1, department_id: 1, manager_id: null, is_active: true }],
                rowCount: 1,
            };
        }
        if (/FROM workflow_states/.test(sql)) {
            const wanted = params?.[0];
            const rows = wanted === "cancelled" || wanted === 99
                ? [{ id: 99, key: "cancelled", name: "Cancelled", category: "done", is_terminal: true }]
                : [{ id: 11, key: "pending", name: "New", category: "open", is_terminal: false }];
            return { rows, rowCount: rows.length };
        }
        for (const [re, rows] of overrides) if (re.test(sql)) return { rows, rowCount: rows.length };
        return { rows: [], rowCount: 0 };
    });
}

describe("DELETE /api/tasks/:id cancels instead of deleting", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("never issues a DELETE FROM tasks", async () => {
        routeQueries([[/SELECT \* FROM tasks WHERE id = \$1/, [task]]]);

        const res = await request(app).delete("/api/tasks/77").set(CSRF).set("Cookie", authCookie(1));

        expect(res.status).toBe(200);
        const sqls = mockQuery.mock.calls.map(([sql]: any[]) => String(sql));
        expect(sqls.some((sql) => /DELETE\s+FROM\s+tasks/i.test(sql))).toBe(false);
        // The ticket is moved to a terminal state instead.
        expect(sqls.some((sql) => /UPDATE tasks SET workflow_state_id/i.test(sql))).toBe(true);
    });

    test("moves the ticket to a cancelled state and reports it", async () => {
        routeQueries([[/SELECT \* FROM tasks WHERE id = \$1/, [task]]]);

        const res = await request(app)
            .delete("/api/tasks/77")
            .set(CSRF)
            .set("Cookie", authCookie(1));

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ cancelled: true, id: 77 });
    });});
