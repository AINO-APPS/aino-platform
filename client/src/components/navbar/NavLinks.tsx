import { Home as MaterialHome, Calendar as MaterialCalendar, ClipboardList as MaterialClipboardList, FileText as MaterialFileText, MessageSquare as MaterialMessageSquare, CalendarCheck as MaterialCalendarCheck, Menu as MaterialMenu } from "../../constants/icons";
import { useState, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../AuthContext";
import { useFeatures } from "../../FeaturesContext";
import { useChatUnread } from "../../ChatContext";
import { useClickOutside } from "../../hooks/useClickOutside";
import { prefetchPage } from "../common/KeepAlive";
import { Building2, Users, Settings, Server } from "../../constants/icons";
import type { IconComponent } from "../../constants/icons";
import s from "./Navbar.module.css";

const ROLE_LEVELS: Record<string, number> = {
    employee: 1,
    team_lead: 2,
    manager: 3,
    hr_admin: 4,
    super_admin: 5,
    platform_admin: 6,
};

interface MoreItem {
    to: string;
    label: string;
    icon: IconComponent;
}

export default function NavLinks() {
    const { user } = useAuth() as any;
    const { hasFeature } = useFeatures() as any;
    const location = useLocation();
    const { unreadCount: chatUnread } = useChatUnread() as any;
    const [moreOpen, setMoreOpen] = useState(false);
    const moreRef = useRef<HTMLDivElement | null>(null);

    useClickOutside(moreRef, () => setMoreOpen(false));

    const userLevel = ROLE_LEVELS[user?.role] || 1;
    const isTeamLead = userLevel >= 2 || user?.has_reports;
    const isHR = userLevel >= 4;

    const moreItems: MoreItem[] = [];
    if (user?.org_id || user?.role === "platform_admin")
        moreItems.push({ to: "/organization", label: "Organization", icon: Building2 });
    if (isTeamLead) moreItems.push({ to: "/manager", label: "My Team", icon: Users });
    if (isHR) moreItems.push({ to: "/admin", label: "Admin", icon: Settings });
    if (user?.role === "platform_admin")
        moreItems.push({ to: "/tenants", label: "Tenants", icon: Server });

    const moreIsActive = moreItems.some((item) => location.pathname === item.to);
    const p = location.pathname;

    return (
        <div className={`${s["nav-links"]} ${s["nav-links-desktop"]}`} aria-label="Primary navigation">
            <NavLink
                to="/"
                className={p === "/" ? s.active : ""}
                onMouseEnter={() => prefetchPage("/")}
            >
                <MaterialHome size="15" className={s["nav-link-icon"]} width="15" height="15" />
                Dashboard
            </NavLink>
            {hasFeature("calendar") && (
                <NavLink
                    to="/calendar"
                    className={p === "/calendar" ? s.active : ""}
                    onMouseEnter={() => prefetchPage("/calendar")}
                >
                    <MaterialCalendar size="15" className={s["nav-link-icon"]} width="15" height="15" />
                    Calendar
                </NavLink>
            )}
            {hasFeature("tasks") && (
                <NavLink
                    to="/tasks"
                    className={p === "/tasks" ? s.active : ""}
                    onMouseEnter={() => prefetchPage("/tasks")}
                >
                    <MaterialClipboardList size="15" className={s["nav-link-icon"]} width="15" height="15" />
                    Tasks
                </NavLink>
            )}
            {hasFeature("notes") && (
                <NavLink
                    to="/notes"
                    className={p === "/notes" ? s.active : ""}
                    onMouseEnter={() => prefetchPage("/notes")}
                >
                    <MaterialFileText size="15" className={s["nav-link-icon"]} width="15" height="15" />
                    Notes
                </NavLink>
            )}
            {hasFeature("chat") && (
                <NavLink
                    to="/chat"
                    className={`${p === "/chat" ? s.active : ""} ${s.chatLink}`}
                    onMouseEnter={() => prefetchPage("/chat")}
                >
                    <MaterialMessageSquare size="15" className={s["nav-link-icon"]} width="15" height="15" />
                    Chat
                    {chatUnread > 0 && (
                        <span className={s.chatBadge}>{chatUnread > 99 ? "99+" : chatUnread}</span>
                    )}
                </NavLink>
            )}
            {hasFeature("attendance") && (
                <NavLink
                    to="/attendance"
                    className={p.startsWith("/attendance") ? s.active : ""}
                    onMouseEnter={() => prefetchPage("/attendance")}
                >
                    <MaterialCalendarCheck size="15" className={s["nav-link-icon"]} width="15" height="15" />
                    Attendance
                </NavLink>
            )}
            {moreItems.length > 0 && (
                <div className={s["more-wrapper"]} ref={moreRef}>
                    <button
                        className={`${s["more-btn"]} ${moreIsActive ? s.active : ""}`}
                        onClick={() => setMoreOpen((prev) => !prev)}
                        title="More"
                        aria-label="More navigation options"
                        aria-expanded={moreOpen}
                        aria-haspopup="menu"
                    >
                        <MaterialMenu size="18" width="18" height="18" />
                    </button>
                    {moreOpen && (
                        <div className={s["more-dropdown"]} role="menu">
                            {moreItems.map((item) => (
                                <NavLink
                                    key={item.to}
                                    to={item.to}
                                    className={p === item.to ? s.active : ""}
                                    onClick={() => setMoreOpen(false)}
                                    onMouseEnter={() => prefetchPage(item.to)}
                                >
                                    {item.icon && <item.icon size={15} />} {item.label}
                                </NavLink>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}