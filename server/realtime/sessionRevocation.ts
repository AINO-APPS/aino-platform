import { clients, clientKey } from "./registry";
import { INSTANCE_ID } from "./fanout";
const redis = require("../redis");

/** `ws:broadcast` envelope kind telling every realtime instance to close revoked sessions' sockets. */
export const REVOKE_SESSIONS_KIND = "revoke_sessions";

/**
 * Close this instance's sockets of [userId] that belong to [sessionIds]
 * (every socket of the user when null) with the terminal auth code 4001.
 * Clients treat 4001 as "the server ended this session" and sign out.
 */
export function closeSessionSocketsLocal(
  tenantId: number | null | undefined,
  userId: number,
  sessionIds: string[] | null,
  reason: string,
  keepSessionId: string | null = null,
): number {
  const sockets = clients.get(clientKey(tenantId, userId));
  if (!sockets) return 0;
  let closed = 0;
  for (const ws of [...sockets]) {
    if (sessionIds && !sessionIds.includes(ws._sessionId)) continue;
    if (keepSessionId && ws._sessionId === keepSessionId) continue;
    try {
      ws.close(4001, reason);
      closed++;
    } catch {
      // Socket teardown performs canonical cleanup.
    }
  }
  return closed;
}

/**
 * Close revoked sessions' sockets on every instance right away instead of
 * waiting for the periodic session re-check. HTTP and realtime run as
 * separate roles, so the cross-instance publish is what reaches the socket.
 */
export function closeSessionSockets(
  tenantId: number | null | undefined,
  userId: number,
  sessionIds: string[] | null,
  reason: string,
  keepSessionId: string | null = null,
): void {
  if (sessionIds && sessionIds.length === 0) return;
  closeSessionSocketsLocal(tenantId, userId, sessionIds, reason, keepSessionId);
  redis.publish("ws:broadcast", {
    _from: INSTANCE_ID,
    kind: REVOKE_SESSIONS_KIND,
    tenantId: tenantId ?? null,
    userId,
    sessionIds,
    reason,
    keepSessionId,
  });
}

/** Password change: every other session of the user ended; the caller's stays. */
export function closeOtherSessionSockets(
  tenantId: number | null | undefined,
  userId: number,
  keepSessionId: string | null | undefined,
): void {
  closeSessionSockets(tenantId, userId, null, "Password changed", keepSessionId || null);
}
