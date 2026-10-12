import { useCallback, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useChatUnread } from "../../ChatContext";
import { markConversationRead } from "../../api/chat";

export default function useVisibleChat(conversationId: number | string | null, unread: number, onRead: (id: number | string) => void) {
    const { setActiveConversationId } = useChatUnread();
    const { pathname } = useLocation();
    const latest = useRef({ pathname, conversationId, unread, onRead });
    latest.current = { pathname, conversationId, unread, onRead };
    const isVisible = useCallback(() => latest.current.pathname === "/chat"
        && document.visibilityState === "visible" && document.hasFocus(), []);
    useEffect(() => {
        setActiveConversationId(conversationId);
        return () => setActiveConversationId(null);
    }, [conversationId, setActiveConversationId]);
    const hasUnread = unread > 0;
    useEffect(() => {
        let alive = true;
        let pending = false;
        const reconcile = () => {
            const id = latest.current.conversationId;
            // Only messages that arrived while hidden need a read; this avoids read fan-out on every focus.
            if (id == null || pending || latest.current.unread <= 0 || !isVisible()) return;
            pending = true;
            void markConversationRead(id).then(() => {
                if (alive && latest.current.conversationId === id && isVisible()) latest.current.onRead(id);
            }).catch((error: unknown) => console.error("Failed to mark restored chat read", error))
                .finally(() => { pending = false; });
        };
        window.addEventListener("focus", reconcile);
        document.addEventListener("visibilitychange", reconcile);
        reconcile();
        return () => {
            alive = false;
            window.removeEventListener("focus", reconcile);
            document.removeEventListener("visibilitychange", reconcile);
        };
    }, [pathname, conversationId, hasUnread, isVisible]);
    return isVisible;
}
