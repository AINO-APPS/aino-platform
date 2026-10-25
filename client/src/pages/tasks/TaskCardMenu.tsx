import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "../../constants/icons";
import s from "./TaskCardMenu.module.css";

export interface TaskCardMenuItem {
    label: string;
    onSelect: () => void;
}

interface TaskCardMenuProps {
    /** Describes the task the menu belongs to, e.g. "Actions for PAY-142". */
    label: string;
    items: TaskCardMenuItem[];
}

const MENU_WIDTH = 200;
const MENU_GAP = 4;

/**
 * The card's secondary actions.
 *
 * Cards used to show a row of competing buttons. Everything that is not the
 * card's primary action (open the task) lives here instead, behind one
 * consistently placed control. The menu is a real menu: Escape closes it and
 * returns focus to the trigger, and arrow keys move between items.
 *
 * It renders in a portal with fixed positioning because the board and the
 * backlog list are scroll containers — an absolutely positioned menu inside
 * them is clipped at the container edge, which cut off the last card's menu.
 */
export default function TaskCardMenu({ label, items }: TaskCardMenuProps) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        if (!open) return;
        const place = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const left = Math.max(
                8,
                Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
            );
            const top = Math.min(rect.bottom + MENU_GAP, window.innerHeight - 8);
            setPosition({ top, left });
        };
        place();
        window.addEventListener("scroll", place, true);
        window.addEventListener("resize", place);
        return () => {
            window.removeEventListener("scroll", place, true);
            window.removeEventListener("resize", place);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const onPointerDown = (event: PointerEvent) => {
            const target = event.target as Node;
            if (triggerRef.current?.contains(target)) return;
            if (menuRef.current?.contains(target)) return;
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
            }
        };

        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [open]);

    useEffect(() => {
        if (open) menuRef.current?.querySelector("button")?.focus();
    }, [open]);

    const move = (delta: number) => {
        const buttons = Array.from(menuRef.current?.querySelectorAll("button") ?? []);
        if (buttons.length === 0) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = (index + delta + buttons.length) % buttons.length;
        buttons[next].focus();
    };

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={s["menu-trigger"]}
                aria-label={label}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={(event) => {
                    event.stopPropagation();
                    setOpen((value) => !value);
                }}
            >
                <MoreHorizontal size={16} aria-hidden="true" />
            </button>
            {open &&
                position &&
                createPortal(
                    <div
                        ref={menuRef}
                        className={s["menu"]}
                        role="menu"
                        aria-label={label}
                        style={{ top: position.top, left: position.left }}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                            if (event.key === "ArrowDown") {
                                event.preventDefault();
                                move(1);
                            }
                            if (event.key === "ArrowUp") {
                                event.preventDefault();
                                move(-1);
                            }
                        }}
                    >
                        {items.map((item) => (
                            <button
                                key={item.label}
                                type="button"
                                role="menuitem"
                                className={s["menu-item"]}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setOpen(false);
                                    item.onSelect();
                                }}
                            >
                                {item.label}
                            </button>
                        ))}
                    </div>,
                    document.body,
                )}
        </>
    );
}
