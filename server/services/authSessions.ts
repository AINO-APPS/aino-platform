import { randomUUID } from "crypto";

const SESSION_IDLE_MS = 2 * 24 * 60 * 60 * 1000;

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

async function validateSession(userId: number, sid: string, db: DbLike): Promise<"active" | "missing" | "idle"> {
    const row = (await db.query(
        "SELECT last_activity_at FROM user_sessions WHERE id = $1 AND user_id = $2",
        [sid, userId],
    )).rows[0];
    if (!row) return "missing";
    const lastActivity = new Date(row.last_activity_at).getTime();
    if (!Number.isFinite(lastActivity) || Date.now() - lastActivity >= SESSION_IDLE_MS) {
        await db.query("DELETE FROM user_sessions WHERE id = $1 AND user_id = $2", [sid, userId]);
        return "idle";
    }
    return "active";
}

async function touchSession(userId: number, sid: string, db: DbLike): Promise<boolean> {
    const result = await db.query(
        `UPDATE user_sessions SET last_activity_at = NOW()
         WHERE id = $1 AND user_id = $2
           AND last_activity_at > NOW() - INTERVAL '2 days'`,
        [sid, userId],
    );
    return (result.rowCount || 0) > 0;
}

export { SESSION_IDLE_MS, replaceSession, validateSession, touchSession };