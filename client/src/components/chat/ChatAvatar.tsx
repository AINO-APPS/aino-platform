import { Check as MaterialCheck, Minus as MaterialMinus, Clock as MaterialClock, Circle as MaterialCircle, Phone as MaterialPhone, Video as MaterialVideo } from "../../constants/icons";
import s from "./ChatAvatar.module.css";

// Keep this map in sync with server/services/status/constants.js
// (EFFECTIVE_STATUSES) and client/src/status/constants.js (STATUS_META).
// Both `brb` (manual "I'll be right back") and `away` (server-derived from
// idle) share the same amber styling — the user thinks of them as the same
// state, the resolver just distinguishes the source.
const STATUS_CONFIG: Record<string, { cls: string; label: string }> = {
    available: { cls: "available", label: "Available" },
    busy: { cls: "busy", label: "Busy" },
    dnd: { cls: "dnd", label: "Do Not Disturb" },
    brb: { cls: "away", label: "Away" },
    away: { cls: "away", label: "Away" },
    offline: { cls: "offline", label: "Offline" },
    in_call: { cls: "inCall", label: "In a Call" },
    in_meeting: { cls: "inMeeting", label: "In a Meeting" },
};

interface ChatAvatarProps {
    avatar?: string | null;
    name?: string;
    size?: string;
    online?: boolean;
    userStatus?: string;
}

export default function ChatAvatar({ avatar, name, size = "md", online, userStatus }: ChatAvatarProps) {
    const initials = (name || "?")
        .split(" ")
        .map(w => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

    // Determine which dot style to show
    // If userStatus is provided, use the rich status system; otherwise fall back to online/offline
    const statusInfo = userStatus ? STATUS_CONFIG[userStatus] : null;
    const showDot = userStatus || online !== undefined;
    const showIcon = size !== "sm"; // Icons too small at 8px

    let dotClass = "";
    if (statusInfo) {
        dotClass = `${s.dot} ${s[statusInfo.cls] || s.offline}`;
    } else if (online !== undefined) {
        dotClass = `${s.dot} ${online ? s.available : s.offline}`;
    }

    return (
        <div className={`${s.wrap} ${s[size]}`}>
            {avatar ? (
                <img src={avatar} alt={name} className={s.img} />
            ) : (
                <div className={s.initials}>{initials}</div>
            )}
            {showDot && (
                <span
                    className={dotClass}
                    title={statusInfo?.label || (online ? "Online" : "Offline")}
                >
                    {showIcon && userStatus === "available" && (
                        <MaterialCheck size={"100%"} className={s.dotIcon} color="#fff" />
                    )}
                    {showIcon && userStatus === "dnd" && (
                        <MaterialMinus size={"100%"} className={s.dotIcon} color="#fff" />
                    )}
                    {showIcon && userStatus === "away" && (
                        <MaterialClock size={"100%"} className={s.dotIcon} color="#fff" />
                    )}
                    {showIcon && userStatus === "offline" && (
                        <MaterialCircle size={"100%"} className={s.dotIcon} />
                    )}
                    {showIcon && userStatus === "in_call" && (
                        <MaterialPhone size={"100%"} className={s.dotIcon} color="#fff" />
                    )}
                    {showIcon && userStatus === "in_meeting" && (
                        <MaterialVideo size={"100%"} className={s.dotIcon} color="#fff" />
                    )}
                </span>
            )}
        </div>
    );
}