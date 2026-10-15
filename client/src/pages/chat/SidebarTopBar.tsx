import { useRef, useState, type RefObject } from "react";
import {
    Archive,
    ArrowLeft,
    CheckCircle2,
    CheckDone,
    MessageCircle,
    MoreVertical,
    Phone,
    RefreshCw,
    Search,
    Settings,
    SquarePen,
    UserPlus,
    Video,
    X,
} from "../../constants/icons";
import SignalMenu, { type SignalMenuEntry } from "../../components/chat/signal/SignalMenu";
import s from "./ChatSidebar.module.css";

export type SidebarTab = "msgs" | "meetings" | "calls";

/** Handlers/flags backing the per-tab ⋮ overflow menu (Android chat list parity). */
export interface SidebarMenuOptions {
    tab: SidebarTab;
    showArchived: boolean;
    archivedCount: number;
    canMarkAllRead: boolean;
    canSelect: boolean;
    onNewChat: () => void;
    onNewGroup: () => void;
    onMarkAllRead: () => void;
    onSelect: () => void;
    onToggleArchived: () => void;
    onRefresh: () => void;
    onOpenSettings: () => void;
}

interface Props extends SidebarMenuOptions {
    onTab: (t: SidebarTab) => void;
    unread: number;
    meetingUnread: number;
    meetingsEnabled: boolean;
    search: string;
    setSearch: (v: string) => void;
    searchOpen: boolean;
    onSearchOpen: (open: boolean) => void;
    searchInputRef: RefObject<HTMLInputElement>;
}

const TITLES: Record<SidebarTab, string> = { msgs: "Chats", meetings: "Meetings", calls: "Calls" };
const PLACEHOLDER: Record<SidebarTab, string> = { msgs: "Search", meetings: "Search meeting chats", calls: "Search calls" };

export function sidebarMenuItems(o: SidebarMenuOptions): SignalMenuEntry[] {
    const refresh: SignalMenuEntry = { label: "Refresh", icon: <RefreshCw size={18} />, onClick: o.onRefresh };
    if (o.tab === "calls") {
        return [{ label: "Select calls", icon: <CheckCircle2 size={18} />, onClick: o.onSelect }, { divider: true }, refresh];
    }
    const markRead: SignalMenuEntry = { label: "Mark all as read", icon: <CheckDone size={18} />, disabled: !o.canMarkAllRead, onClick: o.onMarkAllRead };
    const select: SignalMenuEntry = { label: "Select chats", icon: <CheckCircle2 size={18} />, disabled: !o.canSelect, onClick: o.onSelect };
    if (o.tab === "meetings") return [markRead, select, { divider: true }, refresh];
    return [
        !o.showArchived && { label: "New chat", icon: <SquarePen size={18} />, onClick: o.onNewChat },
        !o.showArchived && { label: "New group", icon: <UserPlus size={18} />, onClick: o.onNewGroup },
        !o.showArchived && { divider: true },
        markRead,
        select,
        o.showArchived
            ? { label: "Back to chats", icon: <ArrowLeft size={18} />, onClick: o.onToggleArchived }
            : { label: "Archived chats", icon: <Archive size={18} />, trailing: o.archivedCount > 0 ? o.archivedCount : undefined, onClick: o.onToggleArchived },
        { divider: true },
        refresh,
        { label: "Settings", icon: <Settings size={18} />, onClick: o.onOpenSettings },
    ];
}

/** Android chat-list toolbar (title · search · ⋮) with Signal filter chips (Chats · Meet · Calls). */
export default function SidebarTopBar(p: Props) {
    const moreRef = useRef<HTMLButtonElement | null>(null);
    const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

    return (
        <>
            <div className={s.topBar}>
                {p.searchOpen ? (
                    <>
                        <button type="button" className={s.topIcon} onClick={() => p.onSearchOpen(false)} aria-label="Close search">
                            <ArrowLeft size={20} />
                        </button>
                        <div className={s.searchPill}>
                            <input
                                ref={p.searchInputRef}
                                autoFocus
                                value={p.search}
                                onChange={(e) => p.setSearch(e.target.value)}
                                placeholder={PLACEHOLDER[p.tab]}
                                aria-label={PLACEHOLDER[p.tab]}
                            />
                            {p.search && (
                                <button type="button" className={s.pillClear} onClick={() => p.setSearch("")} aria-label="Clear search">
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    </>
                ) : (
                    <>
                        <h2 className={s.topTitle}>{TITLES[p.tab]}</h2>
                        <button type="button" className={s.topIcon} onClick={() => p.onSearchOpen(true)} aria-label="Search" title="Search">
                            <Search size={20} />
                        </button>
                        <button
                            ref={moreRef}
                            type="button"
                            className={s.topIcon}
                            aria-label="More options"
                            onClick={() => {
                                const r = moreRef.current?.getBoundingClientRect();
                                setMenuAt({ x: r?.right ?? 300, y: (r?.bottom ?? 60) + 4 });
                            }}
                        >
                            <MoreVertical size={20} />
                        </button>
                    </>
                )}
            </div>
            <div className={s.chips} role="tablist">
                <Chip label="Chats" icon={<MessageCircle size={15} />} active={p.tab === "msgs"} badge={p.unread} onClick={() => p.onTab("msgs")} />
                {p.meetingsEnabled && (
                    <Chip label="Meet" icon={<Video size={15} />} active={p.tab === "meetings"} badge={p.meetingUnread} onClick={() => p.onTab("meetings")} />
                )}
                <Chip label="Calls" icon={<Phone size={15} />} active={p.tab === "calls"} badge={0} onClick={() => p.onTab("calls")} />
            </div>
            {menuAt && (
                <SignalMenu
                    x={menuAt.x}
                    y={menuAt.y}
                    alignRight
                    onClose={() => setMenuAt(null)}
                    items={sidebarMenuItems(p)}
                />
            )}
        </>
    );
}

function Chip({ label, icon, active, badge, onClick }: { label: string; icon: React.ReactNode; active: boolean; badge: number; onClick: () => void }) {
    return (
        <button type="button" role="tab" aria-selected={active} className={`${s.chip} ${active ? s.chipActive : ""}`} onClick={onClick}>
            {icon}
            {label}
            {badge > 0 && <span className={s.chipBadge}>{badge > 99 ? "99+" : badge}</span>}
        </button>
    );
}
