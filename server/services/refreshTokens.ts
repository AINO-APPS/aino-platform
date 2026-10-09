import { createHash, randomBytes, timingSafeEqual } from "crypto";

/**
 * Rotating refresh tokens for the native apps (P2.7).
 *
 * A native sign-in gets a short-lived access JWT ([MOBILE_ACCESS_TTL_SECONDS])
 * plus an opaque refresh token bound to its `user_sessions` row. Every
 * `POST /auth/token` swaps the refresh token for a new one; only SHA-256
 * hashes are stored. Presenting the *previous* token again means it was copied
 * (the real app already rotated past it), so the whole session is revoked.
 *
 * Token format: `<tenantId>.<sid>.<secret>`: the tenant id picks the database
 * (the access token may already be expired) and the sid locates the row.
 *
 * Opt-in: only an app that sends `X-AINO-Token-Refresh: rotate` on sign-in
 * gets the short access token, so installed older builds keep working.
 */
export const MOBILE_ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_OPT_IN_HEADER = "x-aino-token-refresh";

/** A request that raced the previous rotation may present the old token this long without revoking. */
const ROTATION_GRACE_MS = 30_000;

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
interface DbLike { query: Query; }

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

function sameHash(a: string | null | undefined, b: string): boolean {
    if (!a || a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** True when the request asked for rotating refresh tokens. */
export function wantsRotatingRefresh(headers: Record<string, unknown> | undefined): boolean {
    return String(headers?.[REFRESH_OPT_IN_HEADER] || "").toLowerCase() === "rotate";
}

/** Split `<tenantId>.<sid>.<secret>`; null when malformed. */
export function parseRefreshToken(token: unknown): { tenantId: number; sid: string; secret: string } | null {
    if (typeof token !== "string" || token.length > 300) return null;
    const match = /^([1-9][0-9]{0,9})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{40,})$/i.exec(token);
    return match ? { tenantId: Number(match[1]), sid: match[2], secret: match[3] } : null;
}

/** Mint the first refresh token of a session (sign-in). Null on an unmigrated DB. */
export async function issueRefreshToken(sid: string, userId: number, tenantId: number, db: DbLike): Promise<string | null> {
    const secret = randomBytes(32).toString("base64url");
    try {
        const result = await db.query(
            "UPDATE user_sessions SET refresh_hash = $1, refresh_prev_hash = NULL, refresh_rotated_at = NOW() WHERE id = $2 AND user_id = $3",
            [hash(secret), sid, userId],
        );
        return (result.rowCount || 0) > 0 ? `${tenantId}.${sid}.${secret}` : null;
    } catch (err) {
        if (/refresh_/i.test((err as Error)?.message || "")) return null;
        throw err;
    }
}

export type RotationResult =
    | { status: "rotated"; refreshToken: string; userId: number; sid: string }
    | { status: "invalid" }
    | { status: "reused"; userId: number; sid: string; deviceId: string | null };

/**
 * Swap [token] for a new refresh token. `reused` means a stolen copy was
 * replayed: its session row is already deleted and the caller signs it out.
 */
export async function rotateRefreshToken(token: unknown, db: DbLike, now = Date.now()): Promise<RotationResult> {
    const parsed = parseRefreshToken(token);
    if (!parsed) return { status: "invalid" };
    const row = (await db.query(
        "SELECT user_id, refresh_hash, refresh_prev_hash, refresh_rotated_at FROM user_sessions WHERE id = $1",
        [parsed.sid],
    )).rows[0];
    if (!row) return { status: "invalid" };
    const presented = hash(parsed.secret);

    const secret = randomBytes(32).toString("base64url");
    if (!sameHash(row.refresh_hash, presented)) {
        if (!sameHash(row.refresh_prev_hash, presented)) return { status: "invalid" };
        const rotatedAt = row.refresh_rotated_at ? new Date(row.refresh_rotated_at).getTime() : 0;
        if (now - rotatedAt > ROTATION_GRACE_MS) {
            const gone = (await db.query("DELETE FROM user_sessions WHERE id = $1 RETURNING device_id", [parsed.sid])).rows[0];
            return { status: "reused", userId: Number(row.user_id), sid: parsed.sid, deviceId: gone?.device_id || null };
        }
        // The previous rotation's response was lost (dropped network) or raced:
        // within the grace window hand out a new pair, keeping the same "previous".
        const retried = await db.query(
            "UPDATE user_sessions SET refresh_hash = $1, last_activity_at = NOW() WHERE id = $2 AND refresh_prev_hash = $3",
            [hash(secret), parsed.sid, presented],
        );
        if ((retried.rowCount || 0) === 0) return { status: "invalid" };
        return { status: "rotated", refreshToken: `${parsed.tenantId}.${parsed.sid}.${secret}`, userId: Number(row.user_id), sid: parsed.sid };
    }

    const updated = await db.query(
        `UPDATE user_sessions
            SET refresh_prev_hash = refresh_hash, refresh_hash = $1, refresh_rotated_at = NOW(), last_activity_at = NOW()
          WHERE id = $2 AND refresh_hash = $3`,
        [hash(secret), parsed.sid, presented],
    );
    // Lost a race with a parallel rotation of the same token: treat as invalid, never as theft.
    if ((updated.rowCount || 0) === 0) return { status: "invalid" };
    return { status: "rotated", refreshToken: `${parsed.tenantId}.${parsed.sid}.${secret}`, userId: Number(row.user_id), sid: parsed.sid };
}

/**
 * Sign-in token terms: an app that opted in gets a short access token and a
 * refresh token; everyone else keeps the long-lived rolling token.
 */
export async function sessionTokenTerms(params: {
    optIn: boolean; sid: string; userId: number; tenantId: number | null; db: DbLike; longTtlSeconds: number;
}): Promise<{ expiresIn: number; refreshToken?: string }> {
    const { optIn, sid, userId, tenantId, db, longTtlSeconds } = params;
    if (!optIn || !tenantId) return { expiresIn: longTtlSeconds };
    const refreshToken = await issueRefreshToken(sid, userId, tenantId, db);
    return refreshToken ? { expiresIn: MOBILE_ACCESS_TTL_SECONDS, refreshToken } : { expiresIn: longTtlSeconds };
}

/** The fields an access token is minted from. */
export async function loadTokenUser(userId: number, db: DbLike): Promise<{ id: number; username: string; token_version: number | null; is_active: boolean } | undefined> {
    return (await db.query("SELECT id, username, token_version, is_active FROM users WHERE id = $1", [userId])).rows[0];
}

/** True when [sid] refreshes through rotation, so `/auth/refresh` must not mint a long-lived token for it. */
export async function sessionUsesRotation(sid: string, db: DbLike): Promise<boolean> {
    try {
        return !!(await db.query("SELECT refresh_hash FROM user_sessions WHERE id = $1", [sid])).rows[0]?.refresh_hash;
    } catch {
        return false; // tenant DB not yet migrated: no rotating sessions exist there
    }
}
