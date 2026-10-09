import { randomUUID } from "crypto";

/**
 * Sessions no longer expire on their own: one lives until logout, a password
 * change / token-version bump, or a newer sign-in replacing it.
 *
 * Tenant users get ONE active session per client class: one phone
 * (`mobile`: the native apps) and one browser / desktop app (`web`). Signing
 * in on a second phone ends the first phone's session; the caller closes the
 * revoked sessions' sockets right away (services/sessionRevocation.ts).
 * Platform operators keep independent concurrent sessions.
 *
 * The JWT is long-lived and rolled forward by `/auth/refresh`; every request
 * still checks the `sid` row, so revocation stays immediate.
 */
const AUTH_TOKEN_TTL_SECONDS = 365 * 24 * 60 * 60;
const AUTH_TOKEN_TTL_MS = AUTH_TOKEN_TTL_SECONDS * 1000;
const MAX_SESSIONS_PER_USER = 10;

type ClientClass = "mobile" | "web";

type QueryResult = { rows: any[]; rowCount?: number | null };
type Query = (sql: string, params?: unknown[]) => Promise<QueryResult>;
interface DbLike { query: Query; }

/** A client-generated install id: opaque, bounded, header-safe; anything else is ignored. */
function normalizeDeviceId(value: unknown): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    return typeof raw === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(raw) ? raw : null;
}

/** A session that a newer sign-in ended: its id and the phone it lived on (null for browsers). */
interface RevokedSession { sid: string; deviceId: string | null; }

const revokedRows = (result: QueryResult): RevokedSession[] =>
    result.rows.map((row) => ({ sid: String(row.id), deviceId: row.device_id || null }));

/**
 * Tenant sign-in: replaces every other session of the same user and client
 * class. Returns the new sid and the sessions that were ended, so the caller
 * can sign those devices out immediately.
 */
async function createDeviceSession(
    userId: number,
    device: unknown,
    deviceId: string | null,
    clientClass: ClientClass,
    db: DbLike,
): Promise<{ sid: string; revoked: RevokedSession[] }> {
    const sid = randomUUID();
    let revoked: RevokedSession[];
    try {
        revoked = revokedRows(await db.query(
            "DELETE FROM user_sessions WHERE user_id = $1 AND (client_class = $2 OR device_id = $3) RETURNING id, device_id",
            [userId, clientClass, deviceId],
        ));
        await db.query(
            `INSERT INTO user_sessions (id, user_id, device, device_id, client_class, created_at, last_activity_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
            [sid, userId, device || null, deviceId, clientClass],
        );
    } catch (err) {
        if (!isMissingClientClass(err)) throw err;
        // Tenant DB not yet migrated (0010): replace this device's row only.
        revoked = revokedRows(await db.query(
            "DELETE FROM user_sessions WHERE user_id = $1 AND device_id = $2 RETURNING id, device_id",
            [userId, deviceId],
        ));
        await db.query(
            `INSERT INTO user_sessions (id, user_id, device, device_id, created_at, last_activity_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [sid, userId, device || null, deviceId],
        );
    }
    revoked.push(...revokedRows(await db.query(
        `DELETE FROM user_sessions
         WHERE user_id = $1 AND id NOT IN (
             SELECT id FROM user_sessions WHERE user_id = $1
             ORDER BY last_activity_at DESC, created_at DESC LIMIT $2
         )
         RETURNING id, device_id`,
        [userId, MAX_SESSIONS_PER_USER],
    )));
    return { sid, revoked: revoked.filter((session) => session.sid !== sid) };
}

function isMissingClientClass(err: unknown): boolean {
    return /client_class/i.test((err as Error)?.message || "");
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

/** The user's sessions, most recently active first (signed-in devices list). */
async function listUserSessions(userId: number, db: DbLike): Promise<Array<{
    id: string; device: string | null; device_id: string | null; client_class: string | null;
    created_at: string; last_activity_at: string;
}>> {
    try {
        return (await db.query(
            `SELECT id, device, device_id, client_class, created_at, last_activity_at
               FROM user_sessions WHERE user_id = $1
              ORDER BY last_activity_at DESC, created_at DESC`,
            [userId],
        )).rows;
    } catch (err) {
        if (!isMissingClientClass(err)) throw err;
        return (await db.query(
            `SELECT id, device, device_id, NULL AS client_class, created_at, last_activity_at
               FROM user_sessions WHERE user_id = $1
              ORDER BY last_activity_at DESC, created_at DESC`,
            [userId],
        )).rows;
    }
}

/** Ends one of the user's own sessions; null when it does not exist or is not theirs. */
async function revokeUserSession(userId: number, sid: string, db: DbLike): Promise<{ deviceId: string | null } | null> {
    const row = (await db.query("DELETE FROM user_sessions WHERE id = $1 AND user_id = $2 RETURNING device_id", [sid, userId])).rows[0];
    return row ? { deviceId: row.device_id || null } : null;
}

/** Records last activity for auditing; returns false when the session no longer exists. */
async function touchSession(userId: number, sid: string, db: DbLike): Promise<boolean> {
    const result = await db.query(
        "UPDATE user_sessions SET last_activity_at = NOW() WHERE id = $1 AND user_id = $2",
        [sid, userId],
    );
    return (result.rowCount || 0) > 0;
}

export type { ClientClass, RevokedSession };
export { AUTH_TOKEN_TTL_SECONDS, AUTH_TOKEN_TTL_MS, MAX_SESSIONS_PER_USER, normalizeDeviceId, createDeviceSession, createConcurrentSession, validateSession, touchSession, listUserSessions, revokeUserSession };
