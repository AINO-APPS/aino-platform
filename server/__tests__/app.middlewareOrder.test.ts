/**
 * Phase C regression tests for ordering-sensitive middleware.
 *
 * The route snapshot protects endpoint paths, not registration order. These
 * requests cover the two most dangerous ordering contracts:
 * - webhook routes are mounted before browser CSRF enforcement;
 * - ordinary mutating API routes remain behind CSRF enforcement.
 */
export {};

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

const mockMasterQuery = jest.fn(async (sql: string) => {
    if (sql.includes("SELECT token_version FROM platform_users")) {
        return { rows: [{ token_version: 0 }], rowCount: 1 };
    }
    if (sql.includes("COUNT(*) AS total_users")) {
        return { rows: [{ total_users: "0" }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
});
const mockTransaction = jest.fn();
jest.mock("../db", () => ({
    query: (...args: any[]) => mockMasterQuery(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
    masterQuery: (...args: any[]) => mockMasterQuery(...args),
    masterTransaction: (...args: any[]) => mockTransaction(...args),
    pool: { end: jest.fn(), query: jest.fn() },
    initDB: jest.fn(), initTenantSchema: jest.fn(),
    makePoolQuery: jest.fn(), makePoolTransaction: jest.fn(), seedAgileDefaults: jest.fn(),
}));
jest.mock("../utils/ws", () => ({
    setupWebSocket: jest.fn(), sendToUser: jest.fn(), broadcast: jest.fn(),
    emitCallHistoryMessage: jest.fn(), getWsStats: jest.fn(() => ({})),
}));
jest.mock("../jobs", () => ({
    initJobs: jest.fn(), shutdownJobs: jest.fn(), enqueueChatMediaPipelineJob: jest.fn(),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const { app } = require("../index");

describe("application middleware order", () => {
    it("mounts platform tenant routes before tenant-scoped admin routes", () => {
        const source = require("fs").readFileSync(
            require("path").join(__dirname, "../http/routes.ts"),
            "utf8",
        );
        const platformIndex = source.indexOf('app.use("/api/admin/tenants"');
        const tenantAdminIndex = source.indexOf('app.use("/api/admin",');

        expect(platformIndex).toBeGreaterThanOrEqual(0);
        expect(tenantAdminIndex).toBeGreaterThan(platformIndex);
    });

    it("serves master tenant-console endpoints to a tenantless platform admin", async () => {
        const token = jwt.sign(
            { id: 1, username: "platform", tv: 0, platform: true },
            process.env.JWT_SECRET,
            { expiresIn: "1h" },
        );

        const [overview, alerts] = await Promise.all([
            request(app).get("/api/admin/tenants/overview").set("Cookie", `token=${token}`),
            request(app).get("/api/admin/tenants/alerts").set("Cookie", `token=${token}`),
        ]);

        expect(overview.status).toBe(200);
        expect(overview.body).toEqual(expect.objectContaining({ total_tenants: 0, total_users: 0 }));
        expect(alerts.status).toBe(200);
        expect(alerts.body).toEqual({ alerts: [] });
    });

    it("lets a webhook request reach its router without the browser CSRF header", async () => {
        // An unknown provider may 404/400 inside the webhook router; the key
        // invariant is that the global CSRF middleware did NOT return 403.
        const res = await request(app)
            // This is the real router shape. A non-numeric id is rejected by
            // webhooks.ts itself with 400 before any DB access.
            .post("/api/webhooks/github/not-a-number")
            .send({ ping: true });
        // The webhook router may itself return 403 for an invalid provider or
        // signature. What must not happen is the GLOBAL browser-CSRF response.
        expect(res.body?.error).not.toBe("Missing CSRF header");
    });

    it("blocks an ordinary mutating API request without the CSRF header", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .send({ username: "nobody", password: "nope" });
        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Missing CSRF header" });
    });

    it("accepts the AINO CSRF header and passes beyond the guard", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .set("X-Requested-With", "AINO")
            .send({ username: "nobody", password: "nope" });
        expect(res.body?.error).not.toBe("Missing CSRF header");
    });
});