/**
 * Group invite-link, join-request, group-avatar and active-group-call
 * persistence. SQL only; no Express.
 */
import type { ChatDb } from "./chat.types";

export interface InviteGroupRow {
    id: number;
    name: string | null;
    description: string | null;
    avatar: string | null;
    org_id: number;
    invite_enabled: boolean;
    invite_requires_approval: boolean;
    invite_token: string | null;
}

const GROUP_COLUMNS =
    "id, name, description, avatar, org_id, invite_enabled, invite_requires_approval, invite_token";

export async function getGroupById(db: ChatDb, conversationId: number): Promise<InviteGroupRow | undefined> {
    return (await db.query(`SELECT ${GROUP_COLUMNS} FROM conversations WHERE id = $1 AND is_group = TRUE`, [conversationId])).rows[0];
}

export async function getGroupByToken(db: ChatDb, token: string): Promise<InviteGroupRow | undefined> {
    return (await db.query(`SELECT ${GROUP_COLUMNS} FROM conversations WHERE invite_token = $1 AND is_group = TRUE`, [token])).rows[0];
}

export async function updateInviteSettings(
    db: ChatDb,
    conversationId: number,
    enabled: boolean,
    requiresApproval: boolean,
    token: string | null,
): Promise<void> {
    await db.query(
        `UPDATE conversations SET invite_enabled = $1, invite_requires_approval = $2,
                invite_token = COALESCE($3, invite_token)
          WHERE id = $4`,
        [enabled, requiresApproval, token, conversationId],
    );
}

export async function setInviteToken(db: ChatDb, conversationId: number, token: string): Promise<void> {
    await db.query("UPDATE conversations SET invite_token = $1 WHERE id = $2", [token, conversationId]);
}

export async function getActiveUserInOrg(db: ChatDb, userId: number, orgId: number) {
    return (await db.query(
        "SELECT id, full_name, avatar FROM users WHERE id = $1 AND org_id = $2 AND is_active = TRUE",
        [userId, orgId],
    )).rows[0] as { id: number; full_name: string | null; avatar: string | null } | undefined;
}

export async function getParticipantRole(db: ChatDb, conversationId: number, userId: number): Promise<string | null> {
    const row = (await db.query(
        "SELECT role FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId],
    )).rows[0];
    return row ? row.role || "member" : null;
}

export async function getMemberSummary(db: ChatDb, conversationId: number) {
    const row = (await db.query(
        `SELECT COUNT(*)::int AS member_count,
                COALESCE((SELECT json_agg(x.avatar) FROM (
                    SELECT u.avatar FROM conversation_participants cp JOIN users u ON u.id = cp.user_id
                     WHERE cp.conversation_id = $1 AND u.avatar IS NOT NULL
                     ORDER BY cp.user_id ASC LIMIT 4) x), '[]'::json) AS member_avatars
           FROM conversation_participants WHERE conversation_id = $1`,
        [conversationId],
    )).rows[0];
    return { memberCount: Number(row?.member_count ?? 0), memberAvatars: (row?.member_avatars ?? []) as string[] };
}

/** Returns true when a new participant row was inserted. */
export async function addParticipant(db: ChatDb, conversationId: number, userId: number): Promise<boolean> {
    const result = await db.query(
        "INSERT INTO conversation_participants (conversation_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
        [conversationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
}

export async function hasJoinRequest(db: ChatDb, conversationId: number, userId: number): Promise<boolean> {
    return (await db.query(
        "SELECT 1 FROM conversation_join_requests WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId],
    )).rows.length > 0;
}

export async function insertJoinRequest(db: ChatDb, conversationId: number, userId: number): Promise<boolean> {
    const result = await db.query(
        "INSERT INTO conversation_join_requests (conversation_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [conversationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
}

/** Returns true when a pending request existed and was removed. */
export async function deleteJoinRequest(db: ChatDb, conversationId: number, userId: number): Promise<boolean> {
    const result = await db.query(
        "DELETE FROM conversation_join_requests WHERE conversation_id = $1 AND user_id = $2",
        [conversationId, userId],
    );
    return (result.rowCount ?? 0) > 0;
}

export async function countJoinRequests(db: ChatDb, conversationId: number): Promise<number> {
    const row = (await db.query(
        "SELECT COUNT(*)::int AS c FROM conversation_join_requests WHERE conversation_id = $1",
        [conversationId],
    )).rows[0];
    return Number(row?.c ?? 0);
}

export async function listJoinRequests(db: ChatDb, conversationId: number) {
    return (await db.query(
        `SELECT u.id, u.username, u.full_name, u.avatar, r.created_at
           FROM conversation_join_requests r JOIN users u ON u.id = r.user_id
          WHERE r.conversation_id = $1
          ORDER BY r.created_at ASC`,
        [conversationId],
    )).rows;
}

export async function listGroupAdminIds(db: ChatDb, conversationId: number): Promise<number[]> {
    return (await db.query(
        "SELECT user_id FROM conversation_participants WHERE conversation_id = $1 AND role IN ('owner', 'admin')",
        [conversationId],
    )).rows.map((r: { user_id: number }) => r.user_id);
}

export async function getUserName(db: ChatDb, userId: number): Promise<string | null> {
    return (await db.query("SELECT full_name FROM users WHERE id = $1", [userId])).rows[0]?.full_name ?? null;
}

/** Sets the group photo and returns the previous one so its object can be removed. */
export async function replaceGroupAvatar(db: ChatDb, conversationId: number, avatar: string | null): Promise<string | null> {
    const previous = (await db.query("SELECT avatar FROM conversations WHERE id = $1", [conversationId])).rows[0]?.avatar ?? null;
    await db.query("UPDATE conversations SET avatar = $1 WHERE id = $2", [avatar, conversationId]);
    return previous;
}

/** The newest huddle in the conversation that still has someone joined. */
export async function getActiveGroupCall(db: ChatDb, conversationId: number) {
    const meeting = (await db.query(
        `SELECT m.id, m.meeting_code, m.settings, m.created_by, m.started_at
           FROM meetings m
          WHERE m.conversation_id = $1 AND m.is_huddle = TRUE AND m.status = 'active'
            AND EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.status = 'joined')
          ORDER BY m.started_at DESC NULLS LAST, m.id DESC
          LIMIT 1`,
        [conversationId],
    )).rows[0];
    if (!meeting) return null;
    const participants = (await db.query(
        `SELECT u.id, u.full_name, u.avatar
           FROM meeting_participants mp JOIN users u ON u.id = mp.user_id
          WHERE mp.meeting_id = $1 AND mp.status = 'joined'
          ORDER BY mp.joined_at ASC NULLS LAST`,
        [meeting.id],
    )).rows;
    return { meeting, participants };
}
