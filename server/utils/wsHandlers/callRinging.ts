/**
 * Ringing-phase 1:1 call operations shared by the WebSocket handlers and the
 * HTTP fallbacks in modules/chat/chat.call-actions.routes.ts (used by a device
 * woken by FCM without a live socket):
 *
 *   • acknowledgeCallRinging — the CALLEE's device reports that it is ringing
 *     (`call_ringing`); the caller's sessions switch "Calling…" → "Ringing…".
 *   • cancelRingingCall      — the CALLER backs out before an answer
 *     (`call_cancel`); the call becomes `missed` and every ring is dismissed.
 *
 * Dependencies are injected (never imports ws.ts) to avoid a circular import.
 */
import { logger } from "../logger";
import { pushNotifications } from "../../services/pushNotifications";
import { withIdempotentCallAction } from "../wsIdempotency";
import * as signalStore from "../../realtime/signalStore";
import { emitCallHistoryMessage, type DbLike, type ExtWS, type SendToUser } from "./shared";
const statusService = require("../../services/status");

export type CallRingingResult =
  | { outcome: "forwarded"; status: "ringing" }
  | { outcome: "not_ringing"; status: string }
  | { outcome: "not_participant" | "not_found" | "is_caller" };

/**
 * Record the callee's ringing ack and forward `call_ringing` to every session
 * of the caller. Repeated acks are harmless: `ringing_at` keeps the first ack
 * time and the caller UI treats the event as idempotent.
 */
export async function acknowledgeCallRinging(
  db: DbLike,
  tenantId: number | null,
  calleeId: number,
  callId: number,
  conversationId: number,
  sendToUser: SendToUser,
): Promise<CallRingingResult> {
  const member = (
    await db.query(
      "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, calleeId],
    )
  ).rows[0];
  if (!member) return { outcome: "not_participant" };

  const call = (
    await db.query(
      "SELECT caller_id, status FROM call_logs WHERE id = $1 AND conversation_id = $2",
      [callId, conversationId],
    )
  ).rows[0];
  if (!call) return { outcome: "not_found" };
  if (Number(call.caller_id) === calleeId) return { outcome: "is_caller" };
  if (call.status !== "ringing") return { outcome: "not_ringing", status: call.status };

  const updated = await db.query(
    `UPDATE call_logs SET ringing_at = COALESCE(ringing_at, NOW())
      WHERE id = $1 AND status = 'ringing' RETURNING id`,
    [callId],
  );
  if (!updated.rows[0]) {
    // Answered/cancelled between the read and the write.
    const latest = (
      await db.query("SELECT status FROM call_logs WHERE id = $1", [callId])
    ).rows[0];
    return { outcome: "not_ringing", status: latest?.status ?? "ended" };
  }

  sendToUser(tenantId, Number(call.caller_id), "call_ringing", {
    callId,
    conversationId,
    userId: calleeId,
  });
  return { outcome: "forwarded", status: "ringing" };
}

/**
 * Caller cancels before the callee answered: the caller's latest `ringing`
 * call in the conversation becomes `missed`, `call_ended` reaches the callee
 * and the caller's other sessions, the callee's devices get a cancel push, the
 * in_call activity is cleared, a "missed" call-history row is posted and the
 * buffered signals are dropped. Returns null when nothing was ringing.
 */
export async function cancelRingingCall(
  db: DbLike,
  tenantId: number | null,
  callerId: number,
  conversationId: number | string,
  sendToUser: SendToUser,
): Promise<{ callId: number } | null> {
  const callLog = (
    await db.query(
      `SELECT id, call_type FROM call_logs WHERE conversation_id = $1 AND caller_id = $2 AND status = 'ringing' ORDER BY created_at DESC LIMIT 1`,
      [conversationId, callerId],
    )
  ).rows[0];
  if (!callLog) return null;

  const updated = await db.query(
    `UPDATE call_logs SET status = 'missed', ended_at = NOW() WHERE id = $1 AND status = 'ringing' RETURNING id`,
    [callLog.id],
  );
  if (!updated.rows[0]) return null;

  const participants = (
    await db.query(
      "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2",
      [conversationId, callerId],
    )
  ).rows;

  for (const p of participants) {
    sendToUser(tenantId, p.user_id, "call_ended", {
      callId: callLog.id,
      conversationId,
    });

    // Push-cancel the callee's devices (locked/backgrounded twin) so a native
    // incoming-call ring is dismissed when the caller cancels.
    pushNotifications
      .sendCallCancellation(db.query as any, p.user_id, tenantId, {
        callId: callLog.id,
        conversationId: Number(conversationId),
        reason: "cancelled",
      })
      .catch((err: any) =>
        logger.warn(
          { err: err.message, callId: callLog.id, userId: p.user_id },
          "Failed to push-cancel callee devices on cancel",
        ),
      );
  }

  // Echo to the caller's OTHER devices so their outgoing-ring UI is dismissed.
  sendToUser(tenantId, callerId, "call_ended", {
    callId: callLog.id,
    conversationId,
  });

  // The caller's device was briefly marked in_call by call_initiate.
  statusService
    .clearActivityForRef({ db, tenantId }, "in_call", callLog.id)
    .catch((err: any) =>
      logger.warn(
        { err: err.message, callId: callLog.id },
        "clearActivityForRef(in_call) on cancel failed",
      ),
    );

  await emitCallHistoryMessage(
    db,
    tenantId,
    Number(conversationId),
    callerId,
    callLog.call_type || "voice",
    "missed",
    null,
    sendToUser,
  );
  await signalStore.clearCallSignals(tenantId, callLog.id);
  return { callId: callLog.id };
}

interface RingingHandlerArgs {
  db: DbLike;
  senderId: number;
  tenantId: number | null;
  msg: any;
  ws: ExtWS;
  sendToUser: SendToUser;
}

/** WS `call_ringing` — deduped per (callId, sender) for the cache window. */
export async function handleCallRinging({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: RingingHandlerArgs): Promise<void> {
  const callId = Number(msg.data?.callId);
  const conversationId = Number(msg.data?.conversationId);
  if (!Number.isInteger(callId) || callId <= 0) return;
  if (!Number.isInteger(conversationId) || conversationId <= 0) return;

  await withIdempotentCallAction(
    { tenantId, senderId, callId, action: "ringing" },
    async () => {
      const result = await acknowledgeCallRinging(
        db, tenantId, senderId, callId, conversationId, sendToUser,
      );
      if (result.outcome !== "forwarded") {
        logger.info(
          { senderId, callId, conversationId, ...result },
          "call_ringing: ack not forwarded",
        );
      }
      return result;
    },
  );
}
