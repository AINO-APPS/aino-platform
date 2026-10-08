/**
 * Conversation-list persistence (split from chat.repository.ts for the
 * 600-line ratchet). Owns the per-user list query only; no Express.
 *
 * Per-user visibility: `cp.cleared_at` hides every message at or before it
 * from this user's preview and unread count, and `cp.hidden_at` ("Delete
 * chat for me") drops the row until a message newer than it arrives.
 */
export const CONVERSATION_LIST_SQL = `SELECT
        c.id,
        c.updated_at,
        c.name AS group_name,
        c.is_group,
        c.description AS group_description,
        c.avatar AS group_avatar,
        c.post_policy,
        c.add_policy,
        cp.role AS my_role,
        CASE WHEN c.is_group = FALSE THEN COALESCE(u.id, self_u.id) END AS other_user_id,
        CASE WHEN c.is_group = FALSE THEN COALESCE(u.username, self_u.username) END AS other_username,
        CASE WHEN c.is_group = FALSE THEN COALESCE(u.full_name, self_u.full_name) END AS other_full_name,
        CASE WHEN c.is_group = FALSE THEN COALESCE(u.avatar, self_u.avatar) END AS other_avatar,
        CASE WHEN c.is_group = FALSE THEN COALESCE(u.last_seen_at, self_u.last_seen_at) END AS other_last_seen,
        CASE WHEN c.is_group = FALSE AND u.id IS NULL THEN TRUE ELSE FALSE END AS is_self_chat,
        m.content AS last_message, m.sender_id AS last_sender_id, m.sender_name AS last_sender_name,
        m.created_at AS last_message_at, m.file_url AS last_file_url, m.file_type AS last_file_type,
        m.file_name AS last_file_name, m.deleted_at AS last_deleted, m.format_type AS last_format_type,
        m.metadata AS last_metadata,
        (SELECT EXISTS (
            SELECT 1 FROM message_reads mr2 JOIN users ur ON ur.id = mr2.user_id
            WHERE mr2.conversation_id = c.id AND mr2.user_id != $1 AND mr2.last_read_at >= m.created_at
              AND COALESCE((ur.notification_prefs->>'readReceipts')::boolean, TRUE)
        ) AND COALESCE((SELECT (notification_prefs->>'readReceipts')::boolean FROM users WHERE id = $1), TRUE)) AS last_message_read,
        COALESCE(jsonb_array_length(m.delivered_to), 0) > 0 AS last_message_delivered,
        COALESCE(mr.last_read_at, '1970-01-01'::timestamptz) AS last_read_at,
        (SELECT COUNT(*)::int FROM messages msg WHERE msg.conversation_id = c.id
          AND msg.created_at > COALESCE(mr.last_read_at, '1970-01-01'::timestamptz)
          AND msg.created_at > COALESCE(cp.cleared_at, '-infinity'::timestamptz)
          AND msg.sender_id != $1 AND msg.deleted_at IS NULL) AS unread_count,
        CASE WHEN c.is_group THEN (SELECT COUNT(*)::int FROM conversation_participants WHERE conversation_id = c.id) END AS member_count,
        CASE WHEN c.is_group THEN (
            SELECT COALESCE(json_agg(x.avatar) FILTER (WHERE x.avatar IS NOT NULL), '[]'::json)
            FROM (SELECT u3.avatar FROM conversation_participants cp3 JOIN users u3 ON u3.id = cp3.user_id
                  WHERE cp3.conversation_id = c.id ORDER BY cp3.user_id ASC LIMIT 4) x
        ) END AS group_member_avatars,
        CASE WHEN c.is_group THEN (
            SELECT COALESCE(json_agg(json_build_object('name', x.full_name, 'avatar', x.avatar)), '[]'::json)
            FROM (SELECT u4.full_name, u4.avatar FROM conversation_participants cp4 JOIN users u4 ON u4.id = cp4.user_id
                  WHERE cp4.conversation_id = c.id ORDER BY (u4.avatar IS NULL), cp4.user_id ASC LIMIT 4) x
        ) END AS group_member_previews,
        cp.is_pinned, cp.is_favourite,
        (cp.is_muted AND (cp.muted_until IS NULL OR cp.muted_until > NOW())) AS is_muted,
        cp.muted_until, cp.is_archived,
        CASE WHEN c.is_group = FALSE AND u.id IS NOT NULL THEN
            EXISTS (SELECT 1 FROM blocked_users b WHERE b.blocker_id = $1 AND b.blocked_id = u.id)
        ELSE FALSE END AS is_blocked,
        CASE WHEN mtg.id IS NOT NULL THEN TRUE ELSE FALSE END AS is_meeting_chat,
        mtg.meeting_code
    FROM conversations c
    JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.user_id = $1
    LEFT JOIN conversation_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id != $1 AND c.is_group = FALSE
    LEFT JOIN users u ON u.id = cp2.user_id AND c.is_group = FALSE
    LEFT JOIN users self_u ON self_u.id = $1 AND c.is_group = FALSE AND cp2.user_id IS NULL
    LEFT JOIN meetings mtg ON mtg.conversation_id = c.id AND mtg.is_huddle = FALSE
    LEFT JOIN LATERAL (
        SELECT lm.content, lm.sender_id, lm.created_at, lm.file_url, lm.file_type, lm.file_name,
               lm.deleted_at, lm.format_type, lm.metadata, lm.delivered_to, usr.full_name AS sender_name
        FROM messages lm JOIN users usr ON usr.id = lm.sender_id
        WHERE lm.conversation_id = c.id
          AND lm.created_at > COALESCE(cp.cleared_at, '-infinity'::timestamptz)
        ORDER BY lm.created_at DESC LIMIT 1
    ) m ON TRUE
    LEFT JOIN message_reads mr ON mr.conversation_id = c.id AND mr.user_id = $1
    WHERE cp.hidden_at IS NULL OR m.created_at > cp.hidden_at
    ORDER BY cp.is_pinned DESC, COALESCE(m.created_at, c.created_at) DESC
    LIMIT 200`;
