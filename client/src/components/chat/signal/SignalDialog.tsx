import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import s from "./SignalDialog.module.css";

export interface SignalDialogAction {
    label: string;
    onClick: () => void;
    danger?: boolean;
    primary?: boolean;
    disabled?: boolean;
}

interface Props {
    title: string;
    message?: ReactNode;
    children?: ReactNode;
    actions: SignalDialogAction[];
    /** Stack actions vertically (Android delete dialog). */
    stacked?: boolean;
    onDismiss: () => void;
}

/** Android `AlertDialog` look: rounded surface, title, body, right-aligned text buttons. */
export default function SignalDialog({ title, message, children, actions, stacked, onDismiss }: Props) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onDismiss();
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [onDismiss]);

    return createPortal(
        <div className={s.scrim} onClick={onDismiss}>
            <div className={s.dialog} role="alertdialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
                <h3 className={s.title}>{title}</h3>
                {message && <div className={s.message}>{message}</div>}
                {children}
                <div className={`${s.actions} ${stacked ? s.stacked : ""}`}>
                    {actions.map((a, i) => (
                        <button
                            key={a.label}
                            type="button"
                            className={`${s.btn} ${a.danger ? s.danger : ""} ${a.primary ? s.primary : ""}`}
                            onClick={a.onClick}
                            disabled={a.disabled}
                            autoFocus={i === actions.length - 1}
                        >
                            {a.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>,
        document.body,
    );
}
