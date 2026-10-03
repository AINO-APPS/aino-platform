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

function setupAuthAndRbac(role = "employee", orgId = 1) {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth
        .mockResolvedValueOnce({
            rows: [{
                role, org_id: orgId, team_id: 1, department_id: 1,
                manager_id: null, is_active: true,
            }],
            rowCount: 1,
        }); // loadUserContext
}

describe("POST /api/leaves", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).post("/api/leaves").set(CSRF);
        expect(res.status).toBe(401);
    });

    test("returns 400 when required fields are missing", async () => {
        setupAuthAndRbac();
        const res = await request(app)
            .post("/api/leaves")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({});
        expect(res.status).toBe(400);
    });
});

describe("GET /api/leaves", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/leaves");
        expect(res.status).toBe(401);
    });

    test("returns empty array for user with no leaves", async () => {
        setupAuthAndRbac();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // leave query

        const res = await request(app)
            .get("/api/leaves")
            .set("Cookie", authCookie());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(0);
    });
});

describe("GET /api/leaves/balance", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns balance data", async () => {
        setupAuthAndRbac();
        // initializeBalances and balance query
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // balances query (initializeBalances check)
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // final balance

        const res = await request(app)
            .get("/api/leaves/balance")
            .set("Cookie", authCookie());
        expect(res.status).toBe(200);
    });
});
// ─── Notifications + realtime fan-out ────────────────────────────────────

const ws = require("../utils/ws");

/** Route queries by SQL text (after the auth/rbac once-values are consumed). */
function routeQueries(mock: jest.Mock, routes: Array<[RegExp, any[]]>) {
    mock.mockImplementation(async (sql: string) => {
        for (const [re, rows] of routes) if (re.test(sql)) return { rows, rowCount: rows.length };
        return { rows: [], rowCount: 0 };
    });
}

/** Post-response side effects run after res.json(); wait for them. */
async function eventually(check: () => void, attempts = 50) {
    for (let i = 0; ; i++) {
        try { check(); return; } catch (err) {
            if (i >= attempts) throw err;
            await new Promise((r) => setImmediate(r));
        }
    }
}

function wsCalls(type: string) {
    return (ws.sendToUser as jest.Mock).mock.calls.filter((c: any[]) => c[2] === type);
}

describe("leave notifications carry deep links and realtime events", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
        (ws.sendToUser as jest.Mock).mockClear();
        (ws.notifyUser as jest.Mock).mockClear();
    });

    test("POST /api/leaves notifies the approver with the approval link and syncs the requester", async () => {
        setupAuthAndRbac("employee");
        routeQueries(mockQuery, [
            [/SELECT manager_id, team_id, department_id FROM users/, [{ manager_id: 9, team_id: null, department_id: null }]],
            [/SELECT id FROM users WHERE id = \$1 AND is_active = TRUE/, [{ id: 9 }]],
            [/SELECT full_name FROM users WHERE id = \$1/, [{ full_name: "Ann" }]],
        ]);
        routeQueries(mockTxClient.query, [
            [/INSERT INTO leaves/, [{ id: 11 }]],
            [/INSERT INTO approval_requests/, [{ id: 77 }]],
        ]);

        const res = await request(app)
            .post("/api/leaves")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ leave_type: "casual", date: "2026-10-05" });

        expect(res.status).toBe(200);
        expect(res.body.ids).toEqual([11]);
        await eventually(() => expect(ws.notifyUser).toHaveBeenCalled());
        const [, , userId, type, title, body, opts] = (ws.notifyUser as jest.Mock).mock.calls[0];
        expect([userId, type, title, body]).toEqual([9, "approval", "New Leave Request", "Ann submitted 1 casual leave request(s)."]);
        expect(opts).toEqual({ actorId: 1, link: "/manager?tab=approvals&request=77" });
        expect(wsCalls("leave_update").map((c) => [c[1], c[3]])).toEqual([[1, { id: 11, status: "pending" }]]);
        await eventually(() => expect(wsCalls("approval_update").map((c) => [c[1], c[3]]))
            .toEqual([[9, { id: 77, type: "leave", status: "pending" }]]));
    });

    test("PATCH /api/leaves/:id/approve notifies the requester and syncs the approver", async () => {
        setupAuthAndRbac("manager");
        routeQueries(mockQuery, [
            [/SELECT l\.\*, u\.org_id AS leave_org_id/, [{
                id: 11, user_id: 2, status: "pending", leave_type: "casual", date: "2026-10-05",
                leave_org_id: 1, leave_manager_id: 1, approved_by: 1,
            }]],
            [/SELECT email, full_name FROM users/, [{ email: "ann@example.com", full_name: "Ann" }]],
        ]);
        routeQueries(mockTxClient.query, [
            [/FROM leaves WHERE id = \$1 FOR UPDATE/, [{ id: 11, status: "pending", user_id: 2, leave_type: "casual", date: "2026-10-05", duration: "full" }]],
            [/UPDATE approval_requests .* RETURNING id/, [{ id: 77 }]],
            [/SELECT id, used FROM leave_balances/, [{ id: 1, used: 0 }]],
        ]);

        const res = await request(app)
            .patch("/api/leaves/11/approve")
            .set(CSRF)
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        const call = (ws.notifyUser as jest.Mock).mock.calls[0];
        expect(call.slice(2)).toEqual([
            2, "leave", "Leave Approved ✅", "Your casual leave on 2026-10-05 has been approved.",
            { actorId: 1, link: "/attendance#leaves" },
        ]);
        expect(wsCalls("leave_update").map((c) => [c[1], c[3]])).toEqual([[2, { id: 11, status: "approved" }]]);
        expect(wsCalls("approval_update").map((c) => [c[1], c[3]])).toEqual([[1, { id: 77, type: "leave", status: "approved" }]]);
        // The raw notification INSERT moved into notifyUser (WS + FCM).
        expect(mockQuery.mock.calls.some(([sql]: any[]) => /INSERT INTO notifications/.test(sql))).toBe(false);
    });

    test("DELETE /api/leaves/:id syncs the requester's devices and the approver", async () => {
        setupAuthAndRbac("employee");
        routeQueries(mockQuery, [
            [/SELECT \* FROM leaves WHERE id = \$1 AND user_id = \$2/, [{ id: 11, user_id: 1, status: "pending", approved_by: 9 }]],
        ]);

        const res = await request(app).delete("/api/leaves/11").set(CSRF).set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(wsCalls("leave_update").map((c) => [c[1], c[3]])).toEqual([[1, { id: 11, status: "cancelled" }]]);
        expect(wsCalls("approval_update").map((c) => [c[1], c[3]])).toEqual([[9, { type: "leave", status: "cancelled" }]]);
    });

    test("POST /api/leaves/:id/withdraw on an approved leave links the approver to the withdrawal request", async () => {
        setupAuthAndRbac("employee");
        routeQueries(mockQuery, [
            [/SELECT \* FROM leaves WHERE id = \$1 AND user_id = \$2/, [{ id: 11, user_id: 1, status: "approved", leave_type: "casual", date: "2026-10-05", reason: null }]],
            [/SELECT manager_id, team_id, department_id FROM users/, [{ manager_id: 9 }]],
            [/SELECT id FROM users WHERE id = \$1 AND is_active = TRUE/, [{ id: 9 }]],
            [/INSERT INTO approval_requests/, [{ id: 78 }]],
            [/SELECT full_name FROM users WHERE id = \$1/, [{ full_name: "Ann" }]],
        ]);

        const res = await request(app).post("/api/leaves/11/withdraw").set(CSRF).set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(wsCalls("leave_update").map((c) => [c[1], c[3]])).toEqual([[1, { id: 11, status: "withdraw_pending" }]]);
        expect((ws.notifyUser as jest.Mock).mock.calls[0].slice(2)).toEqual([
            9, "approval", "Leave Withdrawal Request", "Ann requested withdrawal of casual leave on 2026-10-05.",
            { actorId: 1, link: "/manager?tab=approvals&request=78" },
        ]);
        expect(wsCalls("approval_update").map((c) => [c[1], c[3]])).toEqual([[9, { id: 78, type: "leave_withdraw", status: "pending" }]]);
    });
});
