import { chatMessage } from "../utils/wsHandlers/chatMessage";
import { handleChatTyping, handleChatRead } from "../utils/wsHandlers/chat";
import { handleHuddleDecline } from "../utils/wsHandlers/huddles";
import {
  handleCallInitiate, handleCallAccept, handleCallCancel, handleCallReject,
  handleCallEnd, handleCallSignal, handleCallSubscribe, handleCallReady,
  handleCallReconnect, handleCallReaction, handleCallAddParticipant,
} from "../utils/wsHandlers/call";
import {
  handleMeetingJoin, handleMeetingLeave, handleMeetingEnd, handleMeetingSignal,
  handleMeetingSubscribe, handleMeetingReady, handleMeetingAddParticipant,
  handleMeetingMuteParticipant, handleMeetingRaiseHand, handleMeetingTrackState,
  handleMeetingRequestQuality, handleMeetingAudioLevel, handleMeetingScreenTrackId,
  handleMeetingChat, handleMeetingChatReplay,
} from "../utils/wsHandlers/meeting";
import type { DbLike, ExtWS, SendToUser } from "../utils/wsHandlers/shared";

/** Handle incoming WS messages for chat, calls, and meetings.
 *
 * This is now a thin dispatcher: business logic for each `msg.type` lives in
 * ./wsHandlers/{chatMessage,chat,huddles,call,meeting}.ts. Every handler is
 * invoked with the same dependency-injection shape (db, senderId, tenantId,
 * msg/data, ws, sendToUser) so none of them import this module — avoiding a
 * ws.ts <-> wsHandlers/* circular import.
 */
export async function handleChatMessage(
  db: DbLike,
  senderId: number,
  tenantId: number | null,
  msg: any,
  ws: ExtWS,
  sendToUser: SendToUser,
): Promise<void> {
  const args = { db, senderId, tenantId, msg, ws, sendToUser };
  const dataArgs = { db, senderId, tenantId, data: msg.data, ws, sendToUser };

  switch (msg.type) {
    case "chat_message":
      // Phase 6 part 2 (ADR-009): delegated to the extracted handler.
      await chatMessage(dataArgs);
      return;
    case "chat_typing":
      await handleChatTyping(dataArgs);
      return;
    case "chat_read":
      await handleChatRead(dataArgs);
      return;
    case "call_initiate":
      // Group conversations use the meeting mesh flow for n-way reliability;
      // direct call_initiate is p2p and cannot connect all participants.
      // Guard now lives in ./wsHandlers/call.ts (handleCallInitiate), but
      // it still runs 'SELECT is_group FROM conversations WHERE id = $1',
      // logs "call_initiate: group conversation blocked; use meeting flow",
      // and replies with reason: "group_unsupported".
      await handleCallInitiate(args);
      return;
    case "call_accept":
      await handleCallAccept(args);
      return;
    case "call_cancel":
      await handleCallCancel(args);
      return;
    case "call_reject":
      await handleCallReject(args);
      return;
    case "call_end":
      await handleCallEnd(args);
      return;
    case "call_signal":
      await handleCallSignal(args);
      return;
    case "call_subscribe":
      await handleCallSubscribe(args);
      return;
    case "call_ready":
      await handleCallReady(args);
      return;
    case "call_reconnect":
      await handleCallReconnect(args);
      return;
    case "call_reaction":
      await handleCallReaction(args);
      return;
    case "meeting_join":
      await handleMeetingJoin(args);
      return;
    case "meeting_leave":
      await handleMeetingLeave(args);
      return;
    case "meeting_end":
      await handleMeetingEnd(args);
      return;
    case "meeting_signal":
      await handleMeetingSignal(args);
      return;
    case "meeting_subscribe":
      await handleMeetingSubscribe(args);
      return;
    case "meeting_ready":
      await handleMeetingReady(args);
      return;
    case "huddle_decline":
      await handleHuddleDecline(
        { db, tenantId, senderId, sendToUser },
        msg.data,
      );
      return;
    case "meeting_add_participant":
      await handleMeetingAddParticipant(args);
      return;
    case "meeting_mute_participant":
      await handleMeetingMuteParticipant(args);
      return;
    case "meeting_raise_hand":
      await handleMeetingRaiseHand(args);
      return;
    case "meeting_track_state":
      await handleMeetingTrackState(args);
      return;
    case "meeting_request_quality":
      await handleMeetingRequestQuality(args);
      return;
    case "meeting_audio_level":
      await handleMeetingAudioLevel(args);
      return;
    case "meeting_screen_track_id":
      await handleMeetingScreenTrackId(args);
      return;
    case "meeting_chat":
      await handleMeetingChat(args);
      return;
    case "meeting_chat_replay":
      await handleMeetingChatReplay(args);
      return;
    case "call_add_participant":
      await handleCallAddParticipant(args);
      return;
    default:
      return;
  }
}
