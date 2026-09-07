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
export async function handleMeetingJoin({
  db,
  senderId,
  tenantId,
  msg,
  ws,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  const { meetingId } = msg.data || {};
  if (!meetingId) return;
  // First thing: cancel any pending disconnect-cleanup. Happy path for
  // a transient WS drop — the user reconnected within the grace window,
  // so we silently keep them in the meeting (no `meeting_participant_left`
  // was ever broadcast and the other participants' RTCPeerConnections
  // are untouched).
  const cancelledPending = await cancelMeetingDisconnectCleanup({
    tenantId,
    userId: senderId,
    meetingId,
  });
  if (cancelledPending) {
    logger.debug(
      { userId: senderId, meetingId },
      "Cancelled pending meeting cleanup on rejoin",
    );
  }
  const meeting = (
    await db.query("SELECT * FROM meetings WHERE id = $1", [meetingId])
  ).rows[0];
  if (!meeting) return;
  // Allow rejoining ended meetings — reactivate the meeting
  if (meeting.status === "ended") {
    await db.query(
      `UPDATE meetings SET status = 'active', ended_at = NULL WHERE id = $1`,
      [meetingId],
    );
  }
  // Verify participant is allowed
  const mp = (
    await db.query(
      "SELECT status FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2",
      [meetingId, senderId],
    )
  ).rows[0];
  const isOrgMember = meeting.org_id
    ? (
        await db.query("SELECT 1 FROM users WHERE id = $1 AND org_id = $2", [
          senderId,
          meeting.org_id,
        ])
      ).rows[0]
    : true;
  if (!mp && !isOrgMember) return;
  // Track if this is a rejoin (already had status 'joined') to skip duplicate system messages
  const wasAlreadyJoined = mp?.status === "joined";
  // Upsert participant
  await db.query(
    `INSERT INTO meeting_participants (meeting_id, user_id, role, status, joined_at)
           VALUES ($1, $2, 'participant', 'joined', NOW())
           ON CONFLICT (meeting_id, user_id) DO UPDATE SET status = 'joined', joined_at = NOW(), left_at = NULL`,
    [meetingId, senderId],
  );

  // Tag this WS connection so we can clean up on disconnect
  ws._activeMeetingId = meetingId;

  // HUDDLE ANSWERED-ELSEWHERE (Signal/WhatsApp parity): joining a group CALL
  // is the "answer". Dismiss the ring on the answerer's OTHER devices (WS
  // frame for live sockets + push-cancel for backgrounded/killed twins) so a
  // user who answers on their phone doesn't keep ringing on their desktop.
  // Best-effort; never blocks the join.
  if (meeting.is_huddle) {
    try {
      sendToUser(tenantId, senderId, "call_handled_elsewhere", {
        callId: meeting.id,
        conversationId: meeting.conversation_id,
        action: "accepted",
      });
      pushNotifications
        .sendCallCancellation(db.query as any, senderId, tenantId, {
          callId: meeting.id,
          conversationId: meeting.conversation_id,
          reason: "answered_elsewhere",
        })
        .catch((err: any) =>
          logger.warn(
            { err: err?.message, userId: senderId, meetingId },
            "huddle answered-elsewhere push-cancel failed",
          ),
        );
    } catch (err: any) {
      logger.warn(
        { err: err?.message, meetingId },
        "huddle answered-elsewhere ring-cancel failed",
      );
    }
  }

  // Determine if we should notify other participants
  const isRestart = meeting.status === "ended";
  const isFirstStart = meeting.status === "scheduled";
  // For active meetings, notify if no one else is currently in the meeting
  let isFirstJoinActive = false;
  if (meeting.status === "active" && !isFirstStart) {
    const currentlyJoined = (
      await db.query(
        `SELECT COUNT(*) as cnt FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined' AND user_id != $2`,
        [meetingId, senderId],
      )
    ).rows[0];
    isFirstJoinActive = parseInt(currentlyJoined.cnt) === 0;
  }

  // Mark meeting as active on first join
  if (isFirstStart) {
    await db.query(
      `UPDATE meetings SET status = 'active', started_at = NOW() WHERE id = $1`,
      [meetingId],
    );
  }

  // Huddles (instant group CALLS) are decoupled from the user-visible
  // "Meeting" concept: they must NOT emit `meeting_started` /
  // `meeting_restarted` cards, persistent notifications, or a
  // `meeting_joined` system message into the chat. The group stays a pure
  // chat group and the call rings via `call_incoming` only. The mesh
  // transport (peer discovery via `meeting_participant_joined`) is reused.
  if (!meeting.is_huddle && (isFirstStart || isRestart || isFirstJoinActive)) {
    // Notify all invited participants that the meeting has started/restarted
    const allInvited = (
      await db.query(
        `SELECT mp.user_id FROM meeting_participants mp
               WHERE mp.meeting_id = $1 AND mp.user_id != $2`,
        [meetingId, senderId],
      )
    ).rows;
    const starter = (
      await db.query("SELECT full_name, avatar FROM users WHERE id = $1", [
        senderId,
      ])
    ).rows[0];
    const starterName = starter?.full_name || "Someone";
    const notifType = isRestart ? "meeting_restarted" : "meeting_started";
    const notifTitle = isRestart
      ? `Meeting Restarted: ${meeting.title || "Untitled"}`
      : `Meeting Started: ${meeting.title || "Untitled"}`;
    const notifBody = isRestart
      ? `${starterName} restarted the meeting`
      : `${starterName} started the meeting`;

    for (const p of allInvited) {
      try {
        await db.query(
          `INSERT INTO notifications (user_id, type, title, body) VALUES ($1, $2, $3, $4)`,
          [p.user_id, notifType, notifTitle, notifBody],
        );
      } catch {
        /* ignore duplicate or constraint errors */
      }

      sendToUser(tenantId, p.user_id, "meeting_started", {
        meetingId,
        meetingCode: meeting.meeting_code,
        title: meeting.title,
        organizerName: starterName,
        organizerAvatar: starter?.avatar,
        startedBy: senderId,
        restarted: isRestart,
      });
      sendToUser(tenantId, p.user_id, "notification", {
        title: notifTitle,
        body: notifBody,
      });
    }
  }

  const [joinerResult, allParticipantsResult] = await Promise.all([
    db.query("SELECT full_name, avatar, username FROM users WHERE id = $1", [
      senderId,
    ]),
    db.query(
      `SELECT mp.user_id, u.full_name, u.avatar, u.username
               FROM meeting_participants mp JOIN users u ON u.id = mp.user_id
               WHERE mp.meeting_id = $1 AND mp.status = $2`,
      [meetingId, "joined"],
    ),
  ]);

  const joiner = joinerResult.rows[0];
  const allParticipants = allParticipantsResult.rows;

  // Build existingPeers with full user info so the joiner can display names
  const existingPeers = allParticipants
    .filter((p) => p.user_id !== senderId)
    .map((p) => ({
      userId: p.user_id,
      fullName: p.full_name,
      avatar: p.avatar,
      username: p.username,
    }));

  for (const p of allParticipants) {
    sendToUser(tenantId, p.user_id, "meeting_participant_joined", {
      meetingId,
      userId: senderId,
      fullName: joiner?.full_name,
      avatar: joiner?.avatar,
      username: joiner?.username,
      existingPeers: p.user_id === senderId ? existingPeers : undefined,
    });
  }

  // RELIABLE MESH DELIVERY: replay any OFFER/ICE that existing peers sent
  // toward this user while they had no open socket (cold start / reconnect
  // within the grace window). The joiner just attached its WS handler and
  // got `existingPeers`, so it is ready to consume them. This is the mesh
  // analogue of the 1:1 `call_accept`/`call_subscribe` replay and the core
  // fix for "one tile stuck on Connecting…" after a (re)join. The client
  // additionally sends `meeting_subscribe` for a belt-and-braces re-request,
  // but replaying here means the happy path needs no extra round-trip.
  await replayMeetingSignals(tenantId, Number(meetingId), senderId, (fromUserId, signal) => {
    sendToUser(tenantId, senderId, "meeting_signal", {
      meetingId,
      fromUserId,
      signal,
    });
  });

  // System message in conversation (skip on PiP rejoin to avoid duplicates).
  // Huddles never post a `meeting_joined` system row — a group CALL is not a
  // meeting and must not leave meeting artifacts in the chat thread.
  if (meeting.conversation_id && !wasAlreadyJoined && !meeting.is_huddle) {
    const sysMsg = (
      await db.query(
        `INSERT INTO messages (conversation_id, sender_id, content, format_type, metadata)
               VALUES ($1, $2, '', 'system', $3) RETURNING id, created_at`,
        [
          meeting.conversation_id,
          senderId,
          JSON.stringify({
            type: "meeting_joined",
            meetingId,
            name: joiner?.full_name,
          }),
        ],
      )
    ).rows[0];
    const convParticipants = (
      await db.query(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = $1",
        [meeting.conversation_id],
      )
    ).rows;
    for (const p of convParticipants) {
      sendToUser(tenantId, p.user_id, "chat_message", {
        id: sysMsg.id,
        conversationId: meeting.conversation_id,
        senderId,
        content: "",
        formatType: "system",
        metadata: {
          type: "meeting_joined",
          meetingId,
          name: joiner?.full_name,
        },
        createdAt: sysMsg.created_at,
      });
    }
  }

  // Status service v2: mark THIS device of the joiner as in_meeting.
  // Per-session: their other tabs/devices retain their existing status.
  if (ws._statusSessionKey) {
    statusService
      .setSessionActivity(
        { db, tenantId },
        ws._statusSessionKey,
        "in_meeting",
        meetingId,
      )
      .catch((err: any) =>
        logger.warn(
          { err: err.message, meetingId },
          "setSessionActivity(in_meeting) failed",
        ),
      );
    ws._meetingActivityRefId = meetingId;
  }
}

export async function handleMeetingLeave({
  db,
  senderId,
  tenantId,
  msg,
  ws,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  const { meetingId } = msg.data || {};
  if (!meetingId) return;

  // Clear the tag so disconnect handler doesn't double-leave
  ws._activeMeetingId = null;
  // An explicit leave overrides any scheduled grace-window cleanup
  // — we do the cleanup synchronously below instead.
  await cancelMeetingDisconnectCleanup({ tenantId, userId: senderId, meetingId });

  // Verify sender is actually a joined participant
  const isJoined = (
    await db.query(
      `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND status = 'joined'`,
      [meetingId, senderId],
    )
  ).rows[0];
  if (!isJoined) return;

  await db.query(
    `UPDATE meeting_participants SET status = 'left', left_at = NOW() WHERE meeting_id = $1 AND user_id = $2`,
    [meetingId, senderId],
  );

  // Drop any mesh signals buffered for / from the leaver.
  await signalStore.clearMeetingUserSignals(tenantId, meetingId, senderId);

  const activeParticipants = (
    await db.query(
      `SELECT mp.user_id FROM meeting_participants mp WHERE mp.meeting_id = $1 AND mp.status = 'joined'`,
      [meetingId],
    )
  ).rows;

  for (const p of activeParticipants) {
    sendToUser(tenantId, p.user_id, "meeting_participant_left", {
      meetingId,
      userId: senderId,
    });
  }

  // If no active participants, mark meeting ended (use WHERE to prevent double-update race)
  if (activeParticipants.length === 0) {
    // Empty meeting — drop the whole mesh signal buffer.
    await signalStore.clearMeetingSignals(tenantId, meetingId);
    await db.query(
      `UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE id = $1 AND status != 'ended'`,
      [meetingId],
    );

    // HUDDLE RING-CANCEL (Slack/Teams/Signal parity): a "huddle" is a group
    // CALL whose ring is a `call_incoming` event sent to every invited
    // member. If the LAST joined participant leaves — most importantly the
    // initiator backing out BEFORE anyone answered — the callees' devices are
    // still ringing (they only dismiss on call_ended/rejected/handled). We
    // must therefore broadcast `call_ended` + push-cancel to every invited
    // member so the ring stops everywhere. Best-effort.
    try {
      const meetingRow = (
        await db.query(
          "SELECT id, is_huddle, conversation_id FROM meetings WHERE id = $1",
          [meetingId],
        )
      ).rows[0];
      if (meetingRow?.is_huddle) {
        const invited = (
          await db.query(
            `SELECT user_id FROM meeting_participants WHERE meeting_id = $1`,
            [meetingId],
          )
        ).rows;
        for (const p of invited) {
          sendToUser(tenantId, p.user_id, "call_ended", {
            callId: meetingRow.id,
            conversationId: meetingRow.conversation_id,
            reason: "cancelled",
          });
          pushNotifications
            .sendCallCancellation(db.query as any, p.user_id, tenantId, {
              callId: meetingRow.id,
              conversationId: meetingRow.conversation_id,
              reason: "cancelled",
            })
            .catch((err: any) =>
              logger.warn(
                { err: err?.message, userId: p.user_id, meetingId },
                "huddle ring-cancel push (meeting_leave) failed",
              ),
            );
        }
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, meetingId },
        "huddle ring-cancel on meeting_leave failed",
      );
    }
  }

  // Status service v2: clear in_meeting on THIS device only. Other
  // devices of the same user (e.g. they joined the meeting from
  // desktop while ALSO having a browser tab open with no meeting)
  // keep their state intact.
  if (ws._statusSessionKey) {
    statusService
      .clearSessionActivity(
        { db, tenantId },
        ws._statusSessionKey,
        "in_meeting",
      )
      .catch((err: any) =>
        logger.warn(
          { err: err.message, meetingId },
          "clearSessionActivity(in_meeting) on leave failed",
        ),
      );
    if (ws._meetingActivityRefId === meetingId)
      ws._meetingActivityRefId = null;
  }
}

export async function handleMeetingEnd({
  db,
  senderId,
  tenantId,
  msg,
  ws,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  const { meetingId } = msg.data || {};
  if (!meetingId) return;

  ws._activeMeetingId = null;
  await cancelMeetingDisconnectCleanup({ tenantId, userId: senderId, meetingId });

  const meeting = (
    await db.query(
      "SELECT * FROM meetings WHERE id = $1 AND created_by = $2",
      [meetingId, senderId],
    )
  ).rows[0];
  if (!meeting) return;

  const startedAt = meeting.started_at ? new Date(meeting.started_at) : null;
  const durationSecs = startedAt
    ? Math.round((Date.now() - startedAt.getTime()) / 1000)
    : null;

  await db.query(
    `UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE id = $1`,
    [meetingId],
  );
  await db.query(
    `UPDATE meeting_participants SET status = 'left', left_at = NOW() WHERE meeting_id = $1`,
    [meetingId],
  );

  // Terminal transition — drop the whole mesh signal buffer for this meeting.
  await signalStore.clearMeetingSignals(tenantId, meetingId);

  const activeParticipants = (
    await db.query(
      "SELECT user_id FROM meeting_participants WHERE meeting_id = $1",
      [meetingId],
    )
  ).rows;

  for (const p of activeParticipants) {
    sendToUser(tenantId, p.user_id, "meeting_ended", {
      meetingId,
      endedBy: senderId,
      duration: durationSecs,
    });
  }

  // HUDDLE RING-CANCEL (Slack/Teams/Signal parity): the host ended a group
  // CALL. Any invited member still ringing (never answered) must have their
  // ring dismissed — broadcast `call_ended` + push-cancel to every invited
  // member. Best-effort.
  if (meeting.is_huddle) {
    try {
      const invited = (
        await db.query(
          `SELECT user_id FROM meeting_participants WHERE meeting_id = $1`,
          [meetingId],
        )
      ).rows;
      for (const p of invited) {
        sendToUser(tenantId, p.user_id, "call_ended", {
          callId: meeting.id,
          conversationId: meeting.conversation_id,
          reason: "ended",
        });
        pushNotifications
          .sendCallCancellation(db.query as any, p.user_id, tenantId, {
            callId: meeting.id,
            conversationId: meeting.conversation_id,
            reason: "ended",
          })
          .catch((err: any) =>
            logger.warn(
              { err: err?.message, userId: p.user_id, meetingId },
              "huddle ring-cancel push (meeting_end) failed",
            ),
          );
      }
    } catch (err: any) {
      logger.warn(
        { err: err?.message, meetingId },
        "huddle ring-cancel on meeting_end failed",
      );
    }
  }

  // System message in conversation. Huddles never post a meeting system row.
  if (meeting.conversation_id && !meeting.is_huddle) {
    const sysMsg = (
      await db.query(
        `INSERT INTO messages (conversation_id, sender_id, content, format_type, metadata)
               VALUES ($1, $2, '', 'system', $3) RETURNING id, created_at`,
        [
          meeting.conversation_id,
          senderId,
          JSON.stringify({
            type: "meeting_ended",
            meetingId,
            duration: durationSecs,
          }),
        ],
      )
    ).rows[0];
    const convParticipants = (
      await db.query(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = $1",
        [meeting.conversation_id],
      )
    ).rows;
    for (const p of convParticipants) {
      sendToUser(tenantId, p.user_id, "chat_message", {
        id: sysMsg.id,
        conversationId: meeting.conversation_id,
        senderId,
        content: "",
        formatType: "system",
        metadata: {
          type: "meeting_ended",
          meetingId,
          duration: durationSecs,
        },
        createdAt: sysMsg.created_at,
      });
    }
  }

  // Status service v2: end of meeting ? clear in_meeting for EVERY
  // session referencing this meetingId (every participant, every device).
  statusService
    .clearActivityForRef({ db, tenantId }, "in_meeting", meetingId)
    .catch((err: any) =>
      logger.warn(
        { err: err.message, meetingId },
        "clearActivityForRef(in_meeting) on end failed",
      ),
    );
  if (ws._meetingActivityRefId === meetingId) ws._meetingActivityRefId = null;
}

