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


export async function handleCallSignal({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // WebRTC signaling relay: offer, answer, ICE candidates
  const { conversationId, targetUserId, signal } = msg.data || {};
  if (!conversationId || !targetUserId || !signal) return;

  // Validate signal type against whitelist
  const VALID_SIGNAL_TYPES = [
    "offer",
    "answer",
    "ice-candidate",
    "video-state",
    "audio-state",
    "screen-share-state",
    "quality-state",
    "request-video-state",
  ];
  if (!signal.type || !VALID_SIGNAL_TYPES.includes(signal.type)) {
    logger.warn(
      { senderId, signalType: signal?.type },
      "call_signal: rejected unknown signal type",
    );
    return;
  }

  // Validate signal payload per type
  if (signal.type === "offer" || signal.type === "answer") {
    if (
      typeof signal.sdp !== "string" ||
      signal.sdp.length === 0 ||
      signal.sdp.length > 100000
    ) {
      logger.warn(
        { senderId, signalType: signal.type, sdpLen: signal.sdp?.length },
        "call_signal: invalid SDP",
      );
      return;
    }
  } else if (signal.type === "ice-candidate") {
    if (
      signal.candidate != null &&
      (typeof signal.candidate !== "object" ||
        typeof signal.candidate.candidate !== "string")
    ) {
      logger.warn(
        { senderId },
        "call_signal: invalid ICE candidate structure",
      );
      return;
    }
  } else if (signal.type === "video-state") {
    if (typeof signal.videoOff !== "boolean") return;
  } else if (signal.type === "quality-state") {
    // Self-reported connection quality so the peer can surface a
    // "<name>'s connection is unstable" banner (Teams/Meet parity).
    // Mobile already emits this every time its measured quality changes;
    // it MUST be whitelisted here or the relay drops every frame.
    if (!["good", "fair", "poor", "unknown"].includes(signal.quality)) {
      logger.warn(
        { senderId, quality: signal.quality },
        "call_signal: invalid quality-state",
      );
      return;
    }
  }

  // Verify BOTH sender and target are members of the conversation for
  // EVERY signal type (not just offer/answer). ICE/state frames were
  // previously relayed with no membership check, letting any tenant user
  // inject signaling to an arbitrary userId. Cached to survive ICE bursts.
  const senderOk = await isConversationMember(db, tenantId, conversationId, senderId);
  const targetOk = await isConversationMember(
    db,
    tenantId,
    conversationId,
    targetUserId,
  );
  if (!senderOk || !targetOk) {
    logger.warn(
      {
        senderId,
        targetUserId,
        conversationId,
        senderOk,
        targetOk,
        signalType: signal.type,
      },
      "call_signal: participant check failed",
    );
    return;
  }

  logger.debug(
    {
      senderId,
      targetUserId,
      conversationId,
      signalType: signal.type,
      tenantId,
    },
    "call_signal: relaying",
  );

  const callIdForBuffer = Number(msg.data?.callId) || 0;
  const identifiedSignal = identifyCallSignal(
    tenantId,
    callIdForBuffer,
    Number(conversationId),
    senderId,
    Number(targetUserId),
    signal,
  );

  // RELIABLE DELIVERY (Signal-Android parity): if the target has NO open
  // socket on this instance, buffer the OFFER / ICE so we can replay it the
  // moment they subscribe/accept/become ready. This is the core fix for
  // "answered but never connects / black screen / can't connect from push":
  // the caller fires its offer the instant `call_accepted` arrives, but the
  // callee's call screen needs 1–5s to mount + subscribe. Without buffering
  // that offer (and early ICE) was silently dropped and the call hung.
  // We STILL relay (sendToUser also publishes cross-instance) so a callee on
  // another instance / already-subscribed still receives it immediately.
  if (
    (signal.type === "offer" || signal.type === "ice-candidate") &&
    !hasOpenSocket(tenantId, targetUserId)
  ) {
    if (callIdForBuffer) {
      await signalStore.bufferCallSignal(
        tenantId,
        callIdForBuffer,
        senderId,
        targetUserId,
        identifiedSignal,
      );
      logger.debug(
        {
          senderId,
          targetUserId,
          conversationId,
          callId: callIdForBuffer,
          signalType: signal.type,
        },
        "call_signal: buffered for offline target",
      );
    }
  }

  // Relay the signal to the target user
  sendToUser(tenantId, targetUserId, "call_signal", {
    conversationId,
    fromUserId: senderId,
    signal: identifiedSignal,
  });
}

export async function handleCallSubscribe({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // P0 — Reliable-delivery handshake. The callee's call screen sends this
  // the moment it mounts + subscribes to `call_signal`. We (1) replay any
  // OFFER/ICE that was buffered while they had no socket (single-instance
  // fast path) and (2) tell the OTHER participant(s) to re-send their offer
  // (`call_peer_ready`) so a cross-instance / never-buffered caller offer
  // is (re)delivered. The caller's offer creation is idempotent via Perfect
  // Negotiation so a duplicate is harmless.
  const { callId, conversationId } = msg.data || {};
  if (!callId || !conversationId) return;
  const isParticipant = await isConversationMember(
    db,
    tenantId,
    conversationId,
    senderId,
  );
  if (!isParticipant) return;
  // Replay buffered signals to THIS subscriber.
  await replayCallSignals(tenantId, Number(callId), senderId, (fromUserId, signal) => {
    sendToUser(tenantId, senderId, "call_signal", {
      conversationId,
      fromUserId,
      signal,
    });
  });
  // Ask the other participant(s) to (re)send their offer.
  const others = (
    await db.query(
      "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2",
      [conversationId, senderId],
    )
  ).rows;
  for (const p of others) {
    sendToUser(tenantId, p.user_id, "call_peer_ready", {
      callId,
      conversationId,
      userId: senderId,
    });
  }
}

export async function handleCallReady({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // P0 — The callee signals its PeerConnection exists and it is ready to
  // receive an offer. Relay to the other participant(s) so the caller
  // (re)sends its offer immediately (idempotent via Perfect Negotiation),
  // and replay any locally-buffered signals to the now-ready user.
  const { callId, conversationId } = msg.data || {};
  if (!callId || !conversationId) return;
  const isParticipant = await isConversationMember(
    db,
    tenantId,
    conversationId,
    senderId,
  );
  if (!isParticipant) return;
  await replayCallSignals(tenantId, Number(callId), senderId, (fromUserId, signal) => {
    sendToUser(tenantId, senderId, "call_signal", {
      conversationId,
      fromUserId,
      signal,
    });
  });
  const others = (
    await db.query(
      "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2",
      [conversationId, senderId],
    )
  ).rows;
  for (const p of others) {
    sendToUser(tenantId, p.user_id, "call_peer_ready", {
      callId,
      conversationId,
      userId: senderId,
    });
  }
}

export async function handleCallReconnect({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // User refreshed the page during an active call — notify the other party to re-offer
  const { callId, conversationId } = msg.data || {};
  if (!callId || !conversationId) return;

  const callLog = (
    await db.query(
      `SELECT * FROM call_logs WHERE id = $1 AND conversation_id = $2 AND status = 'answered'`,
      [callId, conversationId],
    )
  ).rows[0];
  if (!callLog) return;

  // Verify sender is in the conversation
  const participant = (
    await db.query(
      "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, senderId],
    )
  ).rows[0];
  if (!participant) return;

  // Find the other participant(s) and tell them to re-offer
  const others = (
    await db.query(
      "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND user_id != $2",
      [conversationId, senderId],
    )
  ).rows;

  for (const p of others) {
    sendToUser(tenantId, p.user_id, "call_reconnect", {
      callId,
      conversationId,
      userId: senderId,
    });
  }
}

export async function handleCallReaction({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  const { conversationId, targetUserId, emoji } = msg.data || {};
  if (!conversationId || !targetUserId || !emoji) return;
  const allowedEmojis = [
    "\u{1F44D}",
    "\u{1F44F}",
    "\u{2764}\u{FE0F}",
    "\u{1F602}",
    "\u{1F389}",
    "\u{1F914}",
  ];
  if (!allowedEmojis.includes(emoji)) return;
  // Both sender AND target must be in the conversation — otherwise a
  // participant could spam reactions at arbitrary users (privacy/harassment).
  const senderInConv = await isConversationMember(
    db,
    tenantId,
    conversationId,
    senderId,
  );
  if (!senderInConv) return;
  const targetInConv = await isConversationMember(
    db,
    tenantId,
    conversationId,
    targetUserId,
  );
  if (!targetInConv) return;
  sendToUser(tenantId, targetUserId, "call_reaction", {
    conversationId,
    fromUserId: senderId,
    emoji,
  });
}

export async function handleCallAddParticipant({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: CallHandlerArgs): Promise<void> {
  // Add a participant to an ongoing GROUP call.
  // We only allow this on existing group conversations so a 1:1 DM
  // can never be silently mutated into a group.
  const { callId, conversationId, targetUserId } = msg.data || {};
  if (!callId || !conversationId || !targetUserId) return;

  const callLog = (
    await db.query("SELECT * FROM call_logs WHERE id = $1 AND status = $2", [
      callId,
      "answered",
    ])
  ).rows[0];
  if (!callLog) return;

  // Verify sender is in the call conversation
  const senderOk = (
    await db.query(
      "SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
      [conversationId, senderId],
    )
  ).rows[0];
  if (!senderOk) return;

  // Refuse to upgrade a 1:1 conversation into a group via this path.
  const conv = (
    await db.query("SELECT is_group FROM conversations WHERE id = $1", [
      conversationId,
    ])
  ).rows[0];
  if (!conv || !conv.is_group) {
    logger.warn(
      { senderId, callId, conversationId, targetUserId },
      "call_add_participant: rejected — conversation is not a group",
    );
    return;
  }

  // Add target to conversation (no-op if they were already a member)
  await db.query(
    `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [conversationId, targetUserId],
  );

  const caller = (
    await db.query("SELECT full_name, avatar FROM users WHERE id = $1", [
      senderId,
    ])
  ).rows[0];

  // Notify target as incoming call
  sendToUser(tenantId, targetUserId, "call_incoming", {
    callId,
    conversationId,
    callerId: senderId,
    callerName: caller?.full_name,
    callerAvatar: caller?.avatar,
    callType: callLog.call_type,
    isGroup: true,
    isJoining: true,
  });

  // Send push notification for group call participant addition
  pushNotifications
    .sendCallNotification(db.query as any, targetUserId, tenantId, {
      callId,
      conversationId,
      callerId: senderId,
      callerName: caller?.full_name || "Unknown",
      callerAvatar: caller?.avatar,
      callType: callLog.call_type as "voice" | "video",
      isGroup: true,
    })
    .catch((err: any) => {
      logger.warn(
        { err: err.message, userId: targetUserId, callId },
        "Failed to send group call push notification",
      );
    });
}
