import { CheckSquare2, Copy, Download, Forward, Pencil, Pin, Reply, Star, Trash2 } from "lucide-react";
import type { ContextMenuItem } from "./ContextMenu";

export interface MessageActionHandlers {
    onReply?: (msg: any) => void;
    onEdit?: (msg: any) => void;
    onForward?: (msg: any) => void;
    onCopy?: () => void;
    onSelect?: (msg: any) => void;
    onPin?: (msg: any) => void;
    onStar?: (msg: any) => void;
    onDelete?: (msg: any) => void;
}

/** Trigger a browser download of a chat attachment ("Save to device"). */
export function saveToDevice(url: string, name?: string | null) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name || "";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/**
 * Message long-press/right-click actions in Android `ChatReactionOverlay`
 * order: Reply, Edit, Forward, Copy, Save to device, Select, Pin, Save, Delete.
 * Delete is offered on every message (the dialog decides "for me" vs "for everyone").
 */
export function buildMessageActions(msg: any, isMine: boolean, h: MessageActionHandlers): ContextMenuItem[] {
    if (String(msg.id).startsWith("pending_")) return [];
    const isPoll = msg.format_type === "poll" && msg.metadata?.pollId;
    const hasText = !!String(msg.content || "").trim();
    const canSave = !!msg.file_url && !msg.metadata?.viewOnce;
    const items: (ContextMenuItem | false)[] = [
        { icon: <Reply size={15} />, label: "Reply", onClick: () => h.onReply?.(msg) },
        isMine && !msg.file_url && !isPoll && { icon: <Pencil size={15} />, label: "Edit", onClick: () => h.onEdit?.(msg) },
        { icon: <Forward size={15} />, label: "Forward", onClick: () => h.onForward?.(msg) },
        hasText && { icon: <Copy size={15} />, label: "Copy", onClick: () => h.onCopy?.() },
        canSave && { icon: <Download size={15} />, label: "Save to device", onClick: () => saveToDevice(msg.file_url, msg.file_name) },
        !!h.onSelect && { icon: <CheckSquare2 size={15} />, label: "Select", onClick: () => h.onSelect?.(msg) },
        { icon: <Pin size={15} />, label: msg.pinned_at ? "Unpin" : "Pin", onClick: () => h.onPin?.(msg) },
        { icon: <Star size={15} />, label: msg.starred ? "Unsave" : "Save", onClick: () => h.onStar?.(msg) },
        !!h.onDelete && { icon: <Trash2 size={15} />, label: "Delete", danger: true, onClick: () => h.onDelete?.(msg) },
    ];
    return items.filter(Boolean) as ContextMenuItem[];
}
