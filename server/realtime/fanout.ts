import { logger } from "../utils/logger";
import { pushNotifications } from "../services/pushNotifications";
import { clients, clientKey, type DbLike, type WSType } from "../utils/wsHandlers/shared";
const redis = require("../redis");

export const INSTANCE_ID = `ws-${process.pid}-${Date.now()}`;

/**
 * Deliver a message to a user's local WebSocket connections (this instance only).
 * When tenantId is provided, only delivers to connections belonging to that tenant.
 */
export function deliverLocal(
  tenantId: number | null | undefined,
  userId: number,
  type: WSType,
  data: unknown,
): void {
  const ck = clientKey(tenantId, userId);
  const set = clients.get(ck);
  if (!set) {
    if (
      type === "call_signal" ||
      type === "call_accepted" ||
      type === "call_incoming" ||
      type === "meeting_signal" ||
      type === "meeting_participant_joined" ||
      type === "meeting_started"
    ) {
      logger.warn(
        { tenantId, userId, type, clientKey: ck, totalKeys: clients.size },
        "deliverLocal: no connections found for user",
      );
    }
    return;
  }
  const msg = JSON.stringify({ type, data });
  let delivered = 0;
  for (const ws of set) {
    if (ws.readyState === 1) {
      ws.send(msg);
      delivered++;
    }
  }
  if (
    delivered === 0 &&
    (type === "call_signal" ||
      type === "call_accepted" ||
      type === "call_incoming" ||
      type === "meeting_signal" ||
      type === "meeting_participant_joined" ||
      type === "meeting_started")
  ) {
    logger.warn(
      { tenantId, userId, type, clientKey: ck, connections: set.size },
      "deliverLocal: user has connections but none are open",
    );
  }
}

/**
 * Send a message to a specific user (all their open tabs/devices, across all instances).
 * tenantId ensures messages are only delivered to connections in the correct tenant.
 */
export function sendToUser(
  tenantId: number | null | undefined,
  userId: number,
  type: WSType,
  data: unknown,
): void {
  // Always deliver locally first
  deliverLocal(tenantId, userId, type, data);
  // Publish to Redis for other instances (include tenantId for cross-instance filtering)
  redis.publish("ws:broadcast", {
    _from: INSTANCE_ID,
    tenantId,
    userId,
    type,
    data,
  });
}

/**
 * Broadcast to all connected clients of a specific tenant (local instance).
 * tenantId is required to prevent cross-tenant data leaks.
 */
export function broadcast(
  tenantId: number | null | undefined,
  type: WSType,
  data: unknown,
): void {
  const msg = JSON.stringify({ type, data });
  for (const [key, set] of clients) {
    // Only deliver to connections belonging to the specified tenant
    const keyTenant = key.split(":")[0];
    if (String(tenantId || 0) !== keyTenant) continue;
    for (const ws of set) {
      if (ws.readyState === 1) ws.send(msg);
    }
  }
}

/**
 * Create a notification in the DB and push it to the user via WebSocket.
 * Drop-in wrapper: call this instead of raw INSERT INTO notifications.
 */
export async function notifyUser(
  db: DbLike,
  tenantId: number | null | undefined,
  userId: number,
  type: string,
  title: string,
  body: string,
  linkTaskId?: number | null,
  // Optional id of the user who TRIGGERED this notification (the "actor" — e.g.
  // the task assigner, the leave approver). When supplied we look up their
  // avatar/name and forward it to the push so the mobile client can render the
  // actor's circular avatar as the notification largeIcon (chat-avatar parity);
  // otherwise the client falls back to the org branding logo. The app-logo
  // silhouette is always the status-bar smallIcon.
  actorId?: number | null,
): Promise<void> {
  try {
    const sql = linkTaskId
      ? "INSERT INTO notifications (user_id, type, title, body, link_task_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at"
      : "INSERT INTO notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4) RETURNING id, created_at";
    const params = linkTaskId
      ? [userId, type, title, body, linkTaskId]
      : [userId, type, title, body];
    const row = (await db.query(sql, params)).rows[0];
    if (row) {
      sendToUser(tenantId, userId, "notification", {
        id: row.id,
        type,
        title,
        body,
        link_task_id: linkTaskId || null,
        created_at: row.created_at,
        is_read: false,
      });

      // Best-effort: resolve the actor's avatar/name so the push can show their
      // circular avatar as the notification largeIcon. A missing actor (or a
      // failed lookup) simply leaves the fields empty and the client falls back
      // to the org branding logo.
      let actorAvatar = "";
      let actorName = "";
      if (actorId) {
        try {
          const actor = (
            await db.query("SELECT full_name, avatar FROM users WHERE id = $1", [
              actorId,
            ])
          ).rows[0];
          actorAvatar = actor?.avatar || "";
          actorName = actor?.full_name || "";
        } catch {
          /* best-effort — leave actor fields empty */
        }
      }

      // Send push notification for important alerts
      pushNotifications
        .sendNotificationAlert(db.query as any, userId, tenantId || null, {
          notificationId: row.id,
          title,
          body,
          type,
          actorAvatar,
          actorName,
        })
        .catch((err: any) => {
          logger.warn(
            { err: err.message, userId },
            "Failed to send push notification alert",
          );
        });
    }
  } catch {
    /* ignore — notification delivery is best-effort */
  }
}

