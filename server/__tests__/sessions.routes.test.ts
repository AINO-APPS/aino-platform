export {};

const listUserSessions = jest.fn();
const revokeUserSession = jest.fn();
const endUserSessions = jest.fn().mockResolvedValue(undefined);
const pushSessionRevoked = jest.fn();
const rotateRefreshToken = jest.fn();
const loadTokenUser = jest.fn();
const tenantQuery = jest.fn();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 7; req.sessionId = "current"; req.tenantId = 3; req.db = { query: jest.fn() };
    next();
});
jest.mock("../services/authSessions", () => ({ listUserSessions, revokeUserSession }));
jest.mock("../services/sessionSignOut", () => ({ endUserSessions, pushSessionRevoked: (...a: unknown[]) => pushSessionRevoked(...a) }));
jest.mock("../services/refreshTokens", () => ({
    ...jest.requireActual("../services/refreshTokens"),
    rotateRefreshToken: (...args: unknown[]) => rotateRefreshToken(...args),
    loadTokenUser: (...args: unknown[]) => loadTokenUser(...args),
}));
jest.mock("../utils/tenantManager", () => ({
    getTenantById: jest.fn(async (id: number) => (id === 3 ? { id: 3, status: "active", db_name: "t3", db_host: null } : null)),
    getTenantPool: jest.fn(async () => ({ query: tenantQuery })),
}));

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const router = require("../routes/sessions").default;

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
const SID = "0b5f6c1e-6d2a-4f7c-9a51-3b2d1c0e9f8a";
const REFRESH = `3.${SID}.${"a".repeat(43)}`;

function app() {
    const a = express();
    a.use(express.json());
    a.use((req: any, _res: any, next: any) => { req.log = { error: jest.fn(), warn: jest.fn() }; next(); });
    a.use("/api/sessions", router);
    return a;
}

describe("/api/sessions", () => {
    beforeEach(() => jest.clearAllMocks());

    test("lists the caller's devices with readable names and marks this one", async () => {
        listUserSessions.mockResolvedValue([
            { id: "current", device: "Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537", device_id: null, client_class: "web", created_at: "a", last_activity_at: "b" },
            { id: "phone", device: "okhttp/4.12.0", device_id: "dev12345", client_class: "mobile", created_at: "c", last_activity_at: "d" },
        ]);
        const res = await request(app()).get("/api/sessions");
        expect(res.status).toBe(200);
        expect(res.body).toEqual([
            { id: "current", device: "Chrome on Windows", clientClass: "web", createdAt: "a", lastActiveAt: "b", current: true },
            { id: "phone", device: "AINO for Android", clientClass: "mobile", createdAt: "c", lastActiveAt: "d", current: false },
        ]);
        expect(listUserSessions).toHaveBeenCalledWith(7, expect.anything());
    });

    test("signs another device out right away, never the current one", async () => {
        revokeUserSession.mockResolvedValue({ deviceId: "dev-phone" });
        expect((await request(app()).delete("/api/sessions/phone")).status).toBe(200);
        expect(endUserSessions).toHaveBeenCalledWith(3, 7, "Signed out from another device", ["phone"]);
        expect(pushSessionRevoked).toHaveBeenCalledWith(expect.anything(), 3, 7, ["dev-phone"]);

        const self = await request(app()).delete("/api/sessions/current");
        expect(self.status).toBe(400);
        expect(self.body.code).toBe("CURRENT_SESSION");

        revokeUserSession.mockResolvedValue(null);
        expect((await request(app()).delete("/api/sessions/someone-else")).status).toBe(404);
    });

    test("swaps a refresh token for a short access token and the next refresh token", async () => {
        rotateRefreshToken.mockResolvedValue({ status: "rotated", refreshToken: "next", userId: 7, sid: SID });
        loadTokenUser.mockResolvedValue({ id: 7, username: "ana", token_version: 2, is_active: true });
        const res = await request(app()).post("/api/sessions/token").send({ refreshToken: REFRESH });
        expect(res.status).toBe(200);
        expect(res.body.refreshToken).toBe("next");
        expect(res.body.expiresIn).toBe(900);
        const claims = jwt.verify(res.body.token, process.env.JWT_SECRET);
        expect(claims).toMatchObject({ id: 7, tv: 2, sid: SID, tenant_id: 3, aud: "tenant", cli: "mobile" });
        expect(claims.exp - claims.iat).toBe(900);
    });

    test("a replayed refresh token ends that session and signs the device out", async () => {
        rotateRefreshToken.mockResolvedValue({ status: "reused", userId: 7, sid: SID, deviceId: "dev-thief" });
        const res = await request(app()).post("/api/sessions/token").send({ refreshToken: REFRESH });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("REFRESH_REUSED");
        expect(endUserSessions).toHaveBeenCalledWith(3, 7, "Session ended", [SID]);
        expect(pushSessionRevoked).toHaveBeenCalledWith(expect.anything(), 3, 7, ["dev-thief"]);
    });

    test("refuses malformed tokens, unknown tenants and deactivated users", async () => {
        expect((await request(app()).post("/api/sessions/token").send({ refreshToken: "bad" })).status).toBe(401);
        expect((await request(app()).post("/api/sessions/token").send({ refreshToken: `9.${SID}.${"a".repeat(43)}` })).status).toBe(401);
        rotateRefreshToken.mockResolvedValue({ status: "rotated", refreshToken: "next", userId: 7, sid: SID });
        loadTokenUser.mockResolvedValue({ id: 7, username: "ana", token_version: 0, is_active: false });
        const res = await request(app()).post("/api/sessions/token").send({ refreshToken: REFRESH });
        expect(res.status).toBe(401);
        expect(revokeUserSession).toHaveBeenCalledWith(7, SID, expect.anything());
    });
});
