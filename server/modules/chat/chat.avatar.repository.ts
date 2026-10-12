import { GROUP_MEMBER_PREVIEWS_SQL } from "./chat.conversation-list.repository";
import type { GroupPushAvatarMetadata } from "../../platform/pushNotifications/messageAvatars";

export async function getGroupPushAvatarMetadata(
    db: { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> },
    conversationId: number,
): Promise<GroupPushAvatarMetadata | undefined> {
    const row = (await db.query(
        `SELECT c.avatar AS "groupAvatar", (${GROUP_MEMBER_PREVIEWS_SQL}) AS "groupMemberPreviews"
         FROM conversations c WHERE c.id = $1 AND c.is_group = TRUE`,
        [conversationId],
    )).rows[0];
    return row;
}
