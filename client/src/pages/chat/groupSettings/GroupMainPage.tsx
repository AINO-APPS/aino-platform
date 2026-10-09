import { useRef, useState } from "react";
import {
    Bell,
    BellOff,
    Camera,
    ChevronDown,
    Eraser,
    Image as ImageIcon,
    Link2,
    Loader2,
    Lock,
    LogOut,
    Phone,
    Pin,
    Search,
    Star,
    UserCheck,
    UserPlus,
    Video,
} from "lucide-react";
import ConversationAvatar from "../../../components/chat/ConversationAvatar";
import SignalMenu, { MUTE_DURATIONS, type MuteDuration } from "../../../components/chat/signal/SignalMenu";
import { getConvName } from "../chatUtils";
import { Divider, MemberRow, QuickAction, SectionTitle, SettingsRow } from "./SettingsUi";
import type { GroupSettingsState } from "./useGroupSettings";
import type { GroupMember } from "./groupPermissions";
import s from "./GroupSettings.module.css";

export type GroupPage = "main" | "edit" | "members" | "add" | "link" | "requests" | "permissions";

const MEMBER_PREVIEW = 5;

interface Props {
    gs: GroupSettingsState;
    currentUserId?: number | string;
    callsEnabled: boolean;
    onPage: (p: GroupPage) => void;
    onMember: (m: GroupMember) => void;
    onVoiceCall: () => void;
    onVideoCall: () => void;
    onMute: (d: MuteDuration | null) => void;
    onSearch: () => void;
    onAllMedia: () => void;
    onPinned: () => void;
    onStarred: () => void;
    onLeave: () => void;
    onClear: () => void;
}

/** Android `GroupMainPage`: hero, quick actions, media rows, members preview, admin rows, leave/clear. */
export default function GroupMainPage(p: Props) {
    const { gs } = p;
    const { group, perms, members } = gs;
    const fileRef = useRef<HTMLInputElement | null>(null);
    const [photoMenu, setPhotoMenu] = useState<{ x: number; y: number } | null>(null);
    const [muteMenu, setMuteMenu] = useState<{ x: number; y: number } | null>(null);
    const count = members.length || group.member_count || 0;
    const description = String(group.group_description || "").trim();
    const pending = gs.link?.pendingRequests || 0;

    const onAvatarClick = (e: React.MouseEvent) => {
        if (!perms.canEditInfo) return;
        if (group.group_avatar) setPhotoMenu({ x: e.clientX, y: e.clientY });
        else fileRef.current?.click();
    };

    return (
        <div className={s.inner}>
            <div className={s.hero}>
                <button
                    type="button"
                    className={`${s.avatarWrap} ${perms.canEditInfo ? s.editable : ""}`}
                    onClick={onAvatarClick}
                    aria-label={perms.canEditInfo ? "Change group photo" : undefined}
                    disabled={!perms.canEditInfo}
                >
                    <ConversationAvatar conv={group} name={getConvName(group)} size={112} members={members} />
                    {gs.avatarUploading && (
                        <span className={s.avatarBusy}>
                            <Loader2 size={28} className={s.spin} />
                        </span>
                    )}
                    {perms.canEditInfo && (
                        <span className={s.avatarBadge}>
                            <Camera size={17} />
                        </span>
                    )}
                </button>
                <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    hidden
                    onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void gs.uploadAvatar(f);
                        e.target.value = "";
                    }}
                />
                <div className={s.heroName}>{getConvName(group)}</div>
                <div className={s.heroSub}>
                    Group · {count} {count === 1 ? "member" : "members"}
                </div>
                {description ? (
                    <div className={s.heroDesc}>{description}</div>
                ) : perms.canEditInfo ? (
                    <button type="button" className={s.linkBtn} onClick={() => p.onPage("edit")}>
                        Add group description…
                    </button>
                ) : null}
            </div>

            <div className={s.quickRow}>
                {p.callsEnabled && (
                    <>
                        <QuickAction icon={<Video size={22} />} label="Video" onClick={p.onVideoCall} />
                        <QuickAction icon={<Phone size={21} />} label="Audio" onClick={p.onVoiceCall} />
                    </>
                )}
                <QuickAction
                    icon={group.is_muted ? <BellOff size={21} /> : <Bell size={21} />}
                    label={group.is_muted ? "Muted" : "Mute"}
                    onClick={() => {
                        if (group.is_muted) p.onMute(null);
                        else {
                            const r = document.activeElement?.getBoundingClientRect();
                            setMuteMenu({ x: r ? r.left : window.innerWidth / 2, y: r ? r.bottom + 4 : 200 });
                        }
                    }}
                />
                <QuickAction icon={<Search size={21} />} label="Search" onClick={p.onSearch} />
            </div>

            <Divider />
            <SettingsRow icon={<ImageIcon size={22} />} label="All media, files & links" onClick={p.onAllMedia} />
            <SettingsRow icon={<Pin size={22} />} label="Pinned messages" onClick={p.onPinned} />
            <SettingsRow icon={<Star size={22} />} label="Saved messages" onClick={p.onStarred} />
            <Divider />

            <SectionTitle>
                {count} {count === 1 ? "member" : "members"}
            </SectionTitle>
            {perms.canAddMembers && <SettingsRow icon={<UserPlus size={22} />} label="Add members" accent onClick={() => p.onPage("add")} />}
            {gs.membersLoading && members.length === 0 && <div className={s.loading}>Loading members…</div>}
            {members.slice(0, MEMBER_PREVIEW).map((m) => (
                <MemberRow key={m.id} member={m} currentUserId={p.currentUserId} onClick={() => p.onMember(m)} />
            ))}
            {members.length > MEMBER_PREVIEW && <SettingsRow icon={<ChevronDown size={22} />} label="See all" onClick={() => p.onPage("members")} />}
            <Divider />

            {perms.canManageLink && (
                <>
                    <SettingsRow
                        icon={<Link2 size={22} />}
                        label="Group link"
                        trailing={gs.link?.enabled ? "On" : "Off"}
                        onClick={() => p.onPage("link")}
                    />
                    <SettingsRow
                        icon={<UserCheck size={22} />}
                        label="Requests & invites"
                        trailing={pending > 0 ? String(pending) : undefined}
                        onClick={() => p.onPage("requests")}
                    />
                    <SettingsRow icon={<Lock size={22} />} label="Permissions" onClick={() => p.onPage("permissions")} />
                    <Divider />
                </>
            )}
            <SettingsRow icon={<LogOut size={22} />} label="Leave group" danger onClick={p.onLeave} />
            <SettingsRow icon={<Eraser size={22} />} label="Clear chat" danger onClick={p.onClear} />

            {photoMenu && (
                <SignalMenu
                    x={photoMenu.x}
                    y={photoMenu.y}
                    onClose={() => setPhotoMenu(null)}
                    items={[
                        { label: "Change photo", icon: <Camera size={18} />, onClick: () => fileRef.current?.click() },
                        { label: "Remove photo", icon: <Eraser size={18} />, danger: true, onClick: () => void gs.removeAvatar() },
                    ]}
                />
            )}
            {muteMenu && (
                <SignalMenu
                    x={muteMenu.x}
                    y={muteMenu.y}
                    onClose={() => setMuteMenu(null)}
                    items={MUTE_DURATIONS.map((m) => ({ label: m.label, icon: <BellOff size={18} />, onClick: () => p.onMute(m.key) }))}
                />
            )}
        </div>
    );
}
