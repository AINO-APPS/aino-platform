import { randomUUID } from "crypto";

/**
 * Sessions no longer expire on their own: one lives until logout, a password
 * change / token-version bump, or a newer sign-in replacing it (one session per
 * user). The JWT is long-lived and rolled forward by `/auth/refresh`; every
 * request still checks the `sid` row, so revocation stays immediate.
 */
const AUTH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const AUTH_TOKEN_TTL_MS = AUTH_TOKEN_TTL_SECONDS * 1000;

type QueryResult = { rows: any[]; rowCount?: number | null };
type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
interface DbLike { query: Query; }

async function replaceSession(userId: number, device: unknown, db: DbLike): Promise<string> {
    const sid = randomUUID();
    await db.query(
        `INSERT INTO user_sessions (id, user_id, device, created_at, last_activity_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE
         SET id = EXCLUDED.id,
             device = EXCLUDED.device,
             created_at = EXCLUDED.created_at,
             last_activity_at = EXCLUDED.last_activity_at`,
        [sid, userId, device || null],
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

export { AUTH_TOKEN_TTL_SECONDS, AUTH_TOKEN_TTL_MS, replaceSession, createConcurrentSession, validateSession, touchSession };
