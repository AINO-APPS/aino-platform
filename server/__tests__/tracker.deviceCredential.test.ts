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

// Tracker route tests do not exercise platform maintenance-mode behavior.
// Bypass it so its process-level TTL cache cannot shift per-test DB mock queues.
jest.mock("../middleware/maintenanceMode", () => ({
    maintenanceModeMiddleware: (_req: any, _res: any, next: any) => next(),
    invalidateMaintenanceCache: jest.fn(),
}));

// Force loadUserContext down its deterministic DB path: with the user-context
// cache always missing, every request runs the same `SELECT ... is_active FROM
// users` lookup, so the per-test mockQuery chains stay stable (otherwise the
// first test would warm the cache and later tests would skip the user lookup,
// shifting their mock sequence).
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

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1, username = "testuser") {
    const token = jwt.sign({ id: userId, username, tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

// The auth middleware checks token_version in DB, loadUserContext loads role
function setupAuthMocks(overrides: Record<string, any> = {}) {
    const defaults = {
        id: 1, username: "testuser", role: "employee", org_id: null,
        team_id: null, department_id: null, manager_id: null, is_active: true,
        token_version: 0,
    };
    const user = { ...defaults, ...overrides };

    mockQuery
        // auth middleware: SELECT token_version
        .mockResolvedValueOnce({ rows: [{ token_version: user.token_version }], rowCount: 1 })
        // loadUserContext: SELECT role, org_id...
        .mockResolvedValueOnce({ rows: [user], rowCount: 1 });
}

// ── Android device-credential identity (fingerprint / screen-lock proof) ──
const bcrypt = require("bcryptjs");
const SECRET_VALUE = "a".repeat(64);
const HASH = bcrypt.hashSync(SECRET_VALUE, 4);
const ORG_VERIFY = {
    attendance_verification_enabled: true,
    office_latitude: 10, office_longitude: 20, office_radius_m: 150,
    office_wifi_bssids: [], office_wifi_verification_enabled: false,
};
const ALL_DAYS = { work_days: "0,1,2,3,4,5,6", work_hours_per_day: 8 };
const CRED = { credentialId: "5.cred", deviceSecret: SECRET_VALUE };
const OWNED_CRED_ROW = { rows: [{ id: "5.cred", user_id: 1, secret_hash: HASH }], rowCount: 1 };

function resetMocks() {
    mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
}

function mockClockInPrelude() {
    setupAuthMocks({ org_id: 1 });
    mockQuery
        .mockResolvedValueOnce({ rows: [ALL_DAYS], rowCount: 1 })   // work_days
        .mockResolvedValueOnce({ rows: [ALL_DAYS], rowCount: 1 })   // work_hours_per_day
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // today entries
        .mockResolvedValueOnce({ rows: [ORG_VERIFY], rowCount: 1 }); // org verification
}

function mockOpenSession(workMode: string) {
    setupAuthMocks({ org_id: 1 });
    mockQuery
        .mockResolvedValueOnce({ rows: [ORG_VERIFY], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ work_mode: workMode }], rowCount: 1 });
}

function clockIn(body: Record<string, unknown>) {
    return request(app).post("/api/tracker/clock-in").set(CSRF)
        .set("Cookie", authCookie()).set("X-Timezone-Offset", "-330").send(body);
}

function clockOut(body: Record<string, unknown>) {
    return request(app).post("/api/tracker/clock-out").set(CSRF)
        .set("Cookie", authCookie()).set("X-Timezone-Offset", "-330").send(body);
}

describe("clock-in with device credential", () => {
    beforeEach(resetMocks);

    test("remote clock-in succeeds with a valid credential (no face, no office proof)", async () => {
        mockClockInPrelude();
        mockQuery.mockResolvedValueOnce(OWNED_CRED_ROW).mockResolvedValueOnce({ rows: [], rowCount: 1 });
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // no last entry
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT clock_in

        const res = await clockIn({ work_mode: "remote", device_credential: CRED });
        expect(res.status).toBe(200);
        expect(res.body.verified_via).toBe("fingerprint");
        const insert = mockTxClient.query.mock.calls.find((c: any[]) => /INSERT INTO time_entries/i.test(String(c[0])));
        expect(insert[1]).toContain("fingerprint");
        expect(insert[1]).toContain("remote");
    });

    test("rejects a credential owned by another user", async () => {
        mockClockInPrelude();
        mockQuery.mockResolvedValueOnce({ rows: [{ id: "5.cred", user_id: 99, secret_hash: HASH }], rowCount: 1 });

        const res = await clockIn({ work_mode: "remote", device_credential: CRED });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("DEVICE_CREDENTIAL_INVALID");
        expect(mockTransaction).not.toHaveBeenCalled();
    });

    test("rejects a revoked / unknown credential", async () => {
        mockClockInPrelude();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await clockIn({ work_mode: "remote", device_credential: CRED });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("DEVICE_CREDENTIAL_INVALID");
    });
});


describe("office clock-in with device credential", () => {
    beforeEach(resetMocks);

    test("still requires office presence", async () => {
        mockClockInPrelude();
        const res = await clockIn({ work_mode: "office", latitude: 20, longitude: 20, accuracy: 10, device_credential: CRED });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("OUTSIDE_GEOFENCE");
    });

    test("inside the geofence records fingerprint as the identity proof", async () => {
        mockClockInPrelude();
        mockQuery.mockResolvedValueOnce(OWNED_CRED_ROW).mockResolvedValueOnce({ rows: [], rowCount: 1 });
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await clockIn({ work_mode: "office", latitude: 10, longitude: 20, accuracy: 10, device_credential: CRED });
        expect(res.status).toBe(200);
        expect(res.body.verified_via).toBe("fingerprint");
        expect(res.body.work_mode).toBe("office");
    });
});

describe("clock-out with device credential", () => {
    beforeEach(resetMocks);

    test("office clock-out inside the geofence accepts the credential as identity", async () => {
        mockOpenSession("office");
        mockQuery.mockResolvedValueOnce(OWNED_CRED_ROW).mockResolvedValueOnce({ rows: [], rowCount: 1 });
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [{ entry_type: "clock_in" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await clockOut({ latitude: 10, longitude: 20, accuracy: 10, device_credential: CRED });
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/logged out/i);
    });

    test("remote clock-out rejects a wrong device secret", async () => {
        mockOpenSession("remote");
        mockQuery.mockResolvedValueOnce(OWNED_CRED_ROW);

        const res = await clockOut({ device_credential: { credentialId: "5.cred", deviceSecret: "b".repeat(64) } });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("DEVICE_CREDENTIAL_INVALID");
    });

    test("remote clock-out with a valid credential succeeds", async () => {
        mockOpenSession("remote");
        mockQuery.mockResolvedValueOnce(OWNED_CRED_ROW).mockResolvedValueOnce({ rows: [], rowCount: 1 });
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [{ entry_type: "clock_in" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await clockOut({ device_credential: CRED });
        expect(res.status).toBe(200);
    });

    test("remote clock-out without a credential still works (web/desktop unchanged)", async () => {
        mockOpenSession("remote");
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [{ entry_type: "clock_in" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await clockOut({});
        expect(res.status).toBe(200);
    });
});

