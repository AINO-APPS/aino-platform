export {};

const { createHash } = require("crypto");
const {
    MOBILE_ACCESS_TTL_SECONDS, parseRefreshToken, issueRefreshToken, rotateRefreshToken, sessionTokenTerms, wantsRotatingRefresh,
} = require("../services/refreshTokens");

const SID = "0b5f6c1e-6d2a-4f7c-9a51-3b2d1c0e9f8a";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** In-memory user_sessions row driven by the SQL the service sends. */
function store(row: Record<string, any> | null) {
    const query = jest.fn(async (sql: string, params: any[]) => {
        if (sql.startsWith("UPDATE user_sessions SET refresh_hash = $1, refresh_prev_hash = NULL")) {
            if (!row) return { rows: [], rowCount: 0 };
            Object.assign(row, { refresh_hash: params[0], refresh_prev_hash: null, refresh_rotated_at: new Date() });
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("SELECT user_id, refresh_hash")) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        if (sql.includes("SET refresh_prev_hash = refresh_hash")) {
            if (!row || row.refresh_hash !== params[2]) return { rows: [], rowCount: 0 };
            Object.assign(row, { refresh_prev_hash: row.refresh_hash, refresh_hash: params[0], refresh_rotated_at: new Date() });
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("UPDATE user_sessions SET refresh_hash = $1, last_activity_at = NOW() WHERE id = $2 AND refresh_prev_hash = $3")) {
            if (!row || row.refresh_prev_hash !== params[2]) return { rows: [], rowCount: 0 };
            row.refresh_hash = params[0];
            return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("SELECT refresh_hash FROM user_sessions")) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        if (sql.startsWith("DELETE FROM user_sessions")) { const gone = row; row = null; return { rows: gone ? [{ device_id: gone.device_id ?? null }] : [], rowCount: 1 }; }
        throw new Error(`unexpected SQL: ${sql}`);
    });
    return { query, get row() { return row; } };
}

describe("rotating refresh tokens", () => {
    test("only an app that asks for rotation gets a short access token", async () => {
        expect(wantsRotatingRefresh({ "x-aino-token-refresh": "rotate" })).toBe(true);
        expect(wantsRotatingRefresh({})).toBe(false);
        const db = store({ user_id: 7 });
        const short = await sessionTokenTerms({ optIn: true, sid: SID, userId: 7, tenantId: 3, db, longTtlSeconds: 999 });
        expect(short.expiresIn).toBe(MOBILE_ACCESS_TTL_SECONDS);
        expect(parseRefreshToken(short.refreshToken)).toMatchObject({ tenantId: 3, sid: SID });
        expect(await sessionTokenTerms({ optIn: false, sid: SID, userId: 7, tenantId: 3, db, longTtlSeconds: 999 })).toEqual({ expiresIn: 999 });
        expect(await sessionTokenTerms({ optIn: true, sid: SID, userId: 7, tenantId: null, db, longTtlSeconds: 999 })).toEqual({ expiresIn: 999 });
    });

    test("stores only a hash and rotates on every use", async () => {
        const db = store({ user_id: 7 });
        const first = await issueRefreshToken(SID, 7, 3, db);
        const secret = parseRefreshToken(first).secret;
        expect(db.row!.refresh_hash).toBe(sha(secret));
        expect(JSON.stringify(db.row)).not.toContain(secret);

        const next = await rotateRefreshToken(first, db);
        expect(next).toMatchObject({ status: "rotated", userId: 7, sid: SID });
        expect(next.refreshToken).not.toBe(first);
        expect(db.row!.refresh_prev_hash).toBe(sha(secret));
    });

    test("a replayed old token after the grace window revokes the session", async () => {
        const db = store({ user_id: 7, device_id: "dev-1" });
        const first = await issueRefreshToken(SID, 7, 3, db);
        await rotateRefreshToken(first, db);
        expect(await rotateRefreshToken(first, db, Date.now() + 31_000)).toEqual({ status: "reused", userId: 7, sid: SID, deviceId: "dev-1" });
        expect(db.row).toBeNull();
    });

    test("a lost rotation response is recovered inside the grace window", async () => {
        const db = store({ user_id: 7 });
        const first = await issueRefreshToken(SID, 7, 3, db);
        const lost = await rotateRefreshToken(first, db); // response never reached the phone
        const retry = await rotateRefreshToken(first, db);
        expect(retry).toMatchObject({ status: "rotated", userId: 7, sid: SID });
        expect(retry.refreshToken).not.toBe(lost.refreshToken);
        // The pair handed out by the retry works; the one that was lost no longer does.
        expect((await rotateRefreshToken(retry.refreshToken, db)).status).toBe("rotated");
        expect((await rotateRefreshToken(lost.refreshToken, db)).status).toBe("invalid");
    });

    test("tells /auth/refresh which sessions rotate", async () => {
        const { sessionUsesRotation } = require("../services/refreshTokens");
        const db = store({ user_id: 7 });
        expect(await sessionUsesRotation(SID, db)).toBe(false);
        await issueRefreshToken(SID, 7, 3, db);
        expect(await sessionUsesRotation(SID, db)).toBe(true);
    });

    test("rejects malformed tokens, unknown sessions and an unmigrated database", async () => {
        expect(parseRefreshToken("nope")).toBeNull();
        expect(parseRefreshToken(`0.${SID}.${"a".repeat(43)}`)).toBeNull();
        expect(await rotateRefreshToken("x.y.z", store(null))).toEqual({ status: "invalid" });
        expect(await rotateRefreshToken(`3.${SID}.${"a".repeat(43)}`, store(null))).toEqual({ status: "invalid" });
        const old = { query: jest.fn().mockRejectedValue(new Error('column "refresh_hash" does not exist')) };
        expect(await issueRefreshToken(SID, 7, 3, old)).toBeNull();
    });
});
