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


export async function handleMeetingChat({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // In-meeting chat message relay (text or file).
  //
  // RELIABILITY MODEL (Phase 0.5 "chat disappears" fix):
  //   • The client mints a `clientMsgId` (UUID) for every send and
  //     keeps the message in its pending-send queue until it sees
  //     either an echo OR an explicit ack from us. This handler
  //     therefore MUST be idempotent w.r.t. clientMsgId so retries
  //     from a flaky network never create duplicates.
  //   • Idempotency is enforced at the DB layer by the partial unique
  //     index `idx_messages_client_msg_id` over
  //     (conversation_id, sender_id, client_msg_id). We use
  //     `INSERT ... ON CONFLICT DO NOTHING` and, on conflict, fetch
  //     the canonical row so the echo always carries the persisted
  //     `id` + `created_at`.
  //   • We send a dedicated `meeting_message_ack` to the sender
  //     immediately after persistence, decoupled from the broadcast
  //     loop. This is critical because the broadcast only delivers
  //     to participants whose `status='joined'` AT THIS MOMENT — if
  //     the sender themselves is mid-reconnect, they'd never see the
  //     echo and the message would sit in their pending queue
  //     forever, eventually flipping to `_failed`. The ack closes
  //     that hole.
  //   • Persist errors are surfaced via `meeting_message_error`
  //     instead of being silently swallowed.
  //
  // PERSISTENCE: messages are written to the same `messages` table
  // used by regular chat, scoped to the meeting's `conversation_id`.
  // This mirrors videosdk's PubSub `persist: true` semantic and lets
  // participants who refresh / rejoin re-hydrate the full chat
  // history via `GET /api/meetings/:code/messages`.
  const { meetingId, text, file_url, file_name, file_size, clientMsgId } =
    msg.data || {};
  if (!meetingId) return;
  if (
    !file_url &&
    (!text || typeof text !== "string" || !text.trim() || text.length > 5000)
  ) {
    if (clientMsgId)
      sendToUser(tenantId, senderId, "meeting_message_error", {
        clientMsgId,
        reason: "invalid-payload",
      });
    return;
  }
  // We accept messages without a clientMsgId for backwards-compat,
  // but every new client supplies one. Sanity-cap the length so we
  // don't index unbounded user input.
  const safeClientMsgId =
    typeof clientMsgId === "string" &&
    clientMsgId.length > 0 &&
    clientMsgId.length <= 64
      ? clientMsgId
      : null;

  // Verify sender is an active participant
  const senderOk = (
    await db.query(
      `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 AND status = 'joined'`,
      [meetingId, senderId],
    )
  ).rows[0];
  if (!senderOk) {
    if (safeClientMsgId)
      sendToUser(tenantId, senderId, "meeting_message_error", {
        clientMsgId: safeClientMsgId,
        reason: "not-a-participant",
      });
    return;
  }

  // Fetch sender + meeting info (we need the meeting's conversation_id
  // to persist the message). Run in parallel for latency.
  //
  // BROADCAST AUDIENCE CHANGE: we no longer restrict to currently
  // `status='joined'` participants. The set of recipients now
  // includes everyone who has EVER joined this meeting — they may
  // be momentarily disconnected (within the 15s
  // MEETING_DISCONNECT_GRACE_MS window) and would otherwise miss
  // the message entirely. For users who are well and truly offline,
  // the message is already persisted and will reappear on their
  // next hydration via GET /:code/messages. `sendToUser` is a
  // no-op for users with no open WS connection so this is cheap.
  const [senderResult, meetingResult, participantsResult] = await Promise.all(
    [
      db.query("SELECT full_name FROM users WHERE id = $1", [senderId]),
      db.query("SELECT conversation_id FROM meetings WHERE id = $1", [
        meetingId,
      ]),
      db.query(
        `SELECT user_id FROM meeting_participants WHERE meeting_id = $1 AND status IN ('joined','invited')`,
        [meetingId],
      ),
    ],
  );
  const sender = senderResult.rows[0];
  const conversationId = meetingResult.rows[0]?.conversation_id || null;
  const participants = participantsResult.rows;

  // Persist to DB. Failure here is now a HARD error (we tell the
  // sender so the optimistic bubble can be marked _failed) — the
  // earlier "warn and continue" silently produced ephemeral
  // messages that vanished on the next rejoin.
  let persistedId: number | null = null;
  let persistedCreatedAt: string = new Date().toISOString();
  let persistError: any = null;
  if (conversationId) {
    try {
      // Encode file metadata in the messages.metadata JSONB column.
      // The content column stores the visible text — for file-only
      // messages we store the file name so legacy chat readers
      // still see something meaningful.
      const content =
        text && text.trim()
          ? text.trim()
          : file_name
            ? `📎 ${file_name}`
            : "";
      const metadata = {
        source: "meeting",
        meetingId,
        ...(file_url
          ? {
              file_url,
              file_name: file_name || "File",
              file_size: file_size || null,
            }
          : {}),
      };
      const inserted = await db.query(
        `INSERT INTO messages (conversation_id, sender_id, content, format_type, metadata, client_msg_id)
                   VALUES ($1, $2, $3, 'text', $4, $5)
                   ON CONFLICT (conversation_id, sender_id, client_msg_id)
                   WHERE client_msg_id IS NOT NULL
                   DO NOTHING
                   RETURNING id, created_at`,
        [
          conversationId,
          senderId,
          content,
          JSON.stringify(metadata),
          safeClientMsgId,
        ],
      );
      if (inserted.rows[0]) {
        persistedId = inserted.rows[0].id;
        persistedCreatedAt = inserted.rows[0].created_at;
        // Bump conversation updated_at so the meeting's chat row in
        // the user's main chat list also surfaces the activity.
        await db.query(
          "UPDATE conversations SET updated_at = NOW() WHERE id = $1",
          [conversationId],
        );
      } else if (safeClientMsgId) {
        // ON CONFLICT path: a previous attempt by this client
        // already inserted the row. Fetch its canonical id so
        // the echo carries the right primary key.
        const existing = (
          await db.query(
            `SELECT id, created_at FROM messages
                        WHERE conversation_id = $1 AND sender_id = $2 AND client_msg_id = $3
                        LIMIT 1`,
            [conversationId, senderId, safeClientMsgId],
          )
        ).rows[0];
        if (existing) {
          persistedId = existing.id;
          persistedCreatedAt = existing.created_at;
        }
      }
    } catch (err: any) {
      persistError = err;
      logger.warn(
        { err: err.message, meetingId, conversationId },
        "meeting_chat: persist failed",
      );
    }
  }

  if (persistError) {
    // Tell ONLY the sender so they can mark their optimistic bubble
    // as failed. Other participants don't need to know.
    if (safeClientMsgId) {
      sendToUser(tenantId, senderId, "meeting_message_error", {
        clientMsgId: safeClientMsgId,
        reason: "persist-failed",
      });
    }
    return;
  }

  // Send the ack to the sender FIRST. This is the signal the client's
  // pending-send queue waits on; it's decoupled from the broadcast so
  // even mid-reconnect senders get their queue drained.
  if (safeClientMsgId) {
    sendToUser(tenantId, senderId, "meeting_message_ack", {
      meetingId,
      clientMsgId: safeClientMsgId,
      id: persistedId,
      createdAt: persistedCreatedAt,
    });
  }

  const message: Record<string, unknown> = {
    id: persistedId,
    clientMsgId: safeClientMsgId, // round-trip the id on every echo
    sender_id: senderId,
    sender_name: sender?.full_name || "Participant",
    text: text ? text.trim() : null,
    created_at: persistedCreatedAt,
  };
  if (file_url) {
    message.file_url = file_url;
    message.file_name = file_name || "File";
    message.file_size = file_size || null;
  }

  for (const p of participants) {
    sendToUser(tenantId, p.user_id, "meeting_message", {
      meetingId,
      message,
    });
  }
}

export async function handleMeetingChatReplay({
  db,
  senderId,
  tenantId,
  msg,
  sendToUser,
}: MeetingHandlerArgs): Promise<void> {
  // Reconnect-recovery: the client just opened (or reopened) its WS
  // and wants to backfill any meeting chat that arrived while it
  // was disconnected. We respond with one `meeting_message` per
  // missed row plus a `meeting_chat_replay_done` marker so the
  // client can clear any "Reconnecting…" indicator.
  //
  // Cap at 200 messages — anything older falls back to the existing
  // GET /api/meetings/:code/messages REST endpoint.
  const { meetingId, sinceMessageId } = msg.data || {};
  if (!meetingId) return;

  // Verify the requester is allowed to see this meeting's chat.
  const allowed = (
    await db.query(
      `SELECT 1 FROM meeting_participants
            WHERE meeting_id = $1 AND user_id = $2`,
      [meetingId, senderId],
    )
  ).rows[0];
  if (!allowed) return;

  const meetingRow = (
    await db.query("SELECT conversation_id FROM meetings WHERE id = $1", [
      meetingId,
    ])
  ).rows[0];
  if (!meetingRow?.conversation_id) {
    sendToUser(tenantId, senderId, "meeting_chat_replay_done", {
      meetingId,
      count: 0,
    });
    return;
  }

  const since =
    Number.isInteger(sinceMessageId) && sinceMessageId > 0
      ? sinceMessageId
      : 0;
  const rows = (
    await db.query(
      `SELECT m.id, m.sender_id, m.content, m.metadata, m.created_at, m.client_msg_id,
                  u.full_name AS sender_name
             FROM messages m
             JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = $1
              AND m.id > $2
              AND (m.format_type != 'system' OR (m.metadata->>'type' IN ('meeting_joined','meeting_ended')))
            ORDER BY m.id ASC
            LIMIT 200`,
      [meetingRow.conversation_id, since],
    )
  ).rows;

  for (const r of rows) {
    const meta = r.metadata || {};
    const message = {
      id: r.id,
      clientMsgId: r.client_msg_id || null,
      sender_id: r.sender_id,
      sender_name: r.sender_name,
      text: meta.file_url ? null : r.content,
      created_at: r.created_at,
      ...(meta.file_url
        ? {
            file_url: meta.file_url,
            file_name: meta.file_name || null,
            file_size: meta.file_size || null,
          }
        : {}),
    };
    sendToUser(tenantId, senderId, "meeting_message", {
      meetingId,
      message,
      _replay: true,
    });
  }
  sendToUser(tenantId, senderId, "meeting_chat_replay_done", {
    meetingId,
    count: rows.length,
  });
}
