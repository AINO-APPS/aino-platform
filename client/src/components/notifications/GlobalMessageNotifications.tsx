import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { hasTenantContext, useAuth } from "../../AuthContext";
import { useChatUnread } from "../../ChatContext";
import { useNotificationPrefs } from "../../NotificationPrefsContext";
import { useTheme } from "../../ThemeContext";
import { useStatus } from "../../status/useStatus";
import { getConversations, markConversationRead, muteConversation, sendQuickReply } from "../../api/chat";
import { REALTIME_CONNECTED_EVENT, REALTIME_EVENT, type WebSocketMessage } from "../../hooks/useWebSocket";
import { createPendingMessageId } from "../../pages/chat/messageDelivery";
import MessagePopup from "./MessagePopup";
import { canAlert, isConversationMuted, mergeAlert, messagePreview, positiveId, privateAlert, record,
    MESSAGE_ALERT_EVENT, type MessageAlert, type MessageAlertAction } from "./messageAlerts";

export default function GlobalMessageNotifications() {
    const { isAuthenticated, user } = useAuth();
    const { activeConversationId, refreshUnread } = useChatUnread();
    const { prefs, prefsLoaded, playMessageTone, playMentionTone } = useNotificationPrefs();
    const { effective } = useStatus();
    const { theme } = useTheme();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [alerts, setAlerts] = useState<MessageAlert[]>([]);
    const session = useRef("");
    const alertsRef = useRef(alerts);
    const conversations = useRef(new Map<string, Record<string, unknown>>());
    const seen = useRef(new Set<string>());
    const browserAlerts = useRef(new Map<string, Notification>());
    const lastTone = useRef(0);
    const waiting = useRef(new Map<string, WebSocketMessage>());
    const ready = isAuthenticated && hasTenantContext(user);
    const account = ready ? `${user?.tenant_id ?? ""}:${user?.id}` : "";
    const latest = useRef({ prefs, prefsLoaded, effective, pathname, activeConversationId, userId: user?.id, navigate, refreshUnread, playMessageTone, playMentionTone });
    latest.current = { prefs, prefsLoaded, effective, pathname, activeConversationId, userId: user?.id, navigate, refreshUnread, playMessageTone, playMentionTone };
    const replace = useCallback((update: (current: MessageAlert[]) => MessageAlert[]) => {
        alertsRef.current = update(alertsRef.current);
        setAlerts(alertsRef.current);
    }, []);
    const reload = useCallback(async () => {
        const generation = session.current;
        const { data } = await getConversations();
        if (session.current !== generation) return;
        if (!Array.isArray(data)) throw new Error("Invalid conversation list");
        conversations.current = new Map(data.flatMap((value: unknown) => {
            const conversation = record(value);
            const id = positiveId(conversation?.id);
            return conversation && id ? [[id, conversation] as const] : [];
        }));
        const muted = new Set([...conversations.current].filter(([, conversation]) => isConversationMuted(conversation)).map(([id]) => id));
        replace((current) => current.filter((card) => !muted.has(card.conversationId)));
        muted.forEach((id) => { browserAlerts.current.get(id)?.close(); browserAlerts.current.delete(id); });
    }, [replace]);
    const closeBrowser = useCallback((id?: string) => {
        if (id) { browserAlerts.current.get(id)?.close(); browserAlerts.current.delete(id); }
        else { browserAlerts.current.forEach((notification) => notification.close()); browserAlerts.current.clear(); }
    }, []);

    const handleAction = useCallback(async (action: MessageAlertAction) => {
        if (action.session !== session.current) return;
        const card = alertsRef.current.find((item) => item.conversationId === action.conversationId);
        // A newer message may have replaced the card; the action applies to the message the user saw.
        if (!card || card.busy || !positiveId(action.messageId) || Number(action.messageId) > Number(card.messageId)) return;
        const update = (partial: Partial<MessageAlert>) => replace((current) => current.map((item) =>
            item.conversationId === card.conversationId ? { ...item, ...partial } : item));
        const dismissSnapshot = () => {
            replace((current) => current.filter((item) => item.conversationId !== card.conversationId
                || Number(item.messageId) > Number(action.messageId)));
            closeBrowser(card.conversationId);
        };
        if (action.action === "expand") { update({ replyOpen: true }); return; }
        if (action.action === "dismiss") { dismissSnapshot(); return; }
        if (action.action === "open") {
            window.electronAPI?.showAndFocus();
            window.focus();
            latest.current.navigate(`/chat?conv=${card.conversationId}`);
            window.dispatchEvent(new Event(MESSAGE_ALERT_EVENT));
            replace((current) => current.filter((item) => item.conversationId !== card.conversationId));
            closeBrowser(card.conversationId);
            return;
        }
        const text = (action.text ?? "").trim();
        if (action.action === "reply" && (!text || text.length > 5000)) {
            update({ error: "Enter a reply of 1 to 5,000 characters.", replyOpen: true }); return;
        }
        // Retrying the same text reuses its idempotency key; edited text is a new message.
        const draftId = action.action === "reply" && card.replyText !== text ? createPendingMessageId() : card.draftId;
        const generation = session.current;
        update({ busy: true, error: "", ...(action.action === "reply" ? { replyText: text, draftId } : {}) });
        try {
            if (action.action === "reply") {
                const response = await sendQuickReply(card.conversationId, text, draftId);
                if (!positiveId(response.data.id)) throw new Error("The message was not confirmed by the server.");
            } else if (action.action === "read") {
                await markConversationRead(card.conversationId, action.messageId);
            } else if (action.action === "mute") {
                await muteConversation(card.conversationId, action.duration ?? "1h");
                if (session.current === generation) conversations.current.set(card.conversationId, {
                    ...conversations.current.get(card.conversationId), is_muted: true,
                    muted_until: action.duration === "always" ? null : new Date(Date.now() + 3_600_000).toISOString(),
                });
            }
            if (session.current !== generation) return;
            update({ busy: false, replyText: "", draftId: createPendingMessageId(), replyOpen: false, error: "" });
            if (action.action === "mute") {
                replace((current) => current.filter((item) => item.conversationId !== card.conversationId));
                closeBrowser(card.conversationId);
            } else dismissSnapshot();
            window.dispatchEvent(new Event(MESSAGE_ALERT_EVENT));
            void latest.current.refreshUnread();
        } catch (error: unknown) {
            if (session.current !== generation) return;
            console.error(`Message notification ${action.action} failed`, error);
            const data = record(record(record(error)?.response)?.data);
            update({ busy: false, error: typeof data?.error === "string" ? data.error.slice(0, 500)
                : "Could not complete this action. Check your connection and try again." });
        }
    }, [replace, closeBrowser]);

    useEffect(() => {
        session.current = account ? `${account}:${crypto.randomUUID()}` : "";
        replace(() => []);
        conversations.current.clear();
        seen.current.clear();
        waiting.current.clear();
        lastTone.current = 0;
        closeBrowser();
        window.electronAPI?.messageAlerts?.clear();
        if (!account) return;
        const generation = session.current;
        let tone: { id: string; mention: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
        // Wait briefly so a following mention event upgrades the tone instead of playing twice.
        const queueTone = (id: string, mention: boolean) => {
            if (tone?.id === id) { tone.mention ||= mention; return; }
            if (tone || Date.now() - lastTone.current < 1500) return;
            tone = { id, mention, timer: setTimeout(() => {
                const pending = tone;
                tone = null;
                if (!pending || generation !== session.current) return;
                lastTone.current = Date.now();
                if (pending.mention) latest.current.playMentionTone(); else latest.current.playMessageTone();
            }, 150) };
        };
        let loading: Promise<void> | null = null;
        const refresh = () => {
            loading ??= reload().catch((error: unknown) => console.error("Message notification metadata could not be loaded", error))
                .finally(() => { loading = null; });
            return loading;
        };
        void refresh();
        const onMessage = async (event: Event) => {
            const message = (event as CustomEvent<WebSocketMessage>).detail;
            if (!message) return;
            if (["chat_conv_deleted", "chat_cleared"].includes(message.type)) {
                const id = positiveId(record(message.data)?.conversationId);
                if (id) { replace((current) => current.filter((card) => card.conversationId !== id)); closeBrowser(id); }
                void refresh(); return;
            }
            if (!["chat_message", "chat_mention"].includes(message.type)) return;
            const data = record(message.data);
            const id = positiveId(data?.id ?? data?.messageId);
            const conversationId = positiveId(data?.conversationId);
            const senderId = positiveId(data?.senderId);
            if (!data || !id || !conversationId || !senderId) {
                console.warn("Ignored malformed message notification event"); return;
            }
            if (!latest.current.prefsLoaded) {
                waiting.current.set(conversationId, message);
                return;
            }
            const systemType = record(data.metadata)?.type;
            if (["group_info_updated", "group_renamed", "member_added", "member_removed", "member_left", "role_changed", "owner_transferred", "call"].includes(String(systemType))) {
                void refresh(); return;
            }
            if (senderId === String(latest.current.userId)) return;
            if (!conversations.current.has(conversationId)) await refresh();
            if (generation !== session.current) return;
            const current = latest.current;
            const conversation = conversations.current.get(conversationId);
            if (!conversation) { console.warn("Message alert skipped because conversation metadata is unavailable"); return; }
            const focusedChat = current.pathname === "/chat" && String(current.activeConversationId) === conversationId
                && document.visibilityState === "visible" && document.hasFocus();
            if (!canAlert({ own: senderId === String(current.userId), focusedChat,
                muted: isConversationMuted(conversation), dnd: current.effective === "dnd", enabled: true })) return;
            // The server sends chat_mention right after chat_message for the same message.
            const mention = message.type === "chat_mention";
            if (seen.current.has(id)) { if (mention) queueTone(id, true); return; }
            seen.current.add(id);
            if (seen.current.size > 1000) seen.current.delete(seen.current.values().next().value!);
            queueTone(id, mention);
            if (!current.prefs.messagePopups) return;
            const sender = String(data.senderName || "Someone").slice(0, 120);
            const isGroup = conversation.is_group === true;
            const title = isGroup ? String(conversation.group_name || "Group") : sender;
            const avatar = isGroup ? conversation.group_avatar : data.senderAvatar ?? conversation.other_avatar;
            const members = Array.isArray(conversation.group_member_previews) ? conversation.group_member_previews.flatMap((value: unknown) => {
                const member = record(value);
                return member ? [{ name: typeof member.name === "string" ? member.name.slice(0, 120) : null,
                    avatar: typeof member.avatar === "string" ? member.avatar : null }] : [];
            }).slice(0, 4) : [];
            const card: MessageAlert = { conversationId, messageId: id, title: title.slice(0, 120), sender,
                isGroup, avatar: typeof avatar === "string" ? avatar : null, members, preview: messagePreview(data),
                count: 1, updatedAt: Date.now(), replyText: "", draftId: createPendingMessageId(), replyOpen: false, busy: false, error: "" };
            replace((pending) => mergeAlert(pending, card));
            if (!window.electronAPI?.messageAlerts && typeof Notification !== "undefined"
                && Notification.permission === "granted" && (!document.hasFocus() || document.visibilityState !== "visible")) {
                const visible = current.prefs.hideSensitiveContent ? privateAlert(card) : card;
                try {
                    closeBrowser(conversationId);
                    const notification = new Notification(visible.title, { body: visible.preview, icon: visible.avatar || "/icon-192.png",
                        tag: `aino-chat-${conversationId}`, silent: true });
                    notification.onclick = () => { void handleAction({ session: generation, conversationId, messageId: id, action: "open" }); };
                    browserAlerts.current.set(conversationId, notification);
                } catch (error) { console.error("Browser message notification unavailable", error); }
            }
        };
        const onRefresh = () => { void refresh(); };
        const onPreferences = () => {
            if (!latest.current.prefsLoaded) return;
            const pending = [...waiting.current.values()];
            waiting.current.clear();
            pending.forEach((message) => { void onMessage(new CustomEvent(REALTIME_EVENT, { detail: message })); });
        };
        const onFocus = () => {
            const current = latest.current;
            if (current.pathname === "/chat" && document.hasFocus() && document.visibilityState === "visible") {
                const id = String(current.activeConversationId);
                replace((pending) => pending.filter((card) => card.conversationId !== id));
                closeBrowser(id);
            }
        };
        window.addEventListener(REALTIME_EVENT, onMessage);
        window.addEventListener(REALTIME_CONNECTED_EVENT, onRefresh);
        window.addEventListener(MESSAGE_ALERT_EVENT, onRefresh);
        window.addEventListener("aino-notification-prefs-ready", onPreferences);
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onFocus);
        const offAction = window.electronAPI?.messageAlerts?.onAction((action) => { void handleAction(action); });
        return () => {
            session.current = "";
            if (tone) clearTimeout(tone.timer);
            window.removeEventListener(REALTIME_EVENT, onMessage);
            window.removeEventListener(REALTIME_CONNECTED_EVENT, onRefresh);
            window.removeEventListener(MESSAGE_ALERT_EVENT, onRefresh);
            window.removeEventListener("aino-notification-prefs-ready", onPreferences);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onFocus);
            offAction?.();
            closeBrowser();
            window.electronAPI?.messageAlerts?.clear();
        };
    }, [account, reload, replace, closeBrowser, handleAction]);

    useEffect(() => {
        if (!prefs.messagePopups || effective === "dnd") { replace(() => []); closeBrowser(); }
        else if (pathname === "/chat" && document.hasFocus() && document.visibilityState === "visible") {
            replace((current) => current.filter((card) => card.conversationId !== String(activeConversationId)));
            closeBrowser(String(activeConversationId));
        }
    }, [prefs.messagePopups, effective, pathname, activeConversationId, replace, closeBrowser]);
    useEffect(() => { if (prefs.hideSensitiveContent) closeBrowser(); }, [prefs.hideSensitiveContent, closeBrowser]);
    useEffect(() => {
        if (prefsLoaded) window.dispatchEvent(new Event("aino-notification-prefs-ready"));
    }, [prefsLoaded]);
    const act = useCallback((action: MessageAlertAction["action"], card: MessageAlert, text?: string, duration?: "1h" | "always") => {
        void handleAction({ session: session.current, conversationId: card.conversationId, messageId: card.messageId, action, text, duration });
    }, [handleAction]);
    const visible = prefs.hideSensitiveContent ? alerts.map(privateAlert) : alerts;
    useEffect(() => {
        if (!window.electronAPI?.messageAlerts || !session.current) return;
        window.electronAPI.messageAlerts.publish({ session: session.current, cards: visible.slice(0, 3),
            dark: theme === "dark", primary: getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#2383e2" });
    }, [alerts, prefs.hideSensitiveContent, theme]);
    return ready && !window.electronAPI?.messageAlerts ? <MessagePopup cards={visible} act={act} /> : null;
}
