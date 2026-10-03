import { logger } from "../utils/logger";
import { pushNotifications } from "../services/pushNotifications";
import { clients, clientKey } from "./registry";
import type { DbLike, WSType } from "./types";
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
 * Broadcast to all connected clients of a specific tenant, across all instances.
 * tenantId is required to prevent cross-tenant data leaks.
 */
export function broadcast(
  tenantId: number | null | undefined,
  type: WSType,
  data: unknown,
): void {
  broadcastLocal(tenantId, type, data);
  // Without this, tenant-wide events (features, plan, branding) reached only
  // the sockets on the instance that handled the request.
  redis.publish("ws:broadcast", { _from: INSTANCE_ID, tenantId, tenantWide: true, type, data });
}

/** Tenant-wide delivery to this instance's sockets only. */
export function broadcastLocal(
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

export interface NotifyUserOptions {
  /** Task this notification refers to (persisted as link_task_id). */
  linkTaskId?: number | null;
  /**
   * Id of the user who TRIGGERED this notification (task assigner, leave
   * approver…). Their avatar/name is forwarded to the push so the mobile client
   * can render it as the notification largeIcon; otherwise it falls back to the
   * org branding logo.
   */
  actorId?: number | null;
  /** Relative web path (must start with "/") the client opens on tap. */
  link?: string | null;
}

function normalizeNotifyOptions(
  optsOrLinkTaskId?: NotifyUserOptions | number | null,
  legacyActorId?: number | null,
): { linkTaskId: number | null; actorId: number | null; link: string | null } {
  if (optsOrLinkTaskId && typeof optsOrLinkTaskId === "object") {
    const link =
      typeof optsOrLinkTaskId.link === "string" && optsOrLinkTaskId.link.startsWith("/")
        ? optsOrLinkTaskId.link
        : null;
    return {
      linkTaskId: optsOrLinkTaskId.linkTaskId || null,
      actorId: optsOrLinkTaskId.actorId || null,
      link,
    };
  }
  return {
    linkTaskId: (optsOrLinkTaskId as number | null | undefined) || null,
    actorId: legacyActorId || null,
    link: null,
  };
}

/**
 * Create a notification in the DB, push it to the user via WebSocket and FCM.
 * Drop-in wrapper: call this instead of raw INSERT INTO notifications.
 *
 * Accepts either an options object `{ linkTaskId, actorId, link }` or the
 * legacy positional `(linkTaskId, actorId)` form. When called inside a
 * transaction, call it AFTER COMMIT with a non-transactional db handle so the
 * WS/FCM fan-out never announces rolled-back rows.
 */
export async function notifyUser(
  db: DbLike,
  tenantId: number | null | undefined,
  userId: number,
  type: string,
  title: string,
  body: string,
  optsOrLinkTaskId?: NotifyUserOptions | number | null,
  legacyActorId?: number | null,
  deliver: (
    tenantId: number | null | undefined,
    userId: number,
    type: WSType,
    data: unknown,
  ) => void = sendToUser,
): Promise<void> {
  const { linkTaskId, actorId, link } = normalizeNotifyOptions(optsOrLinkTaskId, legacyActorId);
  try {
    const row = (
      await db.query(
        "INSERT INTO notifications (user_id, type, title, body, link_task_id, link) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at",
        [userId, type, title, body, linkTaskId, link],
      )
    ).rows[0];
    if (!row) return;
    deliver(tenantId, userId, "notification", {
      id: row.id,
      type,
      title,
      body,
      link_task_id: linkTaskId,
      link,
      created_at: row.created_at,
      is_read: false,
    });

    // Best-effort: resolve the actor's avatar/name. A missing actor (or a failed
    // lookup) leaves the fields empty and the client falls back to the org logo.
    let actorAvatar = "";
    let actorName = "";
    if (actorId) {
      try {
        const actor = (
          await db.query("SELECT full_name, avatar FROM users WHERE id = $1", [actorId])
        ).rows[0];
        actorAvatar = actor?.avatar || "";
        actorName = actor?.full_name || "";
      } catch {
        /* best-effort — leave actor fields empty */
      }
    }

    pushNotifications
      .sendNotificationAlert(db.query.bind(db) as any, userId, tenantId || null, {
        notificationId: row.id,
        title,
        body,
        type,
        actorAvatar,
        actorName,
        link,
        linkTaskId,
      })
      .catch((err: any) => {
        logger.warn({ err: err.message, userId }, "Failed to send push notification alert");
      });
  } catch (err: any) {
    logger.warn({ err: err?.message, userId, type }, "notifyUser failed");
  }
}
