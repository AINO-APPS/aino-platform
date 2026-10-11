import { SmilePlus as MaterialSmilePlus, Reply as MaterialReply, Edit as MaterialEdit, MoreHorizontal as MaterialMoreHorizontal } from "../../constants/icons";
import React, { useCallback, useRef } from "react";
import s from "./MessageBubble.module.css";

// Signal-Android's exact six (ConversationReactionOverlay). Kept in sync with
// the mobile chatUtils EMOJIS quick-reaction row.
const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

interface ToolbarMsg {
    id: number | string;
    file_url?: string | null;
    format_type?: string;
    [key: string]: unknown;
}

interface MessageToolbarProps {
    msg: ToolbarMsg;
    isMine: boolean;
    onReply?: (msg: ToolbarMsg) => void;
    onEdit?: (msg: ToolbarMsg) => void;
    onReact?: (msgId: number | string, emoji: string) => void;
    onOpenReactions?: () => void;
    onOpenContextMenu: (e: { preventDefault: () => void; clientX: number; clientY: number }) => void;
    onCloseToolbar?: () => void;
}

export default function MessageToolbar({ msg, isMine, onReply, onEdit, onReact, onOpenReactions, onOpenContextMenu, onCloseToolbar }: MessageToolbarProps) {
    const moreRef = useRef<HTMLButtonElement | null>(null);
    const canEdit = isMine && !msg.file_url && msg.format_type !== "poll";

    // Open context menu positioned from the "..." button (works on both touch and mouse)
    const handleMoreOptions = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const rect = moreRef.current?.getBoundingClientRect();
        if (rect) {
            onOpenContextMenu({ preventDefault() {}, clientX: rect.left, clientY: rect.bottom + 4 });
        }
        onCloseToolbar?.();
    }, [onOpenContextMenu, onCloseToolbar]);

    // Stop touch events from bubbling to the parent's swipe/tap handler
    const stopTouch = useCallback((e: React.TouchEvent) => e.stopPropagation(), []);

    return (
        <div className={s.hoverActions} data-toolbar onTouchStart={stopTouch} onTouchEnd={stopTouch} onTouchMove={stopTouch}>
            <div className={s.quickReactions}>
                {QUICK_EMOJIS.map(emoji => (
                    <button key={emoji} className={s.quickEmoji} onClick={() => { onReact?.(msg.id, emoji); onCloseToolbar?.(); }} title={emoji}>
                        {emoji}
                    </button>
                ))}
                <button className={s.moreEmoji} onClick={onOpenReactions} title="More reactions">
                    <MaterialSmilePlus size="16" width="16" height="16" />
                </button>
            </div>
            <div className={s.toolbarDivider} />
            <button className={s.toolbarBtn} onClick={() => { onReply?.(msg); onCloseToolbar?.(); }} title="Reply">
                <MaterialReply size="16" width="16" height="16" />
            </button>
            {canEdit && (
                <button className={s.toolbarBtn} onClick={() => { onEdit?.(msg); onCloseToolbar?.(); }} title="Edit">
                    <MaterialEdit size="16" width="16" height="16" />
                </button>
            )}
            <button ref={moreRef} className={s.toolbarBtn} onClick={handleMoreOptions} title="More options">
                <MaterialMoreHorizontal size="16" width="16" height="16" />
            </button>
        </div>
    );
}