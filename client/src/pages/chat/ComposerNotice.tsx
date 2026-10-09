import s from "./ComposerNotice.module.css";

/** Replaces the composer when the user can't send (blocked peer, admins-only group). */
export default function ComposerNotice({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
    return (
        <div className={s.notice} role="status">
            <span>{text}</span>
            {action && onAction && (
                <button type="button" className={s.btn} onClick={onAction}>
                    {action}
                </button>
            )}
        </div>
    );
}
