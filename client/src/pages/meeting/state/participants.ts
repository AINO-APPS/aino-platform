import type { AnyRecord } from "../../../types";

export type MeetingParticipant = AnyRecord & { userId: number | string };

export function addParticipantToMap(
  participants: Map<number | string, MeetingParticipant>,
  participant: MeetingParticipant,
): Map<number | string, MeetingParticipant> {
  const next = new Map(participants);
  next.set(participant.userId, participant);
  return next;
}

export function removeParticipantFromMap(
  participants: Map<number | string, MeetingParticipant>,
  userId: number | string,
): Map<number | string, MeetingParticipant> {
  const next = new Map(participants);
  next.delete(userId);
  return next;
}
