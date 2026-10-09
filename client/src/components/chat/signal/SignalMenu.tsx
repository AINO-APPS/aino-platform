import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, BellOff } from "lucide-react";
import s from "./SignalMenu.module.css";

export type MuteDuration = "1h" | "8h" | "1d" | "1w" | "always";

/** Android `MuteDurations` (server accepts 1h | 8h | 1d | 1w | always). */
export const MUTE_DURATIONS: Array<{ key: MuteDuration; label: string }> = [
    { key: "1h", label: "Mute for 1 hour" },
    { key: "8h", label: "Mute for 8 hours" },
    { key: "1d", label: "Mute for 1 day" },
    { key: "1w", label: "Mute for 7 days" },
    { key: "always", label: "Mute always" },
];

export interface SignalMenuAction {
    label: string;
    icon?: ReactNode;
    danger?: boolean;
    onClick?: () => void;
    /** Opens a nested page of items in place (e.g. mute durations). */
    submenu?: SignalMenuEntry[];
}
export type SignalMenuEntry = SignalMenuAction | { divider: true } | false | null | undefined;

/** Ready-made mute submenu entry. */
export function muteEntry(onMute: (d: MuteDuration) => void, icon?: ReactNode): SignalMenuAction {
    return {
        label: "Mute notifications",
        icon: icon ?? <BellOff size={18} />,
        submenu: MUTE_DURATIONS.map((m) => ({ label: m.label, icon: <BellOff size={18} />, onClick: () => onMute(m.key) })),
    };
}

interface Props {
    /** Viewport anchor point (top-left of the menu unless it would overflow). */
    x: number;
    y: number;
    /** Align the menu's right edge to `x` (header ⋮ buttons). */
    alignRight?: boolean;
    items: SignalMenuEntry[];
    onClose: () => void;
}

/** Android `SignalDropdownMenu`: elevated surface, 44px rows, leading icons, red danger rows. */
export default function SignalMenu({ x, y, alignRight, items, onClose }: Props) {
    const ref = useRef<HTMLDivElement | null>(null);
    const [stack, setStack] = useState<{ title: string; items: SignalMenuEntry[] }[]>([]);
    const [pos, setPos] = useState({ left: x, top: y });
    const current = stack.length ? stack[stack.length - 1].items : items;

    useEffect(() => {
        const onDown = (e: PointerEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("pointerdown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [onClose]);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        let left = alignRight ? x - r.width : x;
        let top = y;
        if (left + r.width > window.innerWidth - 8) left = window.innerWidth - r.width - 8;
        if (left < 8) left = 8;
        if (top + r.height > window.innerHeight - 8) top = Math.max(8, y - r.height);
        setPos({ left, top });
    }, [x, y, alignRight, stack.length]);

    return createPortal(
        <div ref={ref} className={s.menu} style={pos} role="menu">
            {stack.length > 0 && (
                <button type="button" className={`${s.item} ${s.back}`} onClick={() => setStack((st) => st.slice(0, -1))}>
                    <span className={s.icon}>
                        <ArrowLeft size={18} />
                    </span>
                    {stack[stack.length - 1].title}
                </button>
            )}
            {current.map((entry, i) => {
                if (!entry) return null;
                if ("divider" in entry) return <div key={`d${i}`} className={s.divider} />;
                return (
                    <button
                        key={`${entry.label}-${i}`}
                        type="button"
                        role="menuitem"
                        className={`${s.item} ${entry.danger ? s.danger : ""}`}
                        onClick={() => {
                            if (entry.submenu) {
                                setStack((st) => [...st, { title: entry.label, items: entry.submenu! }]);
                                return;
                            }
                            onClose();
                            entry.onClick?.();
                        }}
                    >
                        {entry.icon && <span className={s.icon}>{entry.icon}</span>}
                        {entry.label}
                    </button>
                );
            })}
        </div>,
        document.body,
    );
}
