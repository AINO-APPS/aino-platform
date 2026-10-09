export {};

const { AUTH_TOKEN_TTL_SECONDS, MAX_SESSIONS_PER_USER, normalizeDeviceId, createDeviceSession, createConcurrentSession, validateSession, touchSession } = require("../services/authSessions");

describe("authentication sessions", () => {
    test("a sign-in ends the user's other sessions of the same client class", async () => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: "old-phone", device_id: "device-old1" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const { sid, revoked } = await createDeviceSession(7, "android", "device-1234", "mobile", { query });
        expect(typeof sid).toBe("string");
        expect(query).toHaveBeenCalledTimes(3);
        expect(query.mock.calls[0][0]).toContain("DELETE FROM user_sessions WHERE user_id = $1 AND (client_class = $2 OR device_id = $3)");
        expect(query.mock.calls[0][1]).toEqual([7, "mobile", "device-1234"]);
        expect(query.mock.calls[1][0]).toContain("client_class");
        expect(query.mock.calls[1][1]).toEqual([sid, 7, "android", "device-1234", "mobile"]);
        expect(query.mock.calls[2][1]).toEqual([7, MAX_SESSIONS_PER_USER]);
        expect(revoked).toEqual([{ sid: "old-phone", deviceId: "device-old1" }]);
    });

    test("a browser sign-in only replaces web sessions", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
        const { revoked } = await createDeviceSession(7, "browser", null, "web", { query });
        expect(query.mock.calls[0][1]).toEqual([7, "web", null]);
        expect(revoked).toEqual([]);
    });

    test("an unmigrated tenant DB falls back to replacing this device only", async () => {
        const query = jest.fn()
            .mockRejectedValueOnce(new Error('column "client_class" does not exist'))
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const { sid } = await createDeviceSession(7, "android", "device-1234", "mobile", { query });
        expect(query.mock.calls[1][1]).toEqual([7, "device-1234"]);
        expect(query.mock.calls[2][0]).not.toContain("client_class");
        expect(query.mock.calls[2][1]).toEqual([sid, 7, "android", "device-1234"]);
    });

    test("never reports the new session as revoked", async () => {
        const query = jest.fn().mockImplementation(async (_sql: string, params: unknown[]) =>
            ({ rows: params && params[1] === MAX_SESSIONS_PER_USER ? [{ id: "pruned", device_id: null }] : [], rowCount: 0 }));
        const { revoked } = await createDeviceSession(7, "browser", null, "web", { query });
        expect(revoked).toEqual([{ sid: "pruned", deviceId: null }]);
    });
    test("accepts only bounded, header-safe device ids", () => {
        expect(normalizeDeviceId("3f2a9c1e-7b4d-4e8f-9a1b-2c3d4e5f6a7b")).toBe("3f2a9c1e-7b4d-4e8f-9a1b-2c3d4e5f6a7b");
        expect(normalizeDeviceId(["abcdefgh"])).toBe("abcdefgh");
        expect(normalizeDeviceId("short")).toBeNull();
        expect(normalizeDeviceId("bad id with spaces")).toBeNull();
        expect(normalizeDeviceId("x".repeat(129))).toBeNull();
        expect(normalizeDeviceId(undefined)).toBeNull();
    });

    test("inserts an independent concurrent platform session", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        const sid = await createConcurrentSession(7, "browser", { query });
        expect(query.mock.calls[0][0]).not.toContain("ON CONFLICT");
        expect(query.mock.calls[0][1]).toEqual([sid, 7, "browser"]);
    });

    test("accepts an existing session however long it has been idle", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }], rowCount: 1 });
        await expect(validateSession(7, "sid", { query })).resolves.toBe("active");
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).not.toContain("DELETE");
    });

    test("rejects a session that was replaced or logged out", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
        await expect(validateSession(7, "sid", { query })).resolves.toBe("missing");
    });

    test("touching activity has no idle cutoff", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        await expect(touchSession(7, "sid", { query })).resolves.toBe(true);
        expect(query.mock.calls[0][0]).not.toContain("INTERVAL");
    });

    test("tokens are long-lived (rolled forward by refresh)", () => {
        expect(AUTH_TOKEN_TTL_SECONDS).toBeGreaterThanOrEqual(365 * 24 * 60 * 60);
    });
});