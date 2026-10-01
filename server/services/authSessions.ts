import { randomUUID } from "crypto";

/**
 * Sessions no longer expire on their own: one lives until logout, a password
 * change / token-version bump, or a newer sign-in on the same device replacing
 * it. Users may be signed in on several devices at once (web, desktop, phones);
 * each device that sends `X-AINO-Device-Id` keeps exactly one session, and
 * every user is pruned to the [MAX_SESSIONS_PER_USER] most recent sessions.
 * The JWT is long-lived and rolled forward by `/auth/refresh`; every request
 * still checks the `sid` row, so revocation stays immediate.
 */
const AUTH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const AUTH_TOKEN_TTL_MS = AUTH_TOKEN_TTL_SECONDS * 1000;
const MAX_SESSIONS_PER_USER = 10;

type QueryResult = { rows: any[]; rowCount?: number | null };
type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
interface DbLike { query: Query; }

/** A client-generated install id: opaque, bounded, header-safe; anything else is ignored. */
function normalizeDeviceId(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(raw) ? raw : null;
}

/** Tenant sign-in: one session per device, concurrent across devices. */
async function createDeviceSession(userId: number, device: unknown, deviceId: string | null, db: DbLike): Promise<string> {
    const sid = randomUUID();
    if (deviceId) {
        await db.query(
            `INSERT INTO user_sessions (id, user_id, device, device_id, created_at, last_activity_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())
             ON CONFLICT (user_id, device_id) WHERE device_id IS NOT NULL DO UPDATE
             SET id = EXCLUDED.id,
                 device = EXCLUDED.device,
                 created_at = EXCLUDED.created_at,
                 last_activity_at = EXCLUDED.last_activity_at`,
            [sid, userId, device || null, deviceId],
        );
    } else {
        await db.query(
            `INSERT INTO user_sessions (id, user_id, device, created_at, last_activity_at)
             VALUES ($1, $2, $3, NOW(), NOW())`,
            [sid, userId, device || null],
        );
    }
    await db.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1 AND id NOT IN (
             SELECT id FROM user_sessions WHERE user_id = $1
             ORDER BY last_activity_at DESC, created_at DESC LIMIT $2
         )`,
        [userId, MAX_SESSIONS_PER_USER],
    );
    return sid;
}

async function createConcurrentSession(userId: number, device: unknown, db: DbLike): Promise<string> {
    const sid = randomUUID();
    await db.query(
        `INSERT INTO user_sessions (id, user_id, device, created_at, last_activity_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [sid, userId, device || null],
    );
    return sid;
}

async function validateSession(userId: number, sid: string, db: DbLike): Promise<"active" | "missing"> {
    const row = (await db.query(
        "SELECT 1 FROM user_sessions WHERE id = $1 AND user_id = $2",
        [sid, userId],
    )).rows[0];
    return row ? "active" : "missing";
}

/** Records last activity for auditing; returns false when the session no longer exists. */
async function touchSession(userId: number, sid: string, db: DbLike): Promise<boolean> {
    const result = await db.query(
        "UPDATE user_sessions SET last_activity_at = NOW() WHERE id = $1 AND user_id = $2",
        [sid, userId],
    );
    return (result.rowCount || 0) > 0;
}

export { AUTH_TOKEN_TTL_SECONDS, AUTH_TOKEN_TTL_MS, MAX_SESSIONS_PER_USER, normalizeDeviceId, createDeviceSession, createConcurrentSession, validateSession, touchSession };
