import {
    Archive,
    ArchiveRestore,
    Ban,
    Bell,
    CheckCircle2,
    Info,
    MailOpen,
    MessageSquare,
    Phone,
    Pin,
    PinOff,
    Star,
    StarOff,
    Trash2,
    Video,
} from "lucide-react";
import { muteEntry, type MuteDuration, type SignalMenuEntry } from "../../components/chat/signal/SignalMenu";

export interface ConversationMenuHandlers {
    onPin: (id: number | string) => void;
    onFav: (id: number | string) => void;
    onToggleRead?: (id: number | string, currentlyUnread: boolean) => void;
    onMute?: (id: number | string, d: MuteDuration | null) => void;
    onSelect?: (id: number | string) => void;
    onArchive?: (id: number | string) => void;
    onCall?: (c: any, type: "voice" | "video") => void;
    onOpenSettings?: (c: any) => void;
    onBlock?: (c: any) => void;
    onDelete: (c: any) => void;
}

/**
 * Chat-list long-press / right-click menu: Android `ConversationContextMenu`
 * (Pin, Read/Unread, Mute, Select, Archive, Delete) plus the recipient-sheet
 * actions (call, settings, block) since desktop has no avatar bottom sheet.
 */
export function buildConversationMenu(c: any, h: ConversationMenuHandlers, callsEnabled: boolean): SignalMenuEntry[] {
    const unread = (c.unread_count || 0) > 0;
    const canCall = callsEnabled && !c.is_self_chat && !c.is_meeting_chat && !c.is_blocked && !!h.onCall;
    const oneToOne = !c.is_group && !c.is_meeting_chat && !c.is_self_chat && !!c.other_user_id;
    return [
        { label: c.is_pinned ? "Unpin chat" : "Pin chat", icon: c.is_pinned ? <PinOff size={18} /> : <Pin size={18} />, onClick: () => h.onPin(c.id) },
        h.onToggleRead && {
            label: unread ? "Mark as read" : "Mark as unread",
            icon: unread ? <MessageSquare size={18} /> : <MailOpen size={18} />,
            onClick: () => h.onToggleRead!(c.id, unread),
        },
        h.onMute &&
            (c.is_muted
                ? { label: "Unmute notifications", icon: <Bell size={18} />, onClick: () => h.onMute!(c.id, null) }
                : muteEntry((d) => h.onMute!(c.id, d))),
        {
            label: c.is_favourite ? "Remove from favourites" : "Add to favourites",
            icon: c.is_favourite ? <StarOff size={18} /> : <Star size={18} />,
            onClick: () => h.onFav(c.id),
        },
        h.onSelect && { label: "Select", icon: <CheckCircle2 size={18} />, onClick: () => h.onSelect!(c.id) },
        h.onArchive && {
            label: c.is_archived ? "Unarchive" : "Archive",
            icon: c.is_archived ? <ArchiveRestore size={18} /> : <Archive size={18} />,
            onClick: () => h.onArchive!(c.id),
        },
        canCall && { divider: true },
        canCall && { label: "Voice call", icon: <Phone size={18} />, onClick: () => h.onCall!(c, "voice") },
        canCall && { label: "Video call", icon: <Video size={18} />, onClick: () => h.onCall!(c, "video") },
        h.onOpenSettings && { label: c.is_group ? "Group settings" : "Chat settings", icon: <Info size={18} />, onClick: () => h.onOpenSettings!(c) },
        { divider: true },
        oneToOne && h.onBlock && { label: c.is_blocked ? "Unblock" : "Block", icon: <Ban size={18} />, danger: !c.is_blocked, onClick: () => h.onBlock!(c) },
        { label: "Delete", icon: <Trash2 size={18} />, danger: true, onClick: () => h.onDelete(c) },
    ];
}
