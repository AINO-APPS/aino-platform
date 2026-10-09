import { useRef, useState } from "react";
import { ArrowLeft, Phone, Video, MoreVertical, Building2, House } from "lucide-react";
import ConversationAvatar from "../../components/chat/ConversationAvatar";
import SignalMenu, { type MuteDuration } from "../../components/chat/signal/SignalMenu";
import { useFeatures } from "../../FeaturesContext";
import { getConvName, isUserOnline, WORK_MODE_LABEL } from "./chatUtils";
import { buildHeaderMenu } from "./chatHeaderMenu";
import s from "./ChatHeader.module.css";

const STATUS_LABEL: Record<string, string> = {
    available: "Available",
    busy: "Busy",
    dnd: "Do Not Disturb",
    away: "Away",
    offline: "Offline",
    in_call: "In a Call",
    in_meeting: "In a Meeting",
};

interface ChatHeaderProps {
    activeConv: any;
    onlineUsers: any;
    userStatusMap?: Record<string, string>;
    userWorkModeMap?: Record<string, string | null>;
    typing?: boolean;
    onBack: () => void;
    onGroupEdit: () => void;
    onToggleSearch: () => void;
    onTogglePinned: () => void;
    onToggleSharedFiles: () => void;
    onToggleStarred: () => void;
    onVoiceCall: () => void;
    onVideoCall: () => void;
    onClearChat?: (id: number | string) => void;
    onToggleBlock?: (conv: any) => void;
    onOpenInfo?: () => void;
    onMute?: (duration: MuteDuration | null) => void;
    onArchive?: () => void;
    onLeave?: () => void;
    onDelete?: () => void;
    [key: string]: unknown;
}

/**
 * Android thread toolbar: back · 40px avatar · name + subtitle · video · voice · ⋮.
 * Group settings are reachable only from the overflow menu.
 */
export default function ChatHeader({
    activeConv,
    onlineUsers,
    userStatusMap = {},
    userWorkModeMap = {},
    typing,
    onBack,
    onGroupEdit,
    onToggleSearch,
    onTogglePinned,
    onToggleSharedFiles,
    onToggleStarred,
    onVoiceCall,
    onVideoCall,
    onClearChat,
    onToggleBlock,
    onOpenInfo,
    onMute,
    onArchive,
    onLeave,
    onDelete,
}: ChatHeaderProps) {
    const { hasFeature } = useFeatures() as { hasFeature: (key: string) => boolean };
    const callsEnabled = hasFeature("calls");
    const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
    const moreRef = useRef<HTMLButtonElement | null>(null);

    const isGroup = !!activeConv.is_group;
    const otherStatus = !isGroup && activeConv.other_user_id ? userStatusMap[activeConv.other_user_id] : undefined;
    const otherWorkMode =
        !isGroup && activeConv.other_user_id ? (userWorkModeMap[activeConv.other_user_id] as string | null) : null;
    const online = isUserOnline(activeConv, onlineUsers);
    const name = getConvName(activeConv);

    const subtitle = typing
        ? "typing…"
        : isGroup
          ? `${activeConv.member_count || 0} members`
          : activeConv.is_self_chat
            ? "Message yourself"
            : otherStatus && otherStatus !== "available"
              ? STATUS_LABEL[otherStatus] || otherStatus
              : online
                ? "Online"
                : activeConv.other_username
                  ? `@${activeConv.other_username}`
                  : "";
    const workLabel = otherWorkMode ? WORK_MODE_LABEL[otherWorkMode] : null;

    const openSettings = isGroup ? onGroupEdit : onOpenInfo || (() => undefined);
    const items = buildHeaderMenu(activeConv, {
        onViewAllMedia: onToggleSharedFiles,
        onSearch: onToggleSearch,
        onPinned: onTogglePinned,
        onStarred: onToggleStarred,
        onMute,
        onOpenSettings: openSettings,
        onArchive,
        onLeave,
        onBlock: onToggleBlock ? () => onToggleBlock(activeConv) : undefined,
        onClear: () => onClearChat?.(activeConv.id),
        onDelete,
    });

    const openMenu = () => {
        const r = moreRef.current?.getBoundingClientRect();
        setMenuAt(r ? { x: r.right, y: r.bottom + 4 } : { x: window.innerWidth - 16, y: 64 });
    };

    return (
        <div className={s.chatHeader}>
            <button className={s.backBtn} onClick={onBack} aria-label="Back">
                <ArrowLeft size={20} />
            </button>
            <button
                type="button"
                className={s.identity}
                onClick={onOpenInfo}
                aria-label={isGroup ? "Group settings" : "Conversation info"}
            >
                <ConversationAvatar
                    conv={activeConv}
                    name={name}
                    size={40}
                    online={!isGroup ? online : undefined}
                    userStatus={otherStatus}
                />
                <span className={s.chatHeaderInfo}>
                    <span className={s.chatHeaderName}>{name}</span>
                    {(subtitle || workLabel) && (
                        <span className={`${s.chatHeaderMeta} ${typing ? s.typing : ""}`}>
                            {subtitle}
                            {workLabel && !typing && (
                                <span className={s.workMode}>
                                    {subtitle ? " · " : ""}
                                    {otherWorkMode === "remote" ? <House size={11} /> : <Building2 size={11} />}
                                    {workLabel}
                                </span>
                            )}
                        </span>
                    )}
                </span>
            </button>
            <div className={s.headerActions}>
                {!activeConv.is_self_chat && callsEnabled && (
                    <>
                        <button onClick={onVideoCall} title="Video call" aria-label="Video call" className={s.iconBtn}>
                            <Video size={21} />
                        </button>
                        <button onClick={onVoiceCall} title="Voice call" aria-label="Voice call" className={s.iconBtn}>
                            <Phone size={19} />
                        </button>
                    </>
                )}
                <button ref={moreRef} className={s.iconBtn} onClick={openMenu} aria-label="More options">
                    <MoreVertical size={20} />
                </button>
            </div>
            {menuAt && <SignalMenu x={menuAt.x} y={menuAt.y} alignRight items={items} onClose={() => setMenuAt(null)} />}
        </div>
    );
}
