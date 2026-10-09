import { useState } from "react";
import { createConversation } from "../../api/chat";
import { hideMessagesForMe } from "./chatLocalDeletes";
import type { MuteDuration } from "../../components/chat/signal/SignalMenu";

/**
 * Glue for the Android-parity chat surfaces (group settings page, delete-for-me,
 * list-row calls/settings, header leave/delete) so Chat.tsx stays a thin layout.
 */
export default function useChatPageExtras(state: any, actions: any) {
    const { activeConv, setActiveConv, setMessages, setConversations, setShowInfo, openConversation, loadConversations, user } = state;
    // Keyed to a conversation id so switching chats never carries the panel over.
    const [groupSettingsId, setGroupSettingsId] = useState<number | string | null>(null);
    const groupSettingsOpen = groupSettingsId != null && String(groupSettingsId) === String(activeConv?.id);
    const setGroupSettingsOpen = (open: boolean) => setGroupSettingsId(open && activeConv ? activeConv.id : null);
    const [deleteMsg, setDeleteMsg] = useState<any>(null);
    const [leaveConfirm, setLeaveConfirm] = useState(false);
    const [pendingCall, setPendingCall] = useState<"voice" | "video" | null>(null);

    const openConvMeta = (c: any) =>
        openConversation(c.id, {
            other_user_id: c.other_user_id,
            other_username: c.other_username,
            other_full_name: c.other_full_name,
            other_avatar: c.other_avatar,
            is_group: c.is_group,
            is_self_chat: c.is_self_chat,
            group_name: c.group_name,
            group_avatar: c.group_avatar,
            group_member_previews: c.group_member_previews,
            group_member_avatars: c.group_member_avatars,
            name: c.name,
            member_count: c.member_count,
        });

    /** Settings for the open conversation: group page for groups, chat-info page otherwise. */
    const openSettings = () => {
        if (activeConv?.is_group) setGroupSettingsOpen(true);
        else setShowInfo(true);
    };

    /** From a chat-list row: open the conversation, then its settings. */
    const openSettingsFor = async (c: any) => {
        if (activeConv?.id !== c.id) await openConvMeta(c);
        if (c.is_group) setGroupSettingsId(c.id);
        else setShowInfo(true);
    };

    /** From a chat-list row: open the conversation, then place the call once it is active. */
    const callFrom = async (c: any, type: "voice" | "video") => {
        if (activeConv?.id === c.id) {
            (type === "video" ? actions.handleVideoCall : actions.handleVoiceCall)();
            return;
        }
        await openConvMeta(c);
        setPendingCall(type);
    };
    const consumePendingCall = () => {
        if (!pendingCall || !activeConv) return;
        const t = pendingCall;
        setPendingCall(null);
        (t === "video" ? actions.handleVideoCall : actions.handleVoiceCall)();
    };

    const muteActive = (d: MuteDuration | null) => activeConv && actions.handleMuteConv(activeConv.id, d);
    const archiveActive = () => activeConv && actions.handleArchiveConv(activeConv.id);

    const afterLeft = (convId: number | string) => {
        setConversations((prev: any[]) => prev.filter((c) => c.id !== convId));
        if (activeConv?.id === convId) {
            setActiveConv(null);
            setMessages([]);
        }
        loadConversations();
    };

    const deleteForMe = (msg: any) => {
        if (!activeConv) return;
        hideMessagesForMe(activeConv.id, [msg.id]);
        setMessages((cur: any[]) => cur.filter((m) => m.id !== msg.id));
    };

    const messageMember = async (m: { id: number | string; full_name?: string; username?: string; avatar?: string | null }) => {
        try {
            const { data } = await createConversation(m.id);
            openConversation((data as { conversationId: number | string }).conversationId, {
                other_user_id: m.id,
                other_username: m.username,
                other_full_name: m.full_name,
                other_avatar: m.avatar,
                is_self_chat: String(m.id) === String(user?.id),
            });
        } catch {
            /* ignore */
        }
    };

    return {
        groupSettingsOpen,
        setGroupSettingsOpen,
        deleteMsg,
        setDeleteMsg,
        leaveConfirm,
        setLeaveConfirm,
        pendingCall,
        consumePendingCall,
        openConvMeta,
        openSettings,
        openSettingsFor,
        callFrom,
        muteActive,
        archiveActive,
        afterLeft,
        deleteForMe,
        messageMember,
    };
}
