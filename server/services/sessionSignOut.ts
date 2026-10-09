import { logger } from "../utils/logger";
import { closeSessionSockets } from "../realtime/sessionRevocation";
import { pushNotifications } from "./pushNotifications";
import type { RevokedSession } from "./authSessions";
const redis = require("../redis");

/** Socket close reason for a session replaced by a sign-in on another device. */
export const SIGNED_IN_ELSEWHERE = "Signed in on another device";

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

/**
 * After deleting `user_sessions` rows: drop the cached session list and close
 * the ended sessions' sockets right away ([sessionIds] null = every session,
 * minus [keepSessionId]). Without this a revoked device kept its live socket
 * until the next periodic re-check.
 */
export async function endUserSessions(
    tenantId: number | string | null | undefined,
    userId: number,
    reason: string,
    sessionIds: string[] | null = null,
    keepSessionId: string | null = null,
): Promise<void> {
    const tenant = tenantId ? Number(tenantId) : null;
    await redis.invalidateUserSessions(tenant, userId);
    closeSessionSockets(tenant, userId, sessionIds, reason, keepSessionId);
}

/**
 * Phones whose session just ended: remove their push tokens (no more call or
 * message pushes) and send them a data-only `session_revoked` push so a
 * backgrounded or killed app clears its credential too. Best effort.
 */
export function pushSessionRevoked(db: { query: Query }, tenantId: number | null, userId: number, deviceIds: Array<string | null | undefined>): void {
    const ids = [...new Set(deviceIds.filter((id): id is string => !!id))];
    if (ids.length === 0) return;
    void (async () => {
        const tokens = (await db.query(
            "DELETE FROM device_tokens WHERE user_id = $1 AND device_id = ANY($2) RETURNING device_token",
            [userId, ids],
        )).rows.map((row) => String(row.device_token));
        if (tokens.length) {
            await pushNotifications.sendSessionRevoked((sql: string, values?: unknown[]) => db.query(sql, values) as any, tokens, tenantId);
        }
    })().catch((err: any) => {
        // device_tokens.device_id arrives with migration 0010; older tenants rely on the socket close.
        logger.warn({ err: err?.message, userId, tenantId }, "session sign-out push skipped");
    });
}

/**
 * A newer sign-in ended [revoked] sessions. Close their sockets on every
 * realtime instance and push-sign-out the other phones. A row of the device
 * that is signing in right now ([currentDeviceId]) is only replaced: that
 * phone keeps its push token and gets no sign-out push.
 */
export function signOutRevokedSessions(params: {
    db: { query: Query };
    tenantId: number | null;
    userId: number;
    revoked: RevokedSession[];
    currentDeviceId?: string | null;
}): void {
    const { db, tenantId, userId, revoked, currentDeviceId } = params;
    if (revoked.length === 0) return;
    closeSessionSockets(tenantId, userId, revoked.map((session) => session.sid), SIGNED_IN_ELSEWHERE);
    pushSessionRevoked(db, tenantId, userId, revoked.map((session) => session.deviceId).filter((id) => id !== currentDeviceId));
}