import type { QueryFn } from "../types/domain";
import { sendToUser } from "../realtime/fanout";
import { logger } from "../utils/logger";

export async function broadcastProfileUpdate(
    query: QueryFn,
    tenantId: number | null | undefined,
    userId: number,
    avatar: string | null,
): Promise<void> {
    try {
        const recipients = await query(
            `SELECT DISTINCT peer.user_id
               FROM conversation_participants mine
               JOIN conversation_participants peer ON peer.conversation_id = mine.conversation_id
              WHERE mine.user_id = $1`,
            [userId],
        );
        for (const recipient of recipients.rows) {
            sendToUser(tenantId, recipient.user_id, "user_profile_updated", { userId, avatar });
        }
    } catch (err) {
        logger.warn({ err, tenantId, userId }, "Profile realtime broadcast failed");
    }
}