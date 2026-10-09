import { useEffect, useState } from "react";
import {
    Phone,
    Video,
    Search,
    Pin,
    PinOff,
    FolderOpen,
    Star,
    StarOff,
    Ban,
    Eraser,
    Bell,
    BellOff,
    Archive,
    ArchiveRestore,
    PhoneIncoming,
    PhoneOutgoing,
    PhoneMissed,
} from "lucide-react";
import ConversationAvatar from "../../components/chat/ConversationAvatar";
import SignalMenu, { MUTE_DURATIONS, type MuteDuration } from "../../components/chat/signal/SignalMenu";
import { getCallHistory, getSharedFiles } from "../../api/chat";
import { getConvName, isUserOnline, WORK_MODE_LABEL } from "./chatUtils";
import { useFeatures } from "../../FeaturesContext";
import { TopBar, SettingsRow, QuickAction, Divider, SectionTitle } from "./groupSettings/SettingsUi";
import { callLabel } from "./callLabels";
import gs from "./groupSettings/GroupSettings.module.css";
import s from "./ConversationInfoPanel.module.css";

const STATUS_LABEL: Record<string, string> = {
    available: "Available",
    busy: "Busy",
    dnd: "Do Not Disturb",
    away: "Away",
    offline: "Offline",
    in_call: "In a Call",
    in_meeting: "In a Meeting",
};

interface ConversationInfoPanelProps {
    activeConv: any;
    currentUserId?: number | string;
    onlineUsers: Set<number | string>;
    userStatusMap?: Record<string, string>;
    userWorkModeMap?: Record<string, string | null>;
    onClose: () => void;
    onSearch: () => void;
    onPinned: () => void;
    onSharedFiles: () => void;
    onStarred: () => void;
    onVoiceCall: () => void;
    onVideoCall: () => void;
    onClearChat: (id: number | string) => void;
    onToggleBlock: (conv: any) => void;
    onPinConv?: (id: number | string) => void;
    onFavConv?: (id: number | string) => void;
    onMute?: (d: MuteDuration | null) => void;
    onArchive?: (id: number | string) => void;
    [key: string]: unknown;
}

/** Android chat-info page (direct/self chats): hero, quick actions, media strip, pinned/saved, chat toggles, block/clear, call history. */
export default function ConversationInfoPanel(p: ConversationInfoPanelProps) {
    const { activeConv: c, onClose } = p;
    const { hasFeature } = useFeatures() as { hasFeature: (key: string) => boolean };
    const callsEnabled = hasFeature("calls") && !c.is_self_chat;
    const name = getConvName(c);
    const online = isUserOnline(c, p.onlineUsers);
    const status = c.other_user_id ? p.userStatusMap?.[c.other_user_id] : undefined;
    const workMode = c.other_user_id ? p.userWorkModeMap?.[c.other_user_id] : undefined;
    const [recent, setRecent] = useState<any[]>([]);
    const [calls, setCalls] = useState<any[]>([]);
    const [muteAt, setMuteAt] = useState<{ x: number; y: number } | null>(null);

    useEffect(() => {
        let alive = true;
        getSharedFiles(c.id)
            .then(({ data }) => alive && setRecent((data as any[]).filter((f) => /^image\//.test(f.file_type || "")).slice(0, 4)))
            .catch(() => undefined);
        if (callsEnabled)
            getCallHistory(c.id)
                .then(({ data }) => alive && setCalls((Array.isArray(data) ? data : (data as any)?.calls || []).slice(0, 10)))
                .catch(() => undefined);
        return () => {
            alive = false;
        };
    }, [c.id, callsEnabled]);

    const subtitle = c.is_self_chat
        ? "Message yourself"
        : status && status !== "available"
          ? STATUS_LABEL[status] || status
          : online
            ? "Online"
            : c.other_username
              ? `@${c.other_username}`
              : "";
    const run = (fn: () => void) => () => {
        onClose();
        fn();
    };

    return (
        <div className={gs.panel} role="dialog" aria-label="Chat settings">
            <TopBar title="" onBack={onClose} />
            <div className={gs.body}>
                <div className={gs.inner}>
                    <div className={gs.hero}>
                        <ConversationAvatar conv={c} name={name} size={112} online={online} userStatus={status} />
                        <div className={gs.heroName}>{name}</div>
                        {subtitle && <div className={gs.heroSub}>{subtitle}</div>}
                        {workMode && WORK_MODE_LABEL[workMode] && <div className={s.workMode}>{WORK_MODE_LABEL[workMode]}</div>}
                    </div>
                    <div className={gs.quickRow}>
                        {callsEnabled && (
                            <>
                                <QuickAction icon={<Video size={22} />} label="Video" onClick={run(p.onVideoCall)} />
                                <QuickAction icon={<Phone size={21} />} label="Audio" onClick={run(p.onVoiceCall)} />
                            </>
                        )}
                        {p.onMute && (
                            <QuickAction
                                icon={c.is_muted ? <BellOff size={21} /> : <Bell size={21} />}
                                label={c.is_muted ? "Muted" : "Mute"}
                                onClick={() => {
                                    if (c.is_muted) p.onMute!(null);
                                    else {
                                        const r = document.activeElement?.getBoundingClientRect();
                                        setMuteAt({ x: r?.left ?? 200, y: (r?.bottom ?? 200) + 4 });
                                    }
                                }}
                            />
                        )}
                        <QuickAction icon={<Search size={21} />} label="Search" onClick={run(p.onSearch)} />
                    </div>
                    <Divider />
                    <SettingsRow icon={<FolderOpen size={22} />} label="All media, files & links" onClick={run(p.onSharedFiles)} />
                    {recent.length > 0 && (
                        <div className={s.strip}>
                            {recent.map((f) => (
                                <button key={f.id} type="button" className={s.stripTile} onClick={run(p.onSharedFiles)} aria-label={f.file_name || "Photo"}>
                                    <img src={f.file_url} alt="" loading="lazy" />
                                </button>
                            ))}
                        </div>
                    )}
                    <SettingsRow icon={<Pin size={22} />} label="Pinned messages" onClick={run(p.onPinned)} />
                    <SettingsRow icon={<Star size={22} />} label="Saved messages" onClick={run(p.onStarred)} />
                    <Divider />
                    {p.onPinConv && (
                        <SettingsRow
                            icon={c.is_pinned ? <PinOff size={22} /> : <Pin size={22} />}
                            label={c.is_pinned ? "Unpin chat" : "Pin chat"}
                            onClick={() => p.onPinConv!(c.id)}
                        />
                    )}
                    {p.onFavConv && (
                        <SettingsRow
                            icon={c.is_favourite ? <StarOff size={22} /> : <Star size={22} />}
                            label={c.is_favourite ? "Remove from favourites" : "Add to favourites"}
                            onClick={() => p.onFavConv!(c.id)}
                        />
                    )}
                    {p.onArchive && (
                        <SettingsRow
                            icon={c.is_archived ? <ArchiveRestore size={22} /> : <Archive size={22} />}
                            label={c.is_archived ? "Unarchive" : "Archive"}
                            onClick={run(() => p.onArchive!(c.id))}
                        />
                    )}
                    <Divider />
                    {!c.is_self_chat && c.other_user_id && (
                        <SettingsRow
                            icon={<Ban size={22} />}
                            label={c.is_blocked ? "Unblock user" : "Block user"}
                            danger={!c.is_blocked}
                            onClick={run(() => p.onToggleBlock(c))}
                        />
                    )}
                    <SettingsRow icon={<Eraser size={22} />} label="Clear chat" danger onClick={run(() => p.onClearChat(c.id))} />
                    {calls.length > 0 && (
                        <>
                            <Divider />
                            <SectionTitle>Call history</SectionTitle>
                            {calls.map((call) => {
                                const l = callLabel(call, p.currentUserId);
                                const Icon = l.missed ? PhoneMissed : l.outgoing ? PhoneOutgoing : PhoneIncoming;
                                return (
                                    <SettingsRow
                                        key={call.id}
                                        icon={<Icon size={20} className={l.missed ? gs.danger : undefined} />}
                                        label={l.title}
                                        subtitle={l.when}
                                        trailing={l.duration}
                                    />
                                );
                            })}
                        </>
                    )}
                </div>
            </div>
            {muteAt && p.onMute && (
                <SignalMenu
                    x={muteAt.x}
                    y={muteAt.y}
                    onClose={() => setMuteAt(null)}
                    items={MUTE_DURATIONS.map((m) => ({ label: m.label, icon: <BellOff size={18} />, onClick: () => p.onMute!(m.key) }))}
                />
            )}
        </div>
    );
}
