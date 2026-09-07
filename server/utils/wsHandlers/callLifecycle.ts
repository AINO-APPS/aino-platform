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


export async function handleCallInitiate({
  db,
  senderId,
  tenantId,
  msg,
  ws,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // Caller initiates a call → create call_log, notify participants.
  // T038: gate this with idempotency so reconnect replays don't create
  // duplicate ringing rows/invites.
  const {
    conversationId,
    callType,
    clientMsgId: rawCallInitiateId,
  } = msg.data || {};
  // Reject a malformed initiate EXPLICITLY. A silent `return` here left the
  // caller's screen "Ringing…" for the full 35s no-answer timeout while the
  // receiver never rang (e.g. a Calls-tab / call-info entry that carried a
  // null conversation_id serialises to the string "null" → NaN client-side
  // and an unusable id here). The NACK lets the client fail fast with a
  // real error instead of ringing into the void.
  const convIdNum = Number(conversationId);
  if (
    !conversationId ||
    !Number.isFinite(convIdNum) ||
    convIdNum <= 0 ||
    !["voice", "video"].includes(callType)
  ) {
    logger.warn(
      { senderId, conversationId, callType, tenantId },
      "call_initiate: invalid payload, sending call_error",
    );
    sendToUser(tenantId, senderId, "call_error", {
      conversationId: conversationId ?? null,
      reason: "invalid_payload",
    });
    return;
  }

  await withIdempotency(
    {
      tenantId,
      senderId,
      type: "call_initiate",
      clientMsgId: rawCallInitiateId,
    },
    async () => {
      const participant = (
        await db.query(
          "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
          [conversationId, senderId],
        )
      ).rows[0];
      if (!participant) {
        logger.warn(
          { senderId, conversationId },
          "call_initiate: sender not a participant",
        );
        // NACK the caller — a silent drop left their screen ringing for the
        // full no-answer timeout with the receiver never notified.
        sendToUser(tenantId, senderId, "call_error", {
          conversationId,
          reason: "not_participant",
        });
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "initiate",
          tenantId,
          senderId,
          conversationId,
          reason: "sender_not_participant",
        });
        return;
      }

      // Group conversations use the meeting mesh flow for n-way reliability.
      // Direct call_initiate is p2p and cannot connect all participants.
      const isGroupConv = (
        await db.query("SELECT is_group FROM conversations WHERE id = $1", [
          conversationId,
        ])
      ).rows[0]?.is_group;
      if (isGroupConv) {
        logger.info(
          { senderId, conversationId, tenantId },
          "call_initiate: group conversation blocked; use meeting flow",
        );
        sendToUser(tenantId, senderId, "call_ended", {
          conversationId,
          reason: "group_unsupported",
        });
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "initiate",
          tenantId,
          senderId,
          conversationId,
          reason: "group_unsupported",
        });
        return;
      }

      // P0.3 — call_busy on 1:1 collision. For NON-group conversations we
      // ring at most one callee; if that callee already has an active
      // (ringing/answered) call we must NOT create another ringing row.
      // Instead tell the caller the callee is busy and bail out.
      {
        const targetRow = (
          await db.query(
            `SELECT user_id FROM conversation_participants
                       WHERE conversation_id = $1 AND user_id != $2
                       ORDER BY user_id ASC
                       LIMIT 1`,
            [conversationId, senderId],
          )
        ).rows[0];
        if (targetRow) {
          const targetUserId = targetRow.user_id;
          // Only treat the callee as busy for a GENUINELY active call.
          // Critical guards (a too-broad check here silently blocks all
          // future calls + push notifications to that user):
          //   • Exclude THIS conversation — in a 1:1 chat both users are
          //     participants of it, so a leftover row in the same convo
          //     would make the callee look "busy" to their own caller.
          //   • Freshness window — a crashed/killed client can leave a
          //     row stuck in 'ringing'/'answered' forever (the stale-call
          //     sweep is the authoritative cleanup, but we must also not
          //     trust rows older than the TTL here, or a user gets pinned
          //     "busy" until the next sweep / indefinitely for 'answered').
          //   • 'ringing' counts only within the ring TTL (~45s).
          //   • 'answered' counts only within a max PLAUSIBLE live-call
          //     window. This used to be 12h from created_at, which meant a
          //     single abandoned 'answered' row (client crashed / app killed
          //     mid-call so call_end never arrived) pinned the callee as
          //     "busy" for up to 12 HOURS — every caller got call_busy and
          //     the callee's phone NEVER RANG (a primary "receiver never
          //     rings" cause when the stale-call sweep isn't running, e.g.
          //     no Redis/BullMQ). 1:1 calls realistically don't exceed a
          //     couple of hours (group calls use the meeting mesh), so we
          //     tighten the window to 2h and anchor it on started_at (the
          //     moment the call actually connected) falling back to
          //     created_at. The 20s stale-call sweep remains the
          //     authoritative cleanup; this is the defensive bound.
          const busy = (
            await db.query(
              `SELECT 1 FROM call_logs cl
                           JOIN conversation_participants cp ON cp.conversation_id = cl.conversation_id
                           WHERE cp.user_id = $1
                             AND cl.conversation_id != $2
                             AND (
                                   (cl.status = 'ringing'
                                     AND cl.created_at > NOW() - INTERVAL '45 seconds')
                                OR (cl.status = 'answered'
                                     AND COALESCE(cl.started_at, cl.created_at) > NOW() - INTERVAL '2 hours')
                                 )
                           LIMIT 1`,
              [targetUserId, conversationId],
            )
          ).rows[0];
          if (busy) {
            logger.info(
              { senderId, conversationId, targetUserId, tenantId },
              "call_initiate: callee busy, sending call_busy",
            );
            // Optionally record a missed-call row for history.
            try {
              await db.query(
                `INSERT INTO call_logs (conversation_id, caller_id, call_type, status, ended_at)
                                   VALUES ($1, $2, $3, 'missed', NOW())`,
                [conversationId, senderId, callType],
              );
            } catch (err: any) {
              logger.warn(
                { err: err?.message, conversationId, senderId },
                "call_initiate: failed to record missed busy call log",
              );
            }
            sendToUser(tenantId, senderId, "call_busy", {
              conversationId,
              targetUserId,
              reason: "busy",
            });
            recordCallTransitionFailure({
              event: "call_transition_failed",
              action: "initiate",
              tenantId,
              senderId,
              conversationId,
              reason: "callee_busy",
            });
            return;
          }
        }
      }

      const [callLogResult, callerResult, convResult] = await Promise.all([
        db.query(
          `INSERT INTO call_logs (conversation_id, caller_id, call_type, status)
                       VALUES ($1, $2, $3, 'ringing') RETURNING id, created_at`,
          [conversationId, senderId, callType],
        ),
        db.query("SELECT full_name, avatar FROM users WHERE id = $1", [
          senderId,
        ]),
        db.query("SELECT name, is_group FROM conversations WHERE id = $1", [
          conversationId,
        ]),
      ]);

      const callLog = callLogResult.rows[0];
      const caller = callerResult.rows[0];
      const conv = convResult.rows[0];

      // For NON-group (1:1) conversations we ring at most ONE other user.
      const participantsQuery = conv?.is_group
        ? `SELECT user_id FROM conversation_participants
                     WHERE conversation_id = $1 AND user_id != $2`
        : `SELECT user_id FROM conversation_participants
                     WHERE conversation_id = $1 AND user_id != $2
                     ORDER BY user_id ASC
                     LIMIT 1`;
      const participants = (
        await db.query(participantsQuery, [conversationId, senderId])
      ).rows;

      logger.info(
        {
          senderId,
          callId: callLog.id,
          conversationId,
          callType,
          participantCount: participants.length,
          tenantId,
        },
        "call_initiate: notifying participants",
      );

      for (const p of participants) {
        sendToUser(tenantId, p.user_id, "call_incoming", {
          callId: callLog.id,
          conversationId,
          callerId: senderId,
          callerName: caller?.full_name,
          callerAvatar: caller?.avatar,
          callType,
          isGroup: conv?.is_group || false,
          groupName: conv?.name,
        });

        // Send push notification to recipient if they have registered devices
        pushNotifications
          .sendCallNotification(db.query as any, p.user_id, tenantId, {
            callId: callLog.id,
            conversationId,
            callerId: senderId,
            callerName: caller?.full_name || "Unknown",
            callerAvatar: caller?.avatar,
            callType: callType as "voice" | "video",
            isGroup: conv?.is_group || false,
            groupName: conv?.name,
          })
          .then(() => {
            logPushCallLifecycle(
              {
                event: "push_send_result",
                tenantId,
                userId: p.user_id,
                callId: callLog.id,
                conversationId,
                status: "success",
              },
              "debug",
            );
          })
          .catch((err: any) => {
            logger.warn(
              { err: err.message, userId: p.user_id, callId: callLog.id },
              "Failed to send call push notification",
            );
            logPushCallLifecycle(
              {
                event: "push_send_result",
                tenantId,
                userId: p.user_id,
                callId: callLog.id,
                conversationId,
                status: "failed",
                failureReason: err.message || "unknown",
              },
              "warn",
            );
          });
      }

      // Confirm call started to caller
      sendToUser(tenantId, senderId, "call_started", {
        callId: callLog.id,
        conversationId,
        callType,
      });

      // Status service v2: mark THIS device of the caller as in_call.
      if (ws._statusSessionKey) {
        statusService
          .setSessionActivity(
            { db, tenantId },
            ws._statusSessionKey,
            "in_call",
            callLog.id,
          )
          .catch((err: any) =>
            logger.warn(
              { err: err.message, callId: callLog.id },
              "setSessionActivity(in_call) failed",
            ),
          );
        ws._callActivityRefId = callLog.id;
      }
    },
  );
}

export async function handleCallAccept({
  db,
  senderId,
  tenantId,
  msg,
  ws,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // Callee accepts → update call log, notify caller with acceptance
  const { callId, conversationId, clientMsgId: rawIdAccept } = msg.data || {};
  if (!callId || !conversationId) return;

  await withIdempotentCallAction(
    {
      tenantId,
      senderId,
      callId,
      action: "answer",
      clientMsgId: rawIdAccept,
    },
    async () => {
      const [callLogResult, participantResult] = await Promise.all([
        db.query(
          `SELECT * FROM call_logs WHERE id = $1 AND conversation_id = $2`,
          [callId, conversationId],
        ),
        db.query(
          "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
          [conversationId, senderId],
        ),
      ]);

      const callLog = callLogResult.rows[0];
      if (!callLog) {
        logger.warn(
          { senderId, callId, conversationId },
          "call_accept: call log not found",
        );
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "answer",
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
          "call_accept: terminal/invalid state; ignoring",
        );
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "answer",
          tenantId,
          senderId,
          callId,
          conversationId,
          fromStatus: callLog.status,
          reason: "invalid_transition",
        });
        return;
      }
      if (!participantResult.rows[0]) {
        logger.warn(
          { senderId, callId, conversationId },
          "call_accept: sender not a participant",
        );
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "answer",
          tenantId,
          senderId,
          callId,
          conversationId,
          reason: "sender_not_participant",
        });
        return;
      }

      const [updatedCall, accepterResult] = await Promise.all([
        db.query(
          `UPDATE call_logs
                       SET status = 'answered', started_at = NOW()
                       WHERE id = $1 AND status = 'ringing'
                       RETURNING id`,
          [callId],
        ),
        db.query("SELECT full_name, avatar FROM users WHERE id = $1", [
          senderId,
        ]),
      ]);

      if (!updatedCall.rows[0]) {
        logger.info(
          { senderId, callId, conversationId },
          "call_accept: transition already applied by another action",
        );
        recordCallTransitionFailure({
          event: "call_transition_failed",
          action: "answer",
          tenantId,
          senderId,
          callId,
          conversationId,
          reason: "transition_race",
        });
        return;
      }

      const accepter = accepterResult.rows[0];

      logPushCallLifecycle(
        {
          event: "native_call_action_applied",
          tenantId,
          userId: senderId,
          callId,
          conversationId,
          action: "answer",
          status: "success",
        },
        "info",
      );

      logger.info(
        {
          senderId,
          callerId: callLog.caller_id,
          callId,
          conversationId,
          tenantId,
        },
        "call_accept: notifying caller",
      );

      // Notify the caller that call was accepted
      sendToUser(tenantId, callLog.caller_id, "call_accepted", {
        callId,
        conversationId,
        userId: senderId,
        userName: accepter?.full_name,
        userAvatar: accepter?.avatar,
      });

      // Multi-session support: the accepter may have other active sessions
      // (e.g. desktop + browser) where the incoming-call PiP is still
      // ringing. Tell every one of the accepter's sessions that the call
      // has been handled so non-accepting devices dismiss their PiP.
      // The accepting session itself has already cleared its PiP locally
      // and ignores this event (see CallContext handler).
      sendToUser(tenantId, senderId, "call_handled_elsewhere", {
        callId,
        conversationId,
        action: "accepted",
      });

      // Push-cancel the accepter's OTHER devices (e.g. a locked /
      // backgrounded twin phone) so the native incoming-call ring is
      // dismissed there. The WS dismiss above only reaches sessions
      // with a live socket; a killed/locked device relies on this
      // data-only "call handled elsewhere" push.
      pushNotifications
        .sendCallCancellation(db.query as any, senderId, tenantId, {
          callId,
          conversationId,
          reason: "accepted",
        })
        .catch((err: any) =>
          logger.warn(
            { err: err.message, callId, userId: senderId },
            "Failed to push-cancel accepter devices on accept",
          ),
        );

      // Status service v2: mark the accepting device (only) as in_call.
      if (ws._statusSessionKey) {
        statusService
          .setSessionActivity(
            { db, tenantId },
            ws._statusSessionKey,
            "in_call",
            callId,
          )
          .catch((err: any) =>
            logger.warn(
              { err: err.message, callId },
              "setSessionActivity(in_call) failed",
            ),
          );
        ws._callActivityRefId = callId;
      }

      // P0 — Reliable delivery: replay any OFFER/ICE the caller sent
      // BEFORE this callee's socket/screen was ready (buffered in
      // call_signal). This is the key fix for "answered from push but
      // never connects": the caller fired its offer the instant it saw
      // call_accepted, but the callee was still mounting; the buffered
      // offer is now delivered so negotiation actually starts.
      await replayCallSignals(tenantId, Number(callId), senderId, (fromUserId, signal) => {
        sendToUser(tenantId, senderId, "call_signal", {
          conversationId,
          fromUserId,
          signal,
        });
      });
    },
  );
}

