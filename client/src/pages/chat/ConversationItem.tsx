import { useState } from "react";
import { BellOff, CheckSquare2, MoreVertical, Pin, Square } from "lucide-react";
import ConversationAvatar from "../../components/chat/ConversationAvatar";
import SignalMenu, { type MuteDuration } from "../../components/chat/signal/SignalMenu";
import { fmtTime, getConvName, isUserOnline } from "./chatUtils";
import { attachmentPreview, ListTick } from "./convListParts";
import { buildConversationMenu } from "./conversationMenu";
import s from "./ChatSidebar.module.css";

interface ConversationItemProps {
  conv: any;
  activeConvId: number | string | null;
  typingUsers: Record<string, any>;
  onlineUsers: any;
  userStatusMap?: Record<string, string>;
  userId?: number | string;
  callsEnabled?: boolean;
  onOpen: (c: any) => void;
  onPin: (id: number | string) => void;
  onFav: (id: number | string) => void;
  onDelete: (c: any) => void;
  onMute?: (id: number | string, duration: MuteDuration | null) => void;
  onArchive?: (id: number | string) => void;
  onToggleRead?: (id: number | string, currentlyUnread: boolean) => void;
  onCall?: (c: any, type: "voice" | "video") => void;
  onOpenSettings?: (c: any) => void;
  onBlock?: (c: any) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (id: number | string) => void;
  onEnterSelection?: (id: number | string) => void;
  [key: string]: unknown;
}

/** Android chat-list row: 48px avatar · name/time · snippet with receipts, muted/pinned glyphs and unread badge. */
export default function ConversationItem({
  conv: c,
  activeConvId,
  typingUsers,
  onlineUsers,
  userStatusMap = {},
  userId,
  callsEnabled = false,
  onOpen,
  onPin,
  onFav,
  onDelete,
  onMute,
  onArchive,
  onToggleRead,
  onCall,
  onOpenSettings,
  onBlock,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onEnterSelection,
}: ConversationItemProps) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; right?: boolean } | null>(null);
  const otherStatus = !c.is_group && c.other_user_id ? userStatusMap[c.other_user_id] : undefined;
  const unread = (c.unread_count || 0) > 0;
  const name = getConvName(c);
  const typing = typingUsers[c.id];

  const snippet = c.last_deleted
    ? "Message deleted"
    : c.last_message
      ? c.last_message
      : c.last_file_url
        ? attachmentPreview(c.last_file_type, c.last_file_name, c.last_file_url)
        : "No messages yet";
  const sender =
    c.is_group && c.last_sender_name && !c.last_deleted
      ? Number(c.last_sender_id) === Number(userId)
        ? "You: "
        : `${String(c.last_sender_name).split(" ")[0]}: `
      : "";

  const items = buildConversationMenu(
    c,
    {
      onPin,
      onFav,
      onToggleRead,
      onMute,
      onSelect: onEnterSelection,
      onArchive,
      onCall,
      onOpenSettings,
      onBlock,
      onDelete,
    },
    callsEnabled,
  );

  return (
    <div
      className={`${s.convItem} ${activeConvId === c.id ? s.active : ""} ${selected ? s.convItemSelected : ""} ${
        selectionMode ? s.convItemSelectable : ""
      }`}
      role="button"
      tabIndex={0}
      aria-label={`${name}${unread ? `, ${c.unread_count} unread` : ""}`}
      onClick={() => (selectionMode ? onToggleSelect?.(c.id) : onOpen(c))}
      onKeyDown={(e) => {
        if (e.key === "Enter") selectionMode ? onToggleSelect?.(c.id) : onOpen(c);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!selectionMode) setMenuAt({ x: e.clientX, y: e.clientY });
      }}
    >
      {selectionMode && (
        <span className={s.convCheckbox} aria-hidden="true">
          {selected ? <CheckSquare2 size={20} /> : <Square size={20} />}
        </span>
      )}
      <ConversationAvatar conv={c} name={name} size={48} online={isUserOnline(c, onlineUsers)} userStatus={otherStatus} />
      <div className={s.convInfo}>
        <div className={s.convTop}>
          <span className={`${s.convName} ${unread ? s.convNameUnread : ""}`}>{name}</span>
          <span className={`${s.convTime} ${unread && !c.is_muted ? s.convTimeUnread : ""}`}>{fmtTime(c.last_message_at)}</span>
        </div>
        <div className={s.convPreview}>
          {typing ? (
            <span className={s.typing}>typing…</span>
          ) : (
            <span className={`${s.snippet} ${unread ? s.unread : ""}`}>
              {sender}
              {snippet}
            </span>
          )}
          {!typing && <ListTick conv={c} userId={userId} />}
          {c.is_muted && <BellOff size={14} className={s.rowGlyph} aria-label="Muted" />}
          {c.is_pinned && !unread && <Pin size={14} className={s.rowGlyph} aria-label="Pinned" />}
          {unread && <span className={`${s.badge} ${c.is_muted ? s.badgeMuted : ""}`}>{c.unread_count > 99 ? "99+" : c.unread_count}</span>}
        </div>
      </div>
      {!selectionMode && (
        <button
          className={s.convMenuBtn}
          title="More options"
          aria-label="More options"
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenuAt({ x: r.right, y: r.bottom + 4, right: true });
          }}
        >
          <MoreVertical size={18} />
        </button>
      )}
      {menuAt && <SignalMenu x={menuAt.x} y={menuAt.y} alignRight={menuAt.right} items={items} onClose={() => setMenuAt(null)} />}
    </div>
  );
}
