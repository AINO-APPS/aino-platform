import {
    createContext,
    useContext,
    useState,
    useEffect,
    useCallback,
    useMemo,
    type ReactNode,
} from "react";
import { getConversations } from "./api/chat";
import { hasTenantContext, useAuth } from "./AuthContext";
import type { Conversation } from "./types";
import { REALTIME_EVENT, type WebSocketMessage } from "./hooks/useWebSocket";

type UnreadConversation = {
    [key: string]: unknown;
    unread_count?: unknown;
};

interface ChatContextValue {
    unreadCount: number;
    refreshUnread: () => Promise<void> | void;
    updateUnreadFromConversations: (
        conversations: UnreadConversation[],
    ) => void;
}

const ChatCtx = createContext<ChatContextValue>({
    unreadCount: 0,
    refreshUnread: () => {},
    updateUnreadFromConversations: () => {},
});

export function ChatProvider({ children }: { children: ReactNode }) {
    const { isAuthenticated, user } = useAuth();
    const tenantReady = isAuthenticated && hasTenantContext(user);
    const [unreadCount, setUnreadCount] = useState(0);

    const updateUnreadFromConversations = useCallback(
        (conversations: UnreadConversation[]) => {
            setUnreadCount(
                conversations.reduce(
                    (sum, conversation) =>
                        sum + (Number(conversation.unread_count) || 0),
                    0,
                ),
            );
        },
        [],
    );

    const refreshUnread = useCallback(async () => {
        if (!tenantReady) {
            setUnreadCount(0);
            return;
        }
        try {
            const { data } = await getConversations();
            updateUnreadFromConversations(
                ((data as Conversation[]) || []),
            );
        } catch {
            /* ignore */
        }
    }, [tenantReady, updateUnreadFromConversations]);

    useEffect(() => {
        refreshUnread();
    }, [refreshUnread]);

    useEffect(() => {
        if (!tenantReady) return;
        let refreshTimer: ReturnType<typeof setTimeout> | null = null;
        const onRealtime = (event: Event) => {
            const message = (event as CustomEvent<WebSocketMessage>).detail;
            if (message?.type !== "chat_message") return;
            if (refreshTimer) clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => void refreshUnread(), 50);
        };
        window.addEventListener(REALTIME_EVENT, onRealtime);
        return () => {
            window.removeEventListener(REALTIME_EVENT, onRealtime);
            if (refreshTimer) clearTimeout(refreshTimer);
        };
    }, [tenantReady, refreshUnread]);

    // Mirror the unread total onto the desktop taskbar/dock badge (Electron)
    // and the PWA app badge so the OS shows e.g. "3" without the window open.
    // Cleared to 0 automatically when everything is read.
    useEffect(() => {
        const total = Math.max(0, unreadCount);
        try {
            (window as any).electronAPI?.setBadgeCount?.(total);
        } catch {
            /* ignore — non-Electron or older preload */
        }
        try {
            if (typeof (navigator as any).setAppBadge === "function") {
                if (total > 0) (navigator as any).setAppBadge(total);
                else (navigator as any).clearAppBadge?.();
            }
        } catch {
            /* ignore — Badging API unsupported */
        }
    }, [unreadCount]);

    const value = useMemo(
        () => ({
            unreadCount,
            refreshUnread,
            updateUnreadFromConversations,
        }),
        [unreadCount, refreshUnread, updateUnreadFromConversations],
    );

    return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}

export const useChatUnread = () => useContext(ChatCtx);