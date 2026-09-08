import type { AnyRecord } from "../../types";

export type RealtimeChatMessage = AnyRecord & {
    id: number | string;
};

export type RealtimeConversation = AnyRecord & { id: number | string };

export function applyRealtimeConversationMessage(
    conversation: RealtimeConversation,
    data: AnyRecord,
    currentUserId: unknown,
    isActive: boolean,
): RealtimeConversation {
    const fromPeer = Number(data.senderId) !== Number(currentUserId);
    return {
        ...conversation,
        last_message: data.content || (data.fileName ? `📎 ${data.fileName}` : "🎤 Voice"),
        last_sender_id: data.senderId,
        last_message_at: data.createdAt,
        last_deleted: null,
        last_message_read: false,
        last_message_delivered: false,
        unread_count: isActive ? 0 : (Number(conversation.unread_count) || 0) + (fromPeer ? 1 : 0),
        ...(fromPeer && !conversation.is_group ? { other_avatar: data.senderAvatar || null } : {}),
    };
}

export function applyRealtimeProfileUpdate(
    conversation: RealtimeConversation,
    data: AnyRecord,
): RealtimeConversation {
    return !conversation.is_group && Number(conversation.other_user_id) === Number(data.userId)
        ? { ...conversation, other_avatar: data.avatar || null }
        : conversation;
}

export function mapRealtimeMessage(data: AnyRecord): RealtimeChatMessage {
    return {
        id: data.id as number | string,
        sender_id: data.senderId,
        sender_name: data.senderName,
        sender_avatar: data.senderAvatar,
        content: data.content,
        created_at: data.createdAt,
        reply_to_id: data.replyToId || null,
        reply_sender_name: data.replySenderName,
        reply_content: data.replyContent,
        file_url: data.fileUrl,
        file_name: data.fileName,
        file_type: data.fileType,
        file_size: data.fileSize,
        forwarded_from_id: data.forwardedFromId,
        format_type: data.formatType || "text",
        metadata: data.metadata || null,
        link_preview: data.linkPreview || null,
        media_job_id: data.mediaJobId || null,
        media_state: data.mediaState || null,
        media_progress:
            typeof data.mediaProgress === "number"
                ? data.mediaProgress
                : null,
        media_failure_reason: data.failureReason || null,
        _mediaState: data.mediaState || null,
        _mediaProgress:
            typeof data.mediaProgress === "number"
                ? data.mediaProgress
                : null,
        delivered_to: [],
        reactions: [],
    };
}

export function applyRealtimeMediaJob(
    message: RealtimeChatMessage,
    data: AnyRecord,
): RealtimeChatMessage {
    return {
        ...message,
        media_job_id: data.mediaJobId || message.media_job_id,
        media_state: data.status || message.media_state,
        media_progress:
            typeof data.progress === "number"
                ? data.progress
                : message.media_progress,
        media_failure_reason: data.failureReason || null,
        _mediaState: data.status || message._mediaState,
        _mediaProgress:
            typeof data.progress === "number"
                ? data.progress
                : message._mediaProgress,
        _failureReason: data.failureReason || message._failureReason,
    };
}

export function applyRealtimeReaction(
    message: RealtimeChatMessage,
    data: AnyRecord,
): RealtimeChatMessage {
    if (message.deleted_at) return { ...message, reactions: [] };

    const reactions = [
        ...((message.reactions as AnyRecord[] | undefined) || []),
    ];
    if (data.action === "added") {
        if (
            reactions.some(
                (reaction) =>
                    reaction.userId === data.userId &&
                    reaction.emoji === data.emoji,
            )
        ) {
            return message;
        }
        return {
            ...message,
            reactions: [
                ...reactions,
                {
                    userId: data.userId,
                    fullName: data.fullName,
                    emoji: data.emoji,
                },
            ],
        };
    }

    return {
        ...message,
        reactions: reactions.filter(
            (reaction) =>
                !(
                    reaction.userId === data.userId &&
                    reaction.emoji === data.emoji
                ),
        ),
    };
}

export function applyRealtimeEdit(
    message: RealtimeChatMessage,
    data: AnyRecord,
): RealtimeChatMessage {
    return {
        ...message,
        content: data.content,
        edited_at: data.editedAt,
    };
}

export function applyRealtimeDelete(
    message: RealtimeChatMessage,
): RealtimeChatMessage {
    return {
        ...message,
        deleted_at: new Date().toISOString(),
        content: "",
        file_url: null,
        file_name: null,
        file_type: null,
        file_size: null,
        reactions: [],
    };
}

export function applyRealtimePin(
    message: RealtimeChatMessage,
    data: AnyRecord,
): RealtimeChatMessage {
    return {
        ...message,
        pinned_at: data.pinned ? new Date().toISOString() : null,
        pinned_by: data.pinned ? data.pinnedBy : null,
    };
}

export function updateRealtimeMessage(
    messages: RealtimeChatMessage[],
    messageId: number | string,
    update: (message: RealtimeChatMessage) => RealtimeChatMessage,
): RealtimeChatMessage[] {
    return messages.map((message) =>
        String(message.id) === String(messageId)
            ? update(message)
            : message,
    );
}