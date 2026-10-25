import React from "react";
import s from "./ShortcutHelp.module.css";

export interface Shortcut {
    keys: string;
    action: string;
}

/**
 * The documented shortcut set.
 *
 * Kept as data so the help overlay and the tests read the same list — a
 * shortcut that ships without appearing here is a bug.
 */
export const TASK_SHORTCUTS: Shortcut[] = [
    { keys: "Ctrl/Cmd + K", action: "Command palette" },
    { keys: "c", action: "New task" },
    { keys: "/", action: "Focus filter/search" },
    { keys: "j / k", action: "Next / previous row or card" },
    { keys: "Enter", action: "Open focused item" },
    { keys: "Space", action: "Lift / drop during keyboard drag" },
    { keys: "1–9", action: "Move focused card to column N" },
    { keys: "x", action: "Toggle selection" },
    { keys: "Ctrl/Cmd + Z", action: "Undo last destructive action" },
    { keys: "?", action: "Shortcut help overlay" },
    { keys: "Esc", action: "Close the palette, sheet or overlay" },
];

interface ShortcutHelpProps {
    open: boolean;
    onClose: () => void;
}

/** The `?` overlay: the complete shortcut set, reachable and dismissible by keyboard. */
export default function ShortcutHelp({ open, onClose }: ShortcutHelpProps) {
    if (!open) return null;

    return (
        <div className={s["backdrop"]} role="presentation" onClick={onClose}>
            <div
                className={s["panel"]}
                role="dialog"
                aria-modal="false"
                aria-label="Keyboard shortcuts"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={s["header"]}>
                    <h2 className={s["title"]}>Keyboard shortcuts</h2>
                    <button
                        type="button"
                        className={s["close"]}
                        onClick={onClose}
                        aria-label="Close shortcut help"
                    >
                        ×
                    </button>
                </header>
                <dl className={s["list"]}>
                    {TASK_SHORTCUTS.map((shortcut) => (
                        <div key={shortcut.keys} className={s["row"]}>
                            <dt>
                                <kbd className={s["keys"]}>{shortcut.keys}</kbd>
                            </dt>
                            <dd className={s["action"]}>{shortcut.action}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </div>
    );
}
