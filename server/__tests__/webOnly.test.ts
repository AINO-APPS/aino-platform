export {};

// Administration is web-only: admin routes refuse the native app's tokens.
// Harness mirrors admin.routes.test.ts.

jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    },
    requestLogger: (req: any, _res: any, next: any) => {
        req.id = "test";
        req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        next();
    },
}));
jest.mock("../utils/mailer", () => ({ getTransporter: jest.fn(() => null), sendMail: jest.fn(), notifyByEmail: jest.fn(), esc: (s: any) => String(s ?? "") }));
jest.mock("../utils/ws", () => ({ setupWebSocket: jest.fn(), sendToUser: jest.fn(), broadcast: jest.fn() }));
jest.mock("../utils/audit", () => ({ logAction: jest.fn(), queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }) }));
jest.mock("../utils/platformConfig", () => ({
    getPasswordPolicy: jest.fn().mockResolvedValue({}),
    isMaintenanceMode: jest.fn().mockResolvedValue(false),
    getMaintenanceMessage: jest.fn().mockResolvedValue(""),
    getAllowedEmailDomains: jest.fn().mockResolvedValue([]),
    getPlatformConfig: jest.fn().mockResolvedValue({}),
    getSessionTimeout: jest.fn().mockResolvedValue(480),
    getRetentionPolicy: jest.fn().mockResolvedValue({}),
    updatePlatformConfig: jest.fn().mockResolvedValue({}),
    PLATFORM_KEYS: [],
    DEFAULTS: {},
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");

const mockQuery: jest.Mock = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
jest.mock("../db", () => ({
    pool: { end: jest.fn() },
    query: (...args: any[]) => mockQuery(...args),
    masterQuery: (...args: any[]) => mockQuery(...args),
    masterTransaction: jest.fn(),
    transaction: jest.fn(),
    initDB: jest.fn(),
}));

const { app } = require("../index");
const { clientClaims } = require("../middleware/webOnly");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "AINO" };

function token(claims: Record<string, unknown> = {}) {
    return jwt.sign({ id: 1, username: "admin", tv: 0, ...claims }, SECRET, { expiresIn: "1h" });
}

function asHrAdmin() {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth middleware
        .mockResolvedValueOnce({ rows: [{ role: "hr_admin", org_id: 1, team_id: 1, department_id: 1, manager_id: null, is_active: true }], rowCount: 1 }); // loadUserContext
}

beforeEach(() => {
    mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("admin routes are web-only", () => {
    test.each([
        ["GET", "/api/admin/stats"],
        ["GET", "/api/admin/tenants"],
        ["GET", "/api/compensation/employees"],
        ["POST", "/api/compensation/disburse"],
        ["PUT", "/api/branding"],
        ["GET", "/api/branding/email-templates"],
        ["POST", "/api/projects"],
        ["GET", "/api/platform-access/requests"],
        ["PUT", "/api/agile/settings"],
        ["GET", "/api/agile/permissions/grants"],
        ["PUT", "/api/org/settings"],
        ["POST", "/api/org/invite"],
        ["POST", "/api/org/remove-member"],
        ["PATCH", "/api/org/roles/lead"],
    ])("%s %s refuses a bearer (app) token", async (method, path) => {
        asHrAdmin(); // agile gates run after auth
        const res = await request(app)[method.toLowerCase()](path).set(CSRF).set("Authorization", `Bearer ${token()}`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("WEB_ONLY");
    });

    test("an app token replayed as a cookie is still refused", async () => {
        const res = await request(app).get("/api/admin/stats").set("Cookie", `token=${token({ cli: "mobile" })}`);
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("WEB_ONLY");
    });

    test("a request identifying as the Android app is refused", async () => {
        const res = await request(app).get("/api/admin/stats").set("Cookie", `token=${token()}`).set("X-AINO-Client", "android");
        expect(res.body.code).toBe("WEB_ONLY");
    });

    test("a web session reaches the admin route", async () => {
        asHrAdmin();
        const res = await request(app).get("/api/admin/stats").set("Cookie", `token=${token()}`);
        expect(res.body.code).not.toBe("WEB_ONLY");
    });

    test.each([
        ["GET", "/api/compensation/my-slips"],
        ["GET", "/api/compensation/my-bank-details"],
        ["POST", "/api/compensation/my-bank-details"],
        ["GET", "/api/branding"],
        ["GET", "/api/projects"],
        ["GET", "/api/agile/config"],
        ["GET", "/api/org/roles"],
        ["POST", "/api/org/departments"],
        ["POST", "/api/org"],
    ])("app self-service %s %s is not gated", async (method, path) => {
        const res = await request(app)[method.toLowerCase()](path).set(CSRF).set("Authorization", `Bearer ${token()}`);
        expect(res.body.code).not.toBe("WEB_ONLY");
    });
});

describe("clientClaims", () => {
    test("marks app logins, bearer requests and already-marked tokens as mobile", () => {
        expect(clientClaims({ headers: { "x-aino-client": "android" } })).toEqual({ cli: "mobile" });
        expect(clientClaims({ headers: { authorization: "Bearer x" } })).toEqual({ cli: "mobile" });
        expect(clientClaims({ headers: {}, cookies: { token: token({ cli: "mobile" }) } })).toEqual({ cli: "mobile" });
    });

    test("leaves web requests unmarked", () => {
        expect(clientClaims({ headers: {} })).toEqual({});
        expect(clientClaims({ headers: {}, cookies: { token: token() } })).toEqual({});
        expect(clientClaims({ headers: { authorization: "Bearer x" }, cookies: { token: "t" } })).toEqual({});
    });
});
