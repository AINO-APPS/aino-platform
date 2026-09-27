export {};

const { AUTH_TOKEN_TTL_SECONDS, replaceSession, createConcurrentSession, validateSession, touchSession } = require("../services/authSessions");

describe("authentication sessions", () => {
    test("atomically replaces the user's only session", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        const sid = await replaceSession(7, "browser", { query });
        expect(typeof sid).toBe("string");
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain("ON CONFLICT (user_id) DO UPDATE");
        expect(query.mock.calls[0][1]).toEqual([sid, 7, "browser"]);
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