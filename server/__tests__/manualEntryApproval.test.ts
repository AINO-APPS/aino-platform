export {};

/**
 * Manual entries on dates that already have attendance become approval edit
 * requests; approving them (single or bulk) applies the proposed day for any
 * requester role, rejecting leaves the existing day untouched.
 */

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

jest.mock("../middleware/maintenanceMode", () => ({
    maintenanceModeMiddleware: (_req: any, _res: any, next: any) => next(),
    invalidateMaintenanceCache: jest.fn(),
}));

jest.mock("../redis", () => {
    const actual = jest.requireActual("../redis");
    return {
        ...actual,
        getTokenVersion: jest.fn().mockResolvedValue(null),
        setTokenVersion: jest.fn().mockResolvedValue(undefined),
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
const { applyManualEntryDecision } = require("../utils/manualEntryDecision");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "me", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

function setupAuth(role: string, orgId: number | null = 1) {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({
            rows: [{ role, org_id: orgId, team_id: null, department_id: null, manager_id: null, is_active: true }],
            rowCount: 1,
        });
}

const txSql = () => mockTxClient.query.mock.calls.map((c: any[]) => String(c[0]));

const editMeta = JSON.stringify({
    date: "2024-03-10", clock_in: "09:00", clock_out: "17:00",
    breaks: [{ start: "12:00", end: "12:30" }], work_mode: "remote", timezone_offset: -330, edit: true,
});

beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
});

describe("applyManualEntryDecision", () => {
    function client(timezoneOffset = -330) {
        return {
            query: jest.fn(async (sql: string) => (/timezone_offset/.test(sql)
                ? { rows: [{ timezone_offset: timezoneOffset }] }
                : { rows: [] })),
        };
    }

    test("approving an edit request replaces the day with approved rows in the requester's timezone", async () => {
        const db = client();
        await applyManualEntryDecision(db, { requester_id: 2, metadata: editMeta }, 9, "approved");

        const calls = db.query.mock.calls as unknown as Array<[string, unknown[]]>;
        expect(calls[0][0]).toMatch(/DELETE FROM time_entries/);
        expect(calls[0][1]).toEqual([2, "330 minutes", "2024-03-10"]);
        const inserts = calls.filter(([sql]) => /INSERT INTO time_entries/.test(sql)).map(([, p]) => p);
        expect(inserts).toEqual([
            [2, "clock_in", "2024-03-10T03:30:00.000Z", "remote", 9],
            [2, "break_start", "2024-03-10T06:30:00.000Z", null, 9],
            [2, "break_end", "2024-03-10T07:00:00.000Z", null, 9],
            [2, "clock_out", "2024-03-10T11:30:00.000Z", null, 9],
        ]);
    });

    test("uses the request's metadata.timezone_offset, not a stale saved users.timezone_offset", async () => {
        const db = client(0); // saved offset never refreshed (no real clock-in yet)
        const meta = JSON.stringify({ date: "2024-03-10", clock_in: "09:00", clock_out: "18:00", timezone_offset: -330, edit: true });
        await applyManualEntryDecision(db, { requester_id: 2, metadata: meta }, 9, "approved");

        const calls = db.query.mock.calls as unknown as Array<[string, unknown[]]>;
        expect(calls.some(([sql]) => /FROM users/.test(sql))).toBe(false);
        const del = calls.find(([sql]) => /DELETE FROM time_entries/.test(sql))!;
        expect(del[1]).toEqual([2, "330 minutes", "2024-03-10"]); // the IST day window
        const inserts = calls.filter(([sql]) => /INSERT INTO time_entries/.test(sql)).map(([, p]) => [p[1], p[2]]);
        expect(inserts).toEqual([
            ["clock_in", "2024-03-10T03:30:00.000Z"],
            ["clock_out", "2024-03-10T12:30:00.000Z"],
        ]);
    });

    test("falls back to the saved users.timezone_offset when the request has none", async () => {
        const db = client(-330);
        const meta = JSON.stringify({ date: "2024-03-10", clock_in: "09:00", edit: true });
        await applyManualEntryDecision(db, { requester_id: 2, metadata: meta }, 9, "approved");

        const calls = db.query.mock.calls as unknown as Array<[string, unknown[]]>;
        expect(calls[0][0]).toMatch(/SELECT timezone_offset FROM users/);
        expect(calls[1][1]).toEqual([2, "330 minutes", "2024-03-10"]);
        expect(calls[2][1]).toEqual([2, "clock_in", "2024-03-10T03:30:00.000Z", "office", 9]);
    });

    test("a plain manual entry is flipped using the request's timezone_offset", async () => {
        const db = client(0);
        await applyManualEntryDecision(db, { requester_id: 2, metadata: JSON.stringify({ date: "2024-03-10", timezone_offset: -330 }) }, 9, "approved");
        const calls = db.query.mock.calls as unknown as Array<[string, unknown[]]>;
        expect(calls).toHaveLength(1);
        expect(calls[0][1]).toEqual(["approved", 9, 2, "330 minutes", "2024-03-10"]);
    });

    test("rejecting an edit request does not touch time entries", async () => {
        const db = client();
        await applyManualEntryDecision(db, { requester_id: 2, metadata: editMeta }, 9, "rejected");
        expect(db.query).not.toHaveBeenCalled();
    });

    test.each(["approved", "rejected"])("a plain manual entry is flipped to %s", async (decision) => {
        const db = client(0);
        await applyManualEntryDecision(db, { requester_id: 2, metadata: JSON.stringify({ date: "2024-03-10" }) }, 9, decision);
        const calls = db.query.mock.calls as unknown as Array<[string, unknown[]]>;
        expect(calls).toHaveLength(2);
        expect(calls[1][0]).toMatch(/UPDATE time_entries SET approval_status = \$1/);
        expect(calls[1][1]).toEqual([decision, 9, 2, "0 minutes", "2024-03-10"]);
    });
});

describe("POST /api/manager/approvals/bulk applies manual edit requests", () => {
    const editApproval = { id: 5, org_id: 1, requester_id: 2, approver_id: 1, status: "pending", type: "manual_entry", reference_id: null, metadata: editMeta };

    test("bulk approve replaces the day like the single approve route", async () => {
        setupAuth("manager");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [editApproval], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 }) // direct manager
            .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });         // guarded UPDATE approval_requests

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [5], action: "approve" });

        expect(res.status).toBe(200);
        expect(res.body.processed).toBe(1);
        const sql = txSql();
        expect(sql[0]).toMatch(/FROM approval_requests WHERE id = \$1 AND status = 'pending' FOR UPDATE/);
        expect(sql.some((s) => /DELETE FROM time_entries/.test(s))).toBe(true);
        expect(sql.filter((s) => /INSERT INTO time_entries/.test(s))).toHaveLength(4);
    });

    test("bulk reject leaves the existing day untouched", async () => {
        setupAuth("manager");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [editApproval], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [5], action: "reject" });

        expect(res.status).toBe(200);
        expect(txSql().some((s) => /time_entries/.test(s))).toBe(false);
    });
});

describe("approval decisions are guarded against races / double-apply", () => {
    const editApproval = { id: 5, org_id: 1, requester_id: 2, approver_id: 1, status: "pending", type: "manual_entry", reference_id: null, metadata: editMeta };

    test.each(["approve", "reject"])("single %s locks the row and stops when the guarded UPDATE returns no row", async (action) => {
        setupAuth("manager");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [editApproval], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 }) // direct manager
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });                 // already handled concurrently

        const res = await request(app)
            .post(`/api/manager/approvals/5/${action}`)
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({});

        expect(res.status).toBe(409);
        expect(res.body).toEqual({ error: "Request already handled" });
        const sql = txSql();
        expect(sql[0]).toMatch(/SELECT \* FROM approval_requests WHERE id = \$1 FOR UPDATE/);
        expect(sql[2]).toMatch(/WHERE id = \$\d AND status = 'pending' RETURNING id/);
        expect(sql).toHaveLength(3);
        expect(sql.some((s) => /time_entries/.test(s))).toBe(false);
    });

    test("bulk approve skips a request whose guarded UPDATE returns no row", async () => {
        setupAuth("manager");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [editApproval], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [5], action: "approve" });

        expect(res.status).toBe(200);
        expect(res.body.processed).toBe(0);
        expect(txSql().some((s) => /time_entries/.test(s))).toBe(false);
    });
});

describe("POST /api/tracker/manual-entry on a date with existing entries", () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    test.each(["employee", "super_admin"])("%s gets a pending edit request instead of an error", async (role) => {
        setupAuth(role, null);
        mockQuery
            .mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1 }) // entries exist
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })               // no leave
            .mockResolvedValueOnce({ rows: [{ "?column?": 1 }], rowCount: 1 }); // applied attendance
        mockTxClient.query.mockImplementation(async (sql: string) => (
            /INSERT INTO approval_requests/.test(sql) ? { rows: [{ id: 88 }], rowCount: 1 } : { rows: [], rowCount: 0 }
        ));

        const res = await request(app)
            .post("/api/tracker/manual-entry")
            .set("Cookie", authCookie())
            .set(CSRF)
            .set("X-Timezone-Offset", "0")
            .send({ date: yesterday, clock_in: "09:00", clock_out: "17:00", work_mode: "office" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: "Attendance already exists for this date, so your entry was submitted for approval as an edit request. Your existing entries stay in place until it is approved.",
            status: "pending",
            needsApproval: true,
            editRequest: true,
        });
        const sql = txSql();
        expect(sql.some((s) => /INSERT INTO time_entries|DELETE FROM time_entries/.test(s))).toBe(false);
        const insert = mockTxClient.query.mock.calls.find((c: any[]) => /INSERT INTO approval_requests/.test(String(c[0])));
        expect(JSON.parse(insert[1][4])).toMatchObject({ date: yesterday, clock_in: "09:00", edit: true });
    });

    test("a fresh date is still a plain pending manual entry for super_admin", async () => {
        setupAuth("super_admin", null);
        mockQuery.mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 });

        const res = await request(app)
            .post("/api/tracker/manual-entry")
            .set("Cookie", authCookie())
            .set(CSRF)
            .set("X-Timezone-Offset", "0")
            .send({ date: yesterday, clock_in: "09:00", clock_out: "17:00" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: "Manual entry submitted for approval",
            status: "pending",
            needsApproval: true,
            editRequest: false,
        });
        const inserts = mockTxClient.query.mock.calls.filter((c: any[]) => /INSERT INTO time_entries/.test(String(c[0])));
        expect(inserts.every((c: any[]) => c[1][4] === "pending")).toBe(true);
        expect(txSql().some((s) => /INSERT INTO approval_requests/.test(s))).toBe(true);
    });
});
