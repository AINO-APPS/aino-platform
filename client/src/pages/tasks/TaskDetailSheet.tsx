import React, { useEffect, useRef } from "react";
import s from "./TaskDetailSheet.module.css";

interface TaskDetailSheetProps {
    open: boolean;
    title: string;
    onClose: () => void;
    /** Badges shown before the title (priority, status, issue key…). */
    badges?: React.ReactNode;
    /** Controls shown after the title (edit, save, delete…). */
    actions?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * The task detail surface.
 *
 * Full-screen on every viewport, so the deep view has the whole canvas and the
 * layout does not change shape between devices. Escape closes it, focus moves
 * in on open and returns on close, and there is no keyboard trap: Tab can
 * leave the sheet.
 */
export default function TaskDetailSheet({
    open,
    title,
    onClose,
    badges,
    actions,
    children,
}: TaskDetailSheetProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const previouslyFocused = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!open) return;
        previouslyFocused.current = document.activeElement as HTMLElement | null;
        panelRef.current?.focus();

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.stopPropagation();
                onClose();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => {
            document.removeEventListener("keydown", onKeyDown);
            previouslyFocused.current?.focus?.();
        };
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className={s["backdrop"]} role="presentation" onClick={onClose}>
            <div
                ref={panelRef}
                className={s["sheet"]}
                role="dialog"
                aria-modal="false"
                aria-label={title}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={s["sheet-header"]}>
                    <div className={s["sheet-heading"]}>
                        {badges}
                        <h2 className={s["sheet-title"]}>{title}</h2>
                    </div>
                    <div className={s["sheet-actions"]}>
                        {actions}
                        <button
                            type="button"
                            className={s["sheet-close"]}
                            onClick={onClose}
                            aria-label="Close task detail"
                        >
                            ×
                        </button>
                    </div>
                </header>
                <div className={s["sheet-body"]}>{children}</div>
            </div>
        </div>
    );
}
