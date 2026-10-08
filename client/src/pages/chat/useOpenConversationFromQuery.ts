import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Opens the conversation named by `/chat?conv=<id>` once the list has loaded
 * (used after joining a group through an invite link), then drops the query
 * so a refresh or Back does not re-open it.
 */
export function useOpenConversationFromQuery(
    conversations: any[],
    openConversation: (id: number, meta: Record<string, unknown>) => void,
): void {
    const { search, pathname } = useLocation();
    const navigate = useNavigate();
    const handled = useRef<number | null>(null);
    const wanted = Number(new URLSearchParams(search).get("conv")) || null;

    useEffect(() => {
        if (!wanted || handled.current === wanted) return;
        const conv = conversations.find((c: any) => Number(c.id) === wanted);
        if (!conv) return;
        handled.current = wanted;
        openConversation(wanted, {
            other_user_id: conv.other_user_id,
            other_username: conv.other_username,
            other_full_name: conv.other_full_name,
            other_avatar: conv.other_avatar,
            is_group: conv.is_group,
            is_self_chat: conv.is_self_chat,
            group_name: conv.group_name,
            name: conv.name,
            member_count: conv.member_count,
        });
        navigate(pathname, { replace: true });
    }, [wanted, conversations, openConversation, navigate, pathname]);
}
