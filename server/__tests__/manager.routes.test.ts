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
}));

jest.mock("../utils/audit", () => ({
    logAction: jest.fn(),
    queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

// Force loadUserContext down its deterministic DB path (see chat.routes.test).
jest.mock("../redis", () => {
    const actual = jest.requireActual("../redis");
    return {
        ...actual,
        getUserContext: jest.fn().mockResolvedValue(null),
        setUserContext: jest.fn().mockResolvedValue(undefined),
    };
});

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
const { sendToUser } = require("../utils/ws");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

function setupAuth(role = "team_lead", extra: Record<string, any> = {}) {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth
        .mockResolvedValueOnce({
            rows: [{
                role, org_id: 1, team_id: 1, department_id: 1,
                manager_id: null, is_active: true, role_level: 3, ...extra,
            }],
            rowCount: 1,
        }); // loadUserContext
}

describe("GET /api/manager/team-attendance", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/manager/team-attendance");
        expect(res.status).toBe(401);
    });

    test("returns 403 for employee without reports", async () => {
        // auth check
        mockQuery
            .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 })
            .mockResolvedValueOnce({
                rows: [{
                    role: "employee", org_id: 1, team_id: 1, department_id: 1,
                    manager_id: 2, is_active: true, role_level: 1,
                }],
                rowCount: 1,
            })
            // manager middleware: check role_level < 2 → check direct reports
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no direct reports
        const res = await request(app)
            .get("/api/manager/team-attendance")
            .set("Cookie", authCookie());
        expect(res.status).toBe(403);
    });

    test("returns data for team_lead", async () => {
        setupAuth("team_lead", { role_level: 3 });
        // manager middleware passes (role_level >= 2)
        // getVisibleUserIds query
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 2 }, { id: 3 }], rowCount: 2 }) // visible users
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // attendance query

        const res = await request(app)
            .get("/api/manager/team-attendance")
            .set("Cookie", authCookie())
            .set("X-Timezone-Offset", "-330");
        expect(res.status).toBe(200);
    });
});

describe("GET /api/manager/approvals", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns pending approvals for manager", async () => {
        setupAuth("team_lead", { role_level: 3 });
        // manager middleware passes
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // approvals query

        const res = await request(app)
            .get("/api/manager/approvals")
            .set("Cookie", authCookie());
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });
});

describe("POST /api/manager/approvals/:id/approve", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    describe("committed approval realtime delivery", () => {
        beforeEach(() => {
            sendToUser.mockClear();
            mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
            mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
            mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
        });

        test.each(["approve", "reject"])("%s syncs the actor before requester lookup completes", async (action) => {
            let release!: (value: { rows: unknown[]; rowCount: number }) => void;
            const delayed = new Promise((resolve) => { release = resolve; });
            mockQuery.mockImplementation((sql: string) => /SELECT email, full_name/.test(sql)
                ? delayed : Promise.resolve({ rows: [], rowCount: 0 }));
            setupAuth("team_lead", { role_level: 3 });
            mockTxClient.query
                .mockResolvedValueOnce({ rows: [{ id: 5, org_id: 1, requester_id: 2, approver_id: 1, status: "pending", type: "work_mode_change" }] })
                .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
                .mockResolvedValueOnce({ rows: [{ id: 5 }] });
            const res = await request(app).post(`/api/manager/approvals/5/${action}`)
                .set(CSRF).set("Cookie", authCookie()).send({});
            expect(res.status).toBe(200);
            expect(sendToUser).toHaveBeenCalledWith(null, 1, "approval_update", {
                id: 5, type: "work_mode_change", status: action === "approve" ? "approved" : "rejected",
            });
            release({ rows: [], rowCount: 0 });
            await new Promise((resolve) => setImmediate(resolve));
        });

        test("rollback never announces an approval", async () => {
            setupAuth("team_lead", { role_level: 3 });
            mockTransaction.mockRejectedValueOnce(new Error("Commit failed"));
            const res = await request(app).post("/api/manager/approvals/5/approve")
                .set(CSRF).set("Cookie", authCookie());
            expect(res.status).toBe(500);
            expect(sendToUser).not.toHaveBeenCalled();
        });

        test("a skipped bulk batch emits nothing", async () => {
            setupAuth("team_lead", { role_level: 3 });
            const res = await request(app).post("/api/manager/approvals/bulk")
                .set(CSRF).set("Cookie", authCookie()).send({ ids: [5], action: "approve" });
            expect(res.status).toBe(200);
            expect(res.body.processed).toBe(0);
            expect(sendToUser).not.toHaveBeenCalled();
        });

        test("bulk decisions retain the original approver for cross-device fanout", async () => {
            setupAuth("team_lead", { role_level: 3 });
            mockQuery.mockImplementation(async (sql: string) => {
                if (/SELECT id, org_id, manager_id FROM users/.test(sql)) {
                    return { rows: [{ id: 2, org_id: 1, manager_id: 1 }], rowCount: 1 };
                }
                if (/SELECT id, role, org_id FROM users/.test(sql)) {
                    return { rows: [{ id: 9, org_id: 1, role: "team_lead" }], rowCount: 1 };
                }
                return { rows: [], rowCount: 0 };
            });
            mockTxClient.query.mockImplementation(async (sql: string, params: unknown[]) => {
                if (/SELECT \* FROM approval_requests/.test(sql)) {
                    return { rows: [{ id: params[0], org_id: 1, requester_id: 2, approver_id: 9, type: "work_mode_change" }] };
                }
                return { rows: [{ id: 5 }] };
            });
            const res = await request(app).post("/api/manager/approvals/bulk")
                .set(CSRF).set("Cookie", authCookie()).send({ ids: [5, 6], action: "approve" });
            expect(res.status).toBe(200);
            expect(res.body.processed).toBe(2);
            await new Promise((resolve) => setImmediate(resolve));
            expect(sendToUser).toHaveBeenCalledWith(null, 1, "approval_update", { type: "bulk", status: "approved" });
            expect(sendToUser).toHaveBeenCalledWith(null, 9, "approval_update", { id: 5, type: "work_mode_change", status: "approved" });
            expect(sendToUser).toHaveBeenCalledWith(null, 9, "approval_update", { id: 6, type: "work_mode_change", status: "approved" });
        });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app)
            .post("/api/manager/approvals/1/approve")
            .set(CSRF);
        expect(res.status).toBe(401);
    });
});

describe("POST /api/manager/approvals/bulk", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("returns 400 when ids array is missing", async () => {
        setupAuth("team_lead", { role_level: 3 });
        // manager middleware passes

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ action: "approve" });
        expect(res.status).toBe(400);
    });

    test("returns 400 for invalid action", async () => {
        setupAuth("team_lead", { role_level: 3 });

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [1, 2], action: "invalid" });
        expect(res.status).toBe(400);
    });
});

describe("POST /api/manager/approvals/:id/(approve|reject) - manual_entry edit", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    const editMeta = JSON.stringify({
        date: "2024-03-10",
        clock_in: "09:00",
        clock_out: "17:00",
        breaks: [{ start: "12:00", end: "12:30" }],
        work_mode: "office",
        timezone_offset: 0,
        edit: true,
    });

    test("approve applies the edited day: deletes old rows and inserts approved ones", async () => {
        setupAuth("team_lead", { role_level: 3 });
        mockTxClient.query
            // SELECT approval_requests
            .mockResolvedValueOnce({ rows: [{ id: 5, org_id: 1, requester_id: 2, approver_id: 1, status: "pending", type: "manual_entry", reference_id: null, metadata: editMeta }], rowCount: 1 })
            // isDirectManager probe
            .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 })
            // UPDATE approval_requests -> approved (guarded, RETURNING id)
            .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });

        const res = await request(app)
            .post("/api/manager/approvals/5/approve")
            .set(CSRF)
            .set("Cookie", authCookie())
            .set("X-Timezone-Offset", "-330");

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/approved/i);
        const txSql = mockTxClient.query.mock.calls.map((c: any[]) => String(c[0]));
        expect(txSql.some((s: string) => /DELETE FROM time_entries/i.test(s))).toBe(true);
        const inserts = txSql.filter((s: string) => /INSERT INTO time_entries/i.test(s));
        // clock_in + break_start + break_end + clock_out = 4 inserts
        expect(inserts.length).toBe(4);
        // Inserted rows are approved, not pending.
        expect(inserts.every((s: string) => /'approved'/i.test(s))).toBe(true);
    });

    test("reject leaves time_entries untouched for an edit request", async () => {
        setupAuth("team_lead", { role_level: 3 });
        mockTxClient.query
            // SELECT approval_requests
            .mockResolvedValueOnce({ rows: [{ id: 5, org_id: 1, requester_id: 2, approver_id: 1, status: "pending", type: "manual_entry", reference_id: null, metadata: editMeta }], rowCount: 1 })
            // isDirectManager probe
            .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 })
            // UPDATE approval_requests -> rejected (guarded, RETURNING id)
            .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });

        const res = await request(app)
            .post("/api/manager/approvals/5/reject")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ reject_reason: "Times look off" });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/rejected/i);
        const txSql = mockTxClient.query.mock.calls.map((c: any[]) => String(c[0]));
        // Non-destructive edit rejection must NOT touch time_entries at all.
        expect(txSql.some((s: string) => /time_entries/i.test(s))).toBe(false);
    });
});
