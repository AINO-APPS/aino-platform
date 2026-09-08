export function buildRaiseHandPayload(
  meetingId: number | string,
  raised: boolean,
  clientMsgId: string,
) {
  return { meetingId, raised, clientMsgId };
}

export function buildMuteParticipantPayload(
  meetingId: number | string,
  targetUserId: number | string,
  muted: boolean,
  clientMsgId: string,
) {
  return { meetingId, targetUserId, muted, clientMsgId };
}

export function buildAddParticipantPayload(
  meetingId: number | string,
  targetUserId: number | string,
) {
  return { meetingId, targetUserId };
}
