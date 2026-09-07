/**
 * GROUP MEETING WebSocket handlers, extracted from ws.ts as part of the
 * calls/meetings-module separation. Handles: meeting_join, meeting_leave,
 * meeting_end, meeting_signal, meeting_subscribe, meeting_ready,
 * meeting_add_participant, meeting_mute_participant, meeting_raise_hand,
 * meeting_track_state, meeting_request_quality, meeting_audio_level,
 * meeting_screen_track_id, meeting_chat, meeting_chat_replay.
 *
 * Dependencies are injected (same pattern as wsHandlers/call.ts and
 * wsHandlers/huddles.ts) so this module never imports ws.ts. Logic is moved
 * verbatim from the original `handleChatMessage` dispatcher — pure
 * structural refactor, no behaviour changes.
 */
import { logger } from "../logger";
import { pushNotifications } from "../../services/pushNotifications";
import { withIdempotency } from "../wsIdempotency";
import * as signalStore from "../../realtime/signalStore";
const statusService = require("../../services/status");
import {
  DbLike,
  ExtWS,
  SendToUser,
  isMeetingMember,
  replayMeetingSignals,
  hasOpenSocket,
  cancelMeetingDisconnectCleanup,
} from "./shared";

export interface MeetingHandlerArgs {
  db: DbLike;
  senderId: number;
  tenantId: number | null;
  msg: any;
  ws: ExtWS;
  sendToUser: SendToUser;
}


export async function handleMeetingSignal({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // WebRTC mesh signaling between meeting participants
  const { meetingId, targetUserId, signal } = msg.data || {};
  if (!meetingId || !targetUserId || !signal) return;

  // Verify BOTH sender and target are participants of the meeting for
  // EVERY signal type. Previously only offer/answer checked the sender
  // (never the target) and ICE skipped all checks, letting any tenant
  // user inject mesh signaling to an arbitrary userId. Cached for ICE bursts.
  const senderOk = await isMeetingMember(db, tenantId, meetingId, senderId);
  const targetOk = await isMeetingMember(db, tenantId, meetingId, targetUserId);
  if (!senderOk || !targetOk) {
    logger.warn(
      {
        senderId,
        targetUserId,
        meetingId,
        senderOk,
        targetOk,
        signalType: signal?.type,
      },
      "meeting_signal: participant check failed",
    );
    return;
  }

  logger.debug(
    { senderId, targetUserId, meetingId, signalType: signal.type, tenantId },
    "meeting_signal: relaying",
  );

  // RELIABLE MESH DELIVERY (group-call parity with the 1:1 buffer): if the
  // target peer has NO open socket on this instance (mid-join, cold start,
  // or briefly reconnecting within the 15s grace window), buffer the OFFER /
  // ICE so we can replay it the instant they (re)join / subscribe / signal
  // ready. Without this the one offline pair never connects while the rest
  // of the mesh does ("one tile stuck on Connecting…"). We STILL relay below
  // (sendToUser also publishes cross-instance) so an already-subscribed peer
  // on this or another instance receives it immediately.
  if (
    (signal.type === "offer" || signal.type === "candidate") &&
    !hasOpenSocket(tenantId, targetUserId)
  ) {
    await signalStore.bufferMeetingSignal(tenantId, Number(meetingId), senderId, Number(targetUserId), signal);
    logger.debug(
      { senderId, targetUserId, meetingId, signalType: signal.type },
      "meeting_signal: buffered for offline peer",
    );
  }

  sendToUser(tenantId, targetUserId, "meeting_signal", {
    meetingId,
    fromUserId: senderId,
    signal,
  });
}

export async function handleMeetingSubscribe({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // GROUP-CALL reliable-delivery handshake (mesh parity with `call_subscribe`).
  // A (re)joining peer sends this once its WS handler is attached + it is
  // ready to receive offers. We (1) replay any OFFER/ICE buffered for them
  // while they were offline, and (2) tell every OTHER joined peer to
  // (re)offer toward this user via `meeting_peer_ready` (idempotent under
  // Perfect Negotiation). This closes the race where a peer's offer was
  // emitted before the newcomer's handler was listening.
  const { meetingId } = msg.data || {};
  if (!meetingId) return;
  if (!(await isMeetingMember(db, tenantId, meetingId, senderId))) return;
  await replayMeetingSignals(tenantId, Number(meetingId), senderId, (fromUserId, signal) => {
    sendToUser(tenantId, senderId, "meeting_signal", {
      meetingId,
      fromUserId,
      signal,
    });
  });
  const others = (
    await db.query(
      `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined' AND user_id != $2`,
      [meetingId, senderId],
    )
  ).rows;
  for (const p of others) {
    sendToUser(tenantId, p.user_id, "meeting_peer_ready", {
      meetingId,
      userId: senderId,
    });
  }
}

export async function handleMeetingReady({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // GROUP-CALL: the peer's RTCPeerConnection set is built and it is ready to
  // (re)negotiate. Same effect as `meeting_subscribe` — replay buffered
  // signals to this user and ask the other peers to (re)offer. Kept as a
  // distinct verb so the client can signal "media acquired + PCs created"
  // separately from "WS subscribed" (mirrors call_ready vs call_subscribe).
  const { meetingId } = msg.data || {};
  if (!meetingId) return;
  if (!(await isMeetingMember(db, tenantId, meetingId, senderId))) return;
  await replayMeetingSignals(tenantId, Number(meetingId), senderId, (fromUserId, signal) => {
    sendToUser(tenantId, senderId, "meeting_signal", {
      meetingId,
      fromUserId,
      signal,
    });
  });
  const others = (
    await db.query(
      `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined' AND user_id != $2`,
      [meetingId, senderId],
    )
  ).rows;
  for (const p of others) {
    sendToUser(tenantId, p.user_id, "meeting_peer_ready", {
      meetingId,
      userId: senderId,
    });
  }
}

export async function handleMeetingAddParticipant({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Add someone to an active meeting / group CALL (huddle).
  // Meetings: gated by the permission preset (default: host only).
  // Huddles: ANY joined member may pull in another tenant user
  // (Signal/Slack "add to call" parity — a group call has no "host").
  const { meetingId, targetUserId } = msg.data || {};
  if (!meetingId || !targetUserId) return;

  const meeting = (
    await db.query("SELECT * FROM meetings WHERE id = $1", [meetingId])
  ).rows[0];
  if (!meeting || meeting.status === "ended") return;

  if (meeting.is_huddle) {
    // Any *joined* member of the live call can add people.
    const joinedOk = (
      await db.query(
        `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND status = 'joined'`,
        [meetingId, senderId],
      )
    ).rows[0];
    if (!joinedOk) return;
  } else {
    const meetingPerms = require("../meetingPermissions");
    if (
      !meetingPerms.can(
        { userId: senderId },
        meeting,
        meetingPerms.ACTIONS.ADD_PARTICIPANT,
      )
    )
      return;
  }

  const targetUser = (
    await db.query("SELECT full_name, avatar FROM users WHERE id = $1", [
      targetUserId,
    ])
  ).rows[0];
  if (!targetUser) return;

  await db.query(
    `INSERT INTO meeting_participants (meeting_id, user_id, role, status)
           VALUES ($1, $2, 'participant', 'invited') ON CONFLICT (meeting_id, user_id) DO NOTHING`,
    [meetingId, targetUserId],
  );
  if (meeting.conversation_id) {
    await db.query(
      `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [meeting.conversation_id, targetUserId],
    );
  }

  const organizer = (
    await db.query("SELECT full_name, avatar FROM users WHERE id = $1", [
      senderId,
    ])
  ).rows[0];

  if (meeting.is_huddle) {
    // Group CALL (huddle): RING the added member with `call_incoming` so they
    // get the native incoming-call UI and join the live mesh (Signal-style
    // "add to call"), instead of a passive meeting invite. Mirrors the
    // huddle create ring in routes/meetings.ts.
    const callType =
      meeting.settings && meeting.settings.callType === "video"
        ? "video"
        : "voice";
    sendToUser(tenantId, targetUserId, "call_incoming", {
      callId: meeting.id,
      conversationId: meeting.conversation_id,
      callerId: senderId,
      callerName: organizer?.full_name,
      callerAvatar: organizer?.avatar,
      callType,
      isGroup: true,
      groupName: meeting.title,
      meetingCode: meeting.meeting_code,
      meetingId: meeting.id,
      isHuddle: true,
      isJoining: true,
    });
    pushNotifications
      .sendCallNotification(db.query as any, targetUserId, tenantId, {
        callId: meeting.id,
        conversationId: meeting.conversation_id,
        callerId: senderId,
        callerName: organizer?.full_name || "Unknown",
        callerAvatar: organizer?.avatar,
        callType: callType as "voice" | "video",
        isGroup: true,
        groupName: meeting.title,
        meetingCode: meeting.meeting_code,
      })
      .catch((err: any) => {
        logger.warn(
          { err: err.message, userId: targetUserId, meetingId },
          "Failed to send huddle add-participant push notification",
        );
      });
  } else {
    sendToUser(tenantId, targetUserId, "meeting_invite", {
      meetingId,
      meetingCode: meeting.meeting_code,
      title: meeting.title,
      organizerName: organizer?.full_name,
      conversationId: meeting.conversation_id,
      isOngoing: true,
    });
  }
}

export async function handleMeetingMuteParticipant({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Organizer mutes/unmutes a participant. Phase 3 — Permission Presets:
  // route through the shared `meetingPermissions` helper so the 'open'
  // preset (which lets every joined participant mute anyone) works
  // without an extra branch here. The previous behaviour was
  // "only the organiser can mute"; the standard preset preserves that.
  //
  // Phase 2 — Idempotency: clients now send an optional `clientMsgId`
  // for every mute toggle. `withIdempotency` dedupes the second
  // click during a glitchy WS reconnect so the target doesn't see
  // their mic toggled twice in a row. Legacy clients (no id) keep
  // the previous behaviour — the wrapper is a no-op without an id.
  const {
    meetingId,
    targetUserId,
    muted,
    clientMsgId: rawIdMute,
  } = msg.data || {};
  if (!meetingId || !targetUserId) return;
  await withIdempotency(
    {
      tenantId,
      senderId,
      type: "meeting_mute_participant",
      clientMsgId: rawIdMute,
    },
    async () => {
      const meeting = (
        await db.query("SELECT * FROM meetings WHERE id = $1", [meetingId])
      ).rows[0];
      if (!meeting) return;
      const meetingPerms = require("../meetingPermissions");
      if (
        !meetingPerms.can(
          { userId: senderId },
          meeting,
          meetingPerms.ACTIONS.MUTE_OTHERS,
        )
      )
        return;

      // Notify the target to mute/unmute themselves
      sendToUser(tenantId, targetUserId, "meeting_muted", {
        meetingId,
        muted: muted !== false,
        byUserId: senderId,
      });

      // Broadcast updated mute state to all participants so UI reflects change
      const participants = (
        await db.query(
          `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined'`,
          [meetingId],
        )
      ).rows;
      for (const p of participants) {
        if (p.user_id !== targetUserId) {
          sendToUser(tenantId, p.user_id, "meeting_track_state", {
            meetingId,
            userId: targetUserId,
            muted: muted !== false,
            videoOff: null,
            screenSharing: null,
          });
        }
      }
    },
  );
}

export async function handleMeetingRaiseHand({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Phase 2 — Idempotency: the hand-toggle button is one of the
  // easiest things to double-fire on a flaky link (user taps, sees
  // no response, taps again). With `clientMsgId` the second tap
  // becomes a free no-op rather than re-flipping the state and
  // re-broadcasting to every participant.
  const { meetingId, raised, clientMsgId: rawIdHand } = msg.data || {};
  if (!meetingId) return;
  await withIdempotency(
    {
      tenantId,
      senderId,
      type: "meeting_raise_hand",
      clientMsgId: rawIdHand,
    },
    async () => {
      // Verify sender is an active participant
      const senderOk = (
        await db.query(
          `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND status = 'joined'`,
          [meetingId, senderId],
        )
      ).rows[0];
      if (!senderOk) return;

      const participants = (
        await db.query(
          `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined'`,
          [meetingId],
        )
      ).rows;

      const raiser = (
        await db.query("SELECT full_name FROM users WHERE id = $1", [
          senderId,
        ])
      ).rows[0];
      for (const p of participants) {
        sendToUser(tenantId, p.user_id, "meeting_hand_raised", {
          meetingId,
          userId: senderId,
          name: raiser?.full_name,
          raised: !!raised,
        });
      }
    },
  );
}

export async function handleMeetingTrackState({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Participant broadcasts their muted/videoOff state
  const { meetingId, muted, videoOff, screenSharing } = msg.data || {};
  if (!meetingId) return;

  // Verify sender is an active participant
  const senderOk = (
    await db.query(
      `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND status = 'joined'`,
      [meetingId, senderId],
    )
  ).rows[0];
  if (!senderOk) return;

  const participants = (
    await db.query(
      `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined'`,
      [meetingId],
    )
  ).rows;

  // Only include explicitly-sent fields to avoid coercing undefined to false
  const trackState: Record<string, unknown> = { meetingId, userId: senderId };
  if (muted !== undefined) trackState.muted = !!muted;
  if (videoOff !== undefined) trackState.videoOff = !!videoOff;
  if (screenSharing !== undefined) trackState.screenSharing = !!screenSharing;

  for (const p of participants) {
    if (p.user_id !== senderId) {
      sendToUser(tenantId, p.user_id, "meeting_track_state", trackState);
    }
  }
}

export async function handleMeetingRequestQuality({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Phase 5 — Mesh quality. The receiving peer is telling the sending
  // peer "I only need 'q' / 'h' / 'f' (quality/half/full) right now"
  // because the sender's tile is currently:
  //   • off-screen (IntersectionObserver fired)
  //   • a tiny PiP / sidebar mini tile
  //   • NOT the active speaker (Phase 5 prioritisation)
  //
  // The sending peer flips `setParameters({ encodings: [{ maxBitrate }]})`
  // on the matching RTCRtpSender. This is the mesh equivalent of an SFU's
  // simulcast layer selection — done client-side because mesh has no
  // server-side media routing.
  //
  // Server is a pure relay; no DB checks (both parties were verified at
  // meeting_join). The payload is intentionally tiny so we don't
  // care about validation overhead.
  const { meetingId, targetUserId, level } = msg.data || {};
  if (!meetingId || !targetUserId) return;
  if (!["q", "h", "f"].includes(level)) return;
  // Verify sender and target are both meeting participants before relaying
  // — otherwise any user could force an arbitrary user's encoder to the
  // lowest bitrate (media-sabotage DoS). Cached.
  if (!(await isMeetingMember(db, tenantId, meetingId, senderId))) return;
  if (!(await isMeetingMember(db, tenantId, meetingId, targetUserId))) return;
  sendToUser(tenantId, targetUserId, "meeting_request_quality", {
    meetingId,
    fromUserId: senderId,
    level,
  });
}

export async function handleMeetingAudioLevel({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Phase 5 — Active-speaker. Sender broadcasts their local RMS audio
  // level (0..1) sampled every ~500ms via the existing WebAudio
  // analyser. The server fans this out to every participant so they
  // can independently compute "who's the active speaker right now"
  // without needing a central SFU. We deliberately throttle on the
  // CLIENT (not here) — server is a dumb relay.
  const { meetingId, level } = msg.data || {};
  if (!meetingId || typeof level !== "number" || level < 0 || level > 1)
    return;
  // Reuse the meeting-chat broadcast audience (joined + invited) so
  // mid-reconnect participants don't miss active-speaker updates.
  const senderOk = (
    await db.query(
      `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND status = 'joined'`,
      [meetingId, senderId],
    )
  ).rows[0];
  if (!senderOk) return;
  const participants = (
    await db.query(
      `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined'`,
      [meetingId],
    )
  ).rows;
  for (const p of participants) {
    if (p.user_id === senderId) continue;
    sendToUser(tenantId, p.user_id, "meeting_audio_level", {
      meetingId,
      userId: senderId,
      level,
    });
  }
}

export async function handleMeetingScreenTrackId({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Sender is announcing which of the tracks they sent over their
  // peer connection is the screen share. Client-side `useMeetingState`
  // uses this to route the incoming track from the camera stream
  // (shown in the participant tile) to a dedicated screen stream
  // (shown in PresenterView). Server only relays — no DB checks
  // needed since both peers were already verified at meeting_join.
  const { meetingId, targetUserId, sharing, trackId } = msg.data || {};
  if (!meetingId || !targetUserId) return;
  // Verify sender and target are both meeting participants before relaying
  // — otherwise any user could inject screen-routing signals at an
  // arbitrary user. Cached.
  if (!(await isMeetingMember(db, tenantId, meetingId, senderId))) return;
  if (!(await isMeetingMember(db, tenantId, meetingId, targetUserId))) return;
  sendToUser(tenantId, targetUserId, "meeting_screen_track_id", {
    meetingId,
    fromUserId: senderId,
    sharing: !!sharing,
    trackId: trackId || null,
  });
}

