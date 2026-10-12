import type { MessageAlert, MessageAlertAction } from "../../../../desktop/ipc-types";

export type { MessageAlert, MessageAlertAction };
export const MESSAGE_ALERT_EVENT = "aino-message-alert-refresh";

export function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? value as Record<string, unknown> : null;
}

export function positiveId(value: unknown): string | null {
    const text = typeof value === "number" || typeof value === "string" ? String(value) : "";
    return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null;
}

export function messagePreview(data: Record<string, unknown>): string {
    if (data.formatType === "poll") return "Sent a poll";
    if (data.fileType || data.fileName || data.fileUrl) {
        const type = String(data.fileType || "");
        return type.startsWith("image/") ? "Sent a photo" : type.startsWith("video/") ? "Sent a video"
            : type.startsWith("audio/") ? "Sent an audio message" : "Sent a file";
    }
    return String(data.content || "New message").replace(/<[^>]*>/g, "").slice(0, 200);
}

export function isConversationMuted(conversation: Record<string, unknown>, now = Date.now()): boolean {
    if (!conversation.is_muted) return false;
    return !conversation.muted_until || new Date(String(conversation.muted_until)).getTime() > now;
}

export function canAlert(options: {
    own: boolean; focusedChat: boolean; muted: boolean; dnd: boolean; enabled: boolean;
}): boolean {
    return !options.own && !options.focusedChat && !options.muted && !options.dnd && options.enabled;
}

export function mergeAlert(alerts: MessageAlert[], next: MessageAlert): MessageAlert[] {
    const old = alerts.find((alert) => alert.conversationId === next.conversationId);
    if (old?.messageId === next.messageId) return alerts;
    const merged = old ? { ...next, count: old.count + 1, replyText: old.replyText, draftId: old.draftId,
        replyOpen: old.replyOpen, busy: old.busy, error: old.error } : next;
    return old ? alerts.map((alert) => alert === old ? merged : alert) : [...alerts, merged];
}

export function privateAlert(alert: MessageAlert): MessageAlert {
    return { ...alert, title: "New message", sender: "", preview: "Open chat to view this message",
        avatar: null, members: [], isGroup: false };
}
