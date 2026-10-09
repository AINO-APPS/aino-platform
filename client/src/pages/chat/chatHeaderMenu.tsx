import {
    Archive,
    ArchiveRestore,
    Ban,
    Bell,
    Image as ImageIcon,
    Info,
    LogOut,
    Pin,
    Search,
    Star,
    Trash2,
    Eraser,
} from "lucide-react";
import { muteEntry, type MuteDuration, type SignalMenuEntry } from "../../components/chat/signal/SignalMenu";

export interface HeaderMenuHandlers {
    onViewAllMedia: () => void;
    onSearch: () => void;
    onPinned: () => void;
    onStarred: () => void;
    onMute?: (duration: MuteDuration | null) => void;
    onOpenSettings: () => void;
    onArchive?: () => void;
    onLeave?: () => void;
    onBlock?: () => void;
    onClear: () => void;
    onDelete?: () => void;
}

/**
 * Thread overflow menu in Android's `ConversationOptionsMenu` order. Group
 * settings live ONLY here (no inline header icon).
 */
export function buildHeaderMenu(conv: any, h: HeaderMenuHandlers): SignalMenuEntry[] {
    const isGroup = !!conv.is_group;
    const canBlock = !isGroup && !conv.is_self_chat && !!conv.other_user_id;
    return [
        { label: "View all media", icon: <ImageIcon size={18} />, onClick: h.onViewAllMedia },
        { label: "Search", icon: <Search size={18} />, onClick: h.onSearch },
        { label: "Pinned messages", icon: <Pin size={18} />, onClick: h.onPinned },
        { label: "Saved messages", icon: <Star size={18} />, onClick: h.onStarred },
        h.onMute &&
            (conv.is_muted
                ? { label: "Unmute notifications", icon: <Bell size={18} />, onClick: () => h.onMute!(null) }
                : muteEntry((d) => h.onMute!(d))),
        { label: isGroup ? "Group settings" : "Chat settings", icon: <Info size={18} />, onClick: h.onOpenSettings },
        h.onArchive && {
            label: conv.is_archived ? "Unarchive" : "Archive",
            icon: conv.is_archived ? <ArchiveRestore size={18} /> : <Archive size={18} />,
            onClick: h.onArchive,
        },
        { divider: true },
        isGroup && h.onLeave && { label: "Leave group", icon: <LogOut size={18} />, danger: true, onClick: h.onLeave },
        canBlock &&
            h.onBlock && {
                label: conv.is_blocked ? "Unblock" : "Block",
                icon: <Ban size={18} />,
                danger: !conv.is_blocked,
                onClick: h.onBlock,
            },
        { label: "Clear chat", icon: <Eraser size={18} />, danger: true, onClick: h.onClear },
        h.onDelete && { label: "Delete chat", icon: <Trash2 size={18} />, danger: true, onClick: h.onDelete },
    ];
}
