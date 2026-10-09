/**
 * Meetings, group calls and huddles run as a full WebRTC mesh: every member
 * sends their audio/video to every other member, so upload bandwidth and CPU
 * grow with the room. Phones degrade quickly above this many people, so it is
 * a hard cap on members joined at the same time (invites are not limited).
 * Raise it only together with an SFU. Web and Android show "n / cap".
 */
export const MESH_PARTICIPANT_CAP = 8;

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
type SendToUser = (tenantId: number | null | undefined, userId: number, type: string, data: unknown) => void;

/** True when [joinedOthers] members (excluding the joiner) already fill the room. */
export function meetingIsFull(joinedOthers: number, cap = MESH_PARTICIPANT_CAP): boolean {
  return joinedOthers >= cap;
}

/**
 * `meeting_join` gate: refuses a new member when the room is full and tells
 * only them (`meeting_full`). Returns true when the join may continue.
 */
export async function admitToMeeting(params: {
  db: { query: Query };
  tenantId: number | null;
  meetingId: unknown;
  userId: number;
  sendToUser: SendToUser;
}): Promise<boolean> {
  const { db, tenantId, meetingId, userId, sendToUser } = params;
  const row = (
    await db.query(
      `SELECT COUNT(*)::int AS cnt FROM meeting_participants WHERE meeting_id = $1 AND status = 'joined' AND user_id != $2`,
      [meetingId, userId],
    )
  ).rows[0];
  const participantCount = Number(row?.cnt ?? 0);
  if (!meetingIsFull(participantCount)) return true;
  sendToUser(tenantId, userId, "meeting_full", { meetingId, cap: MESH_PARTICIPANT_CAP, participantCount });
  return false;
}
