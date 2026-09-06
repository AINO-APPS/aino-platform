export {};

const { SESSION_IDLE_MS, replaceSession, validateSession, touchSession } = require("../services/authSessions");

describe("authentication sessions", () => {
    test("atomically replaces the user's only session", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        const sid = await replaceSession(7, "browser", { query });
        expect(typeof sid).toBe("string");
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain("ON CONFLICT (user_id) DO UPDATE");
        expect(query.mock.calls[0][1]).toEqual([sid, 7, "browser"]);
    });

    test("accepts a session active within the two-day window", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [{ last_activity_at: new Date(Date.now() - SESSION_IDLE_MS + 60_000) }], rowCount: 1 });
        await expect(validateSession(7, "sid", { query })).resolves.toBe("active");
        expect(query).toHaveBeenCalledTimes(1);
    });

    test("deletes and rejects a session idle for two days", async () => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ last_activity_at: new Date(Date.now() - SESSION_IDLE_MS) }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });
        await expect(validateSession(7, "sid", { query })).resolves.toBe("idle");
        expect(query.mock.calls[1][0]).toContain("DELETE FROM user_sessions");
    });

    test("renews activity only for a still-active session", async () => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
        await expect(touchSession(7, "sid", { query })).resolves.toBe(true);
        expect(query.mock.calls[0][0]).toContain("INTERVAL '2 days'");
    });
});