export {};

const { AUTH_TOKEN_TTL_SECONDS, MAX_SESSIONS_PER_USER, normalizeDeviceId, createDeviceSession, createConcurrentSession, validateSession, touchSession } = require("../services/authSessions");

describe("authentication sessions", () => {
    test("replaces only the same device's session, then prunes old sessions", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        const sid = await createDeviceSession(7, "android", "device-1234", { query });
        expect(typeof sid).toBe("string");
        expect(query).toHaveBeenCalledTimes(2);
        expect(query.mock.calls[0][0]).toContain("ON CONFLICT (user_id, device_id) WHERE device_id IS NOT NULL DO UPDATE");
        expect(query.mock.calls[0][1]).toEqual([sid, 7, "android", "device-1234"]);
        expect(query.mock.calls[1][0]).toContain("DELETE FROM user_sessions");
        expect(query.mock.calls[1][1]).toEqual([7, MAX_SESSIONS_PER_USER]);
    });

    test("a sign-in without a device id adds a concurrent session", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        const sid = await createDeviceSession(7, "browser", null, { query });
        expect(query.mock.calls[0][0]).not.toContain("ON CONFLICT");
        expect(query.mock.calls[0][1]).toEqual([sid, 7, "browser"]);
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