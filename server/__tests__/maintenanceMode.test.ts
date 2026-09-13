export {};

const mockIsMaintenanceMode = jest.fn();
const mockGetMaintenanceMessage = jest.fn();

jest.mock("../utils/platformConfig", () => ({
    isMaintenanceMode: (...args: any[]) => mockIsMaintenanceMode(...args),
    getMaintenanceMessage: (...args: any[]) => mockGetMaintenanceMessage(...args),
}));

jest.mock("../utils/logger", () => ({
    logger: { warn: jest.fn() },
}));

import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
const request = require("supertest");
const { maintenanceModeMiddleware, invalidateMaintenanceCache } = require("../middleware/maintenanceMode");

const SECRET = "maintenance-mode-test-secret";
const CONSOLE_HOST = "console.aino.org.in";
const TENANT_HOST = "app.aino.org.in";

function token(claims: Record<string, unknown>): string {
    return jwt.sign(claims, SECRET, { expiresIn: "1h" });
}

function buildApp() {
    const app = express();
    app.use(cookieParser());
    app.use("/api", maintenanceModeMiddleware);
    app.all("/api/*path", (req, res) => res.json({ path: req.path }));
    return app;
}

describe("maintenanceModeMiddleware", () => {
    beforeAll(() => {
        process.env.JWT_SECRET = SECRET;
        process.env.CONSOLE_HOST = CONSOLE_HOST;
    });

    beforeEach(() => {
        mockIsMaintenanceMode.mockReset().mockResolvedValue(true);
        mockGetMaintenanceMessage.mockReset().mockResolvedValue("Planned maintenance");
        invalidateMaintenanceCache();
    });

    test.each([
        "/api/auth/login",
        "/api/auth/login/realm",
        "/api/auth/handoff",
        "/api/auth/biometric/login",
        "/api/auth/webauthn/login/options",
        "/api/auth/webauthn/login/verify",
    ])("allows the sign-in flow while mounted at /api: %s", async path => {
        const res = await request(buildApp()).post(path).set("Host", CONSOLE_HOST);

        expect(res.status).toBe(200);
    });

    test("allows a platform admin cookie to reach protected console routes", async () => {
        const platformToken = token({ id: 7, platform: true, tenant_id: null, aud: "platform" });
        const res = await request(buildApp())
            .get("/api/admin/tenants/platform-config")
            .set("Host", CONSOLE_HOST)
            .set("Cookie", `aino_console=${platformToken}`);

        expect(res.status).toBe(200);
    });

    test("blocks tenant users even when their token has an admin role", async () => {
        const tenantToken = token({ id: 8, role: "platform_admin", tenant_id: 2, aud: "tenant" });
        const res = await request(buildApp())
            .get("/api/profile")
            .set("Host", TENANT_HOST)
            .set("Authorization", `Bearer ${tenantToken}`);

        expect(res.status).toBe(503);
        expect(res.body).toEqual({ error: "maintenance", message: "Planned maintenance" });
    });

    test("does not accept a tenant-realm token on the console host", async () => {
        const tenantToken = token({ id: 8, platform: true, tenant_id: null, aud: "tenant" });
        const res = await request(buildApp())
            .get("/api/admin/tenants/platform-config")
            .set("Host", CONSOLE_HOST)
            .set("Cookie", `aino_console=${tenantToken}`);

        expect(res.status).toBe(503);
    });

    test("blocks anonymous non-authentication API requests", async () => {
        const res = await request(buildApp()).get("/api/profile").set("Host", TENANT_HOST);

        expect(res.status).toBe(503);
    });
});