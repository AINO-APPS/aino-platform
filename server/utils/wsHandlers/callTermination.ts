/**
 * 1:1 CALL WebSocket handlers, extracted from ws.ts as part of the
 * calls-module separation (mirrors wsHandlers/huddles.ts for group calls).
 * Handles: call_initiate, call_accept, call_cancel, call_reject, call_end,
 * call_signal, call_subscribe, call_ready, call_reconnect, call_reaction,
 * call_add_participant.
 *
 * Dependencies (db, tenantId, senderId, sendToUser, ws, etc.) are injected so
 * this module never imports ws.ts (avoids a circular dependency). Logic is
 * moved verbatim from the original `handleChatMessage` dispatcher — this is a
 * pure structural refactor, no behaviour changes.
 */
import { logger, logPushCallLifecycle } from "../logger";
import { pushNotifications } from "../../services/pushNotifications";
import { withIdempotency, withIdempotentCallAction } from "../wsIdempotency";
import * as signalStore from "../../realtime/signalStore";
const statusService = require("../../services/status");
import {
  DbLike,
  ExtWS,
  SendToUser,
  recordCallTransitionFailure,
  identifyCallSignal,
  isConversationMember,
  replayCallSignals,
  emitCallHistoryMessage,
  hasOpenSocket,
} from "./shared";

export interface CallHandlerArgs {
  db: DbLike;
  senderId: number;
  tenantId: number | null;
  msg: any;
  ws: ExtWS;
  sendToUser: SendToUser;
}


export async function handleCallCancel({
  db,
  senderId,
  tenantId,
  msg,
  ws,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // Caller cancels — either media acquisition failed after call_initiate
  // was sent, OR the caller backed out / the outgoing ring timed out
  // before the callee answered (mobile sends this when it has no callId
  // yet). Idempotent via the optional clientMsgId so a retried frame on a
  // flaky link doesn't double-cancel.
  const { conversationId, clientMsgId: rawCallCancelId } = msg.data || {};
  if (!conversationId) return;

  await withIdempotency(
    {
      tenantId,
      senderId,
      type: "call_cancel",
      clientMsgId: rawCallCancelId,
    },
    async () => {
      const callLog = (
        await db.query(
          `SELECT id, call_type FROM call_logs WHERE conversation_id = $1 AND caller_id = $2 AND status = 'ringing' ORDER BY created_at DESC LIMIT 1`,
          [conversationId, senderId],
        )
      ).rows[0];
      if (!callLog) return;

      const updated = await db.query(
        `UPDATE call_logs SET status = 'missed', ended_at = NOW() WHERE id = $1 AND status = 'ringing' RETURNING id`,
        [callLog.id],
      );
      if (!updated.rows[0]) return;

      const participants = (
        await db.query(
          "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2",
          [conversationId, senderId],
        )
      ).rows;

      for (const p of participants) {
        sendToUser(tenantId, p.user_id, "call_ended", {
          callId: callLog.id,
          conversationId,
        });

        // Push-cancel the callee's devices (locked/backgrounded twin)
        // so a native incoming-call ring is dismissed when the caller
        // cancels.
        pushNotifications
          .sendCallCancellation(db.query as any, p.user_id, tenantId, {
            callId: callLog.id,
            conversationId,
            reason: "cancelled",
          })
          .catch((err: any) =>
            logger.warn(
              { err: err.message, callId: callLog.id, userId: p.user_id },
              "Failed to push-cancel callee devices on cancel",
            ),
          );
      }

      // Echo to the caller's OTHER devices so their outgoing-ring UI is
      // dismissed too (e.g. desktop + mobile both showing the call).
      sendToUser(tenantId, senderId, "call_ended", {
        callId: callLog.id,
        conversationId,
      });

      // Status service v2: caller cancelled; their device was briefly
      // marked in_call by call_initiate. Sweep every session
      // referencing this call.
      statusService
        .clearActivityForRef({ db, tenantId }, "in_call", callLog.id)
        .catch((err: any) =>
          logger.warn(
            { err: err.message, callId: callLog.id },
            "clearActivityForRef(in_call) on cancel failed",
          ),
        );
      ws._callActivityRefId = null;
      // Inline "missed" call-history row in the chat thread (the callee never
      // answered before the caller cancelled / the ring timed out).
      await emitCallHistoryMessage(
        db,
        tenantId,
        Number(conversationId),
        senderId,
        callLog.call_type || "voice",
        "missed",
        null,
        sendToUser,
      );
      // P0 — drop any buffered signals for this now-dead call.
      await signalStore.clearCallSignals(tenantId, callLog.id);
    },
  );
}

export async function handleCallReject({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // Callee rejects → update call log, notify caller
  const { callId, conversationId, clientMsgId: rawIdReject } = msg.data || {};
  if (!callId || !conversationId) return;

  await withIdempotentCallAction(
    {
      tenantId,
      senderId,
      callId,
      action: "reject",
      clientMsgId: rawIdReject,
    },
    async () => {
      // Verify sender is a participant in this conversation
      const isParticipant = (
        await db.query(
          "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
          [conversationId, senderId],
        )
      ).rows[0];
      if (!isParticipant) return;

      const callLog = (
        await db.query(
          `SELECT * FROM call_logs WHERE id = $1 AND conversation_id = $2`,
          [callId, conversationId],
        )
      ).rows[0];
      if (!callLog) {
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "reject",
          tenantId,
          senderId,
          callId,
          conversationId,
          reason: "call_not_found",
        });
        return;
      }
      if (callLog.status !== "ringing") {
        logger.info(
          { senderId, callId, conversationId, status: callLog.status },
          "call_reject: terminal/invalid state; ignoring",
        );
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "reject",
          tenantId,
          senderId,
          callId,
          conversationId,
          fromStatus: callLog.status,
          reason: "invalid_transition",
        });
        return;
      }

      const updated = await db.query(
        `UPDATE call_logs
                   SET status = 'declined', ended_at = NOW()
                   WHERE id = $1 AND status = 'ringing'
                   RETURNING id`,
        [callId],
      );
      if (!updated.rows[0]) {
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "reject",
          tenantId,
          senderId,
          callId,
          conversationId,
          reason: "transition_race",
        });
        return;
      }

      const rejecter = (
        await db.query("SELECT full_name FROM users WHERE id = $1", [
          senderId,
        ])
      ).rows[0];

      logPushCallLifecycle(
        {
          event: "native_call_action_applied",
          tenantId,
          userId: senderId,
          callId,
          conversationId,
          action: "reject",
          status: "success",
        },
        "info",
      );

      // Notify other participants
      const participants = (
        await db.query(
          "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2",
          [conversationId, senderId],
        )
      ).rows;

      for (const p of participants) {
        sendToUser(tenantId, p.user_id, "call_rejected", {
          callId,
          conversationId,
          userId: senderId,
          userName: rejecter?.full_name,
        });
      }

      // Multi-session support: dismiss the ringing PiP on the rejecter's
      // other devices (e.g. desktop + browser). The session that pressed
      // "reject" has already cleared its PiP locally.
      sendToUser(tenantId, senderId, "call_handled_elsewhere", {
        callId,
        conversationId,
        action: "rejected",
      });

      // Push-cancel the rejecter's OTHER devices (locked/backgrounded
      // twin) so their native ring is dismissed, plus the caller's
      // devices so a backgrounded caller stops its outgoing ring.
      pushNotifications
        .sendCallCancellation(db.query as any, senderId, tenantId, {
          callId,
          conversationId,
          reason: "rejected",
        })
        .catch((err: any) =>
          logger.warn(
            { err: err.message, callId, userId: senderId },
            "Failed to push-cancel rejecter devices on reject",
          ),
        );
      pushNotifications
        .sendCallCancellation(db.query as any, callLog.caller_id, tenantId, {
          callId,
          conversationId,
          reason: "rejected",
        })
        .catch((err: any) =>
          logger.warn(
            { err: err.message, callId, userId: callLog.caller_id },
            "Failed to push-cancel caller devices on reject",
          ),
        );

      // Status service v2: if the callee had been auto-flagged in_call by a
      // racy accept (or the caller's device was still marked from initiate),
      // clear it for every session referencing this call.
      statusService
        .clearActivityForRef({ db, tenantId }, "in_call", callId)
        .catch((err: any) =>
          logger.warn(
            { err: err.message, callId },
            "clearActivityForRef(in_call) on reject failed",
          ),
        );

      // Inline "declined" call-history row in the chat thread.
      await emitCallHistoryMessage(
        db,
        tenantId,
        Number(conversationId),
        callLog.caller_id,
        callLog.call_type,
        "declined",
        null,
        sendToUser,
      );
      await signalStore.clearCallSignals(tenantId, Number(callId));
    },
  );
}

export async function handleCallEnd({
  db,
  senderId,
  tenantId,
  msg,
  ws,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // Either party ends the call → update log, notify others
  const { callId, conversationId, clientMsgId: rawIdEnd } = msg.data || {};
  if (!callId || !conversationId) return;

  await withIdempotentCallAction(
    { tenantId, senderId, callId, action: "end", clientMsgId: rawIdEnd },
    async () => {
      // Verify sender is a participant in this conversation
      const isParticipant = (
        await db.query(
          "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
          [conversationId, senderId],
        )
      ).rows[0];
      if (!isParticipant) {
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "end",
          tenantId,
          senderId,
          callId,
          conversationId,
          reason: "sender_not_participant",
        });
        return;
      }

      const callLog = (
        await db.query(
          `SELECT * FROM call_logs WHERE id = $1 AND conversation_id = $2`,
          [callId, conversationId],
        )
      ).rows[0];
      if (!callLog) {
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "end",
          tenantId,
          senderId,
          callId,
          conversationId,
          reason: "call_not_found",
        });
        return;
      }
      if (["ended", "missed", "declined"].includes(callLog.status)) {
        logger.info(
          { senderId, callId, conversationId, status: callLog.status },
          "call_end: terminal state; ignoring duplicate",
        );
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "end",
          tenantId,
          senderId,
          callId,
          conversationId,
          fromStatus: callLog.status,
          reason: "already_terminal",
        });
        return;
      }

      // Calculate duration if call was answered
      let duration: number | null = null;
      if (callLog.started_at) {
        duration = Math.round(
          (Date.now() - new Date(callLog.started_at).getTime()) / 1000,
        );
      }

      const updated = await db.query(
        `UPDATE call_logs
                   SET status = CASE WHEN status = 'ringing' THEN 'missed' ELSE 'ended' END,
                       ended_at = NOW(),
                       duration = $2
                   WHERE id = $1
                   RETURNING id`,
        [callId, duration],
      );
      if (!updated.rows[0]) {
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "end",
          tenantId,
          senderId,
          callId,
          conversationId,
          reason: "transition_race",
        });
        return;
      }

      // Notify all participants about call end
      const allParticipants = (
        await db.query(
          "SELECT user_id FROM conversation_participants WHERE conversation_id = $1",
          [conversationId],
        )
      ).rows;

      for (const p of allParticipants) {
        if (p.user_id !== senderId) {
          sendToUser(tenantId, p.user_id, "call_ended", {
            callId,
            conversationId,
            endedBy: senderId,
            duration,
          });

          // P2.13 — Decline/end teardown parity. The WS `call_ended`
          // above only reaches sessions with a live socket. A
          // locked/backgrounded/killed twin (e.g. the call was ended
          // while it was still ringing, or a second device never
          // joined) keeps its native incoming-call ring / ongoing-call
          // notification until this data-only "call handled elsewhere"
          // push dismisses it — matching the call_cancel / call_reject
          // / stale-sweep teardown paths.
          pushNotifications
            .sendCallCancellation(db.query as any, p.user_id, tenantId, {
              callId,
              conversationId,
              reason: "ended",
            })
            .catch((err: any) =>
              logger.warn(
                { err: err.message, callId, userId: p.user_id },
                "Failed to push-cancel participant devices on end",
              ),
            );
        }
      }

      // Status service v2: clear in_call for every session referencing
      // this call (caller + all callees, across all their devices).
      statusService
        .clearActivityForRef({ db, tenantId }, "in_call", callId)
        .catch((err: any) =>
          logger.warn(
            { err: err.message, callId },
            "clearActivityForRef(in_call) on end failed",
          ),
        );
      if (ws._callActivityRefId === callId) ws._callActivityRefId = null;
      // Inline call-history row in the chat thread (Signal parity). A
      // call that was never answered (still `ringing`) is a MISSED
      // call; otherwise it `ended` with the measured duration.
      await emitCallHistoryMessage(
        db,
        tenantId,
        Number(conversationId),
        callLog.caller_id,
        callLog.call_type,
        callLog.status === "ringing" ? "missed" : "ended",
        duration,
        sendToUser,
      );
      // P0 — drop any buffered signals for this now-ended call.
      await signalStore.clearCallSignals(tenantId, Number(callId));
    },
  );
}

