export {};

/**
 * Self-approval rules: only super_admin / platform_admin may decide a request
 * they raised themselves (manager approvals, bulk, and leave PATCH routes).
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
const { canSelfApprove, selfApprovalError } = require("../utils/selfApproval");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };
const ME = 1;

function authCookie(userId = ME) {
    const token = jwt.sign({ id: userId, username: "me", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

function setupAuth(role: string) {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth
        .mockResolvedValueOnce({
            rows: [{ role, org_id: 1, team_id: null, department_id: null, manager_id: null, is_active: true }],
            rowCount: 1,
        }); // loadUserContext
}

function txSql(): string[] {
    return mockTxClient.query.mock.calls.map((c: any[]) => String(c[0]));
}

const pendingOwn = { id: 5, org_id: 1, requester_id: ME, approver_id: 7, status: "pending", type: "overtime", reference_id: null, metadata: null };
const pendingOther = { ...pendingOwn, id: 6, requester_id: 2 };

beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
});

describe("selfApproval helpers", () => {
    test("only super_admin and platform_admin may self-approve", () => {
        expect(canSelfApprove("super_admin")).toBe(true);
        expect(canSelfApprove("platform_admin")).toBe(true);
        for (const role of ["hr_admin", "manager", "team_lead", "employee", undefined]) {
            expect(canSelfApprove(role)).toBe(false);
        }
    });

    test("selfApprovalError only fires for the requester's own request", () => {
        expect(selfApprovalError(1, 1, "hr_admin", "approve")).toBe("You cannot approve your own request");
        expect(selfApprovalError("1", 1, "manager", "reject")).toBe("You cannot reject your own request");
        expect(selfApprovalError(2, 1, "hr_admin", "approve")).toBeNull();
        expect(selfApprovalError(1, 1, "super_admin", "approve")).toBeNull();
    });
});

describe("POST /api/manager/approvals/:id/(approve|reject) on your own request", () => {
    test.each(["approve", "reject"])("hr_admin gets 403 on %s", async (action) => {
        setupAuth("hr_admin");
        mockTxClient.query.mockResolvedValueOnce({ rows: [pendingOwn], rowCount: 1 });

        const res = await request(app)
            .post(`/api/manager/approvals/5/${action}`)
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({});

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: `You cannot ${action} your own request` });
        expect(txSql().some((s) => /UPDATE approval_requests/.test(s))).toBe(false);
    });

    test.each(["approve", "reject"])("super_admin can %s their own request", async (action) => {
        setupAuth("super_admin");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [pendingOwn], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // isDirectManager probe
            .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 }); // guarded UPDATE approval_requests

        const res = await request(app)
            .post(`/api/manager/approvals/5/${action}`)
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({});

        expect(res.status).toBe(200);
        expect(txSql().some((s) => /UPDATE approval_requests SET status/.test(s))).toBe(true);
    });
});

describe("POST /api/manager/approvals/bulk with your own request", () => {
    test("hr_admin: own request is skipped and reported, others processed", async () => {
        setupAuth("hr_admin");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [pendingOwn], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [pendingOther], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // isDirectManager probe
            .mockResolvedValueOnce({ rows: [{ id: 6 }], rowCount: 1 }); // UPDATE approval_requests

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [5, 6], action: "approve" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            message: "1 request(s) approved, 1 skipped (your own request)",
            processed: 1,
            skipped: 1,
            ownSkipped: 1,
        });
        const updates = mockTxClient.query.mock.calls.filter((c: any[]) => /UPDATE approval_requests/.test(String(c[0])));
        expect(updates.map((c: any[]) => c[1][3])).toEqual([6]);
    });

    test("super_admin: own request is processed", async () => {
        setupAuth("super_admin");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [pendingOwn], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 });

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [5], action: "reject" });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ processed: 1, skipped: 0, ownSkipped: 0 });
    });

    test("requests from another organisation are skipped, not processed", async () => {
        setupAuth("super_admin");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [{ ...pendingOther, org_id: 99 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // isDirectManager probe

        const res = await request(app)
            .post("/api/manager/approvals/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [6], action: "approve" });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ processed: 0, skipped: 1 });
        expect(txSql().some((s) => /UPDATE approval_requests/.test(s))).toBe(false);
    });

    test("reject without a JSON body does not crash", async () => {
        setupAuth("super_admin");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [pendingOther], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [{ id: 6 }], rowCount: 1 });

        const res = await request(app)
            .post("/api/manager/approvals/6/reject")
            .set(CSRF)
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
    });
});

describe("GET /api/manager/approvals own-request visibility", () => {
    function approvalsQuery() {
        return mockQuery.mock.calls.find((c: any[]) => /FROM approval_requests ar/.test(String(c[0])));
    }

    test("super_admin sees their own requests alongside the org's", async () => {
        setupAuth("super_admin");
        const res = await request(app).get("/api/manager/approvals").set("Cookie", authCookie());
        expect(res.status).toBe(200);
        const [sql, params] = approvalsQuery();
        expect(sql).toMatch(/\(ar\.requester_id IN \(SELECT id FROM users WHERE org_id = \$1\) OR ar\.requester_id = \$2\)/);
        expect(params).toEqual([1, ME, "pending"]);
    });

    test("hr_admin does not get their own requests in the queue", async () => {
        setupAuth("hr_admin");
        const res = await request(app).get("/api/manager/approvals").set("Cookie", authCookie());
        expect(res.status).toBe(200);
        const [sql, params] = approvalsQuery();
        expect(sql).toMatch(/ar\.requester_id <> \$2/);
        expect(params).toEqual([1, ME, "pending"]);
    });
});

describe("PATCH /api/leaves/:id/(approve|reject|revoke) on your own leave", () => {
    const ownLeave = (status: string) => ({
        id: 11, user_id: ME, status, leave_type: "casual", date: "2026-10-05", duration: "full",
        leave_org_id: 1, leave_manager_id: null, approved_by: 7,
    });

    test.each([["approve", "pending"], ["reject", "pending"], ["revoke", "approved"]])(
        "hr_admin gets 403 on %s",
        async (action, status) => {
            setupAuth("hr_admin");
            mockQuery.mockResolvedValueOnce({ rows: [ownLeave(status)], rowCount: 1 });

            const res = await request(app)
                .patch(`/api/leaves/11/${action}`)
                .set(CSRF)
                .set("Cookie", authCookie())
                .send({});

            expect(res.status).toBe(403);
            expect(res.body).toEqual({ error: `You cannot ${action} your own request` });
            expect(mockTransaction).not.toHaveBeenCalled();
        },
    );

    test("super_admin can approve their own leave", async () => {
        setupAuth("super_admin");
        mockQuery.mockResolvedValueOnce({ rows: [ownLeave("pending")], rowCount: 1 });
        mockTxClient.query.mockImplementation(async (sql: string) => {
            if (/FOR UPDATE/.test(sql) && /FROM leaves/.test(sql)) return { rows: [ownLeave("pending")], rowCount: 1 };
            if (/RETURNING id/.test(sql)) return { rows: [{ id: 77 }], rowCount: 1 };
            if (/FROM leave_balances/.test(sql)) return { rows: [{ id: 3, used: "0" }], rowCount: 1 };
            return { rows: [], rowCount: 1 };
        });

        const res = await request(app)
            .patch("/api/leaves/11/approve")
            .set(CSRF)
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: "Leave approved" });
    });

    test("super_admin can reject their own leave", async () => {
        setupAuth("super_admin");
        mockQuery.mockResolvedValueOnce({ rows: [ownLeave("pending")], rowCount: 1 });

        const res = await request(app)
            .patch("/api/leaves/11/reject")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ reason: "Changed plans" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ message: "Leave rejected" });
    });
});
