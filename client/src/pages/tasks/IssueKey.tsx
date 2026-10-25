import React, { useCallback, useState } from "react";
import { Check, Copy } from "../../constants/icons";
import s from "./IssueKey.module.css";

interface IssueKeyProps {
    task: { id: number | string; issue_key?: string | null };
    /** Show the copy affordance. */
    copyable?: boolean;
}

/**
 * The canonical PROJ-123 reference.
 *
 * Copying is one action, and the control is a real button so it is reachable
 * by keyboard. A task without a project falls back to its numeric id.
 */
export default function IssueKey({ task, copyable = true }: IssueKeyProps) {
    const [copied, setCopied] = useState(false);
    const key = task.issue_key || `#${task.id}`;

    const copy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(key);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            // Clipboard access can be denied; the key is still visible.
        }
    }, [key]);

    if (!copyable) {
        return <span className={s["issue-key"]}>{key}</span>;
    }

    return (
        <button
            type="button"
            className={s["issue-key-button"]}
            onClick={(event) => {
                event.stopPropagation();
                void copy();
            }}
            title={`Copy ${key}`}
            aria-label={`Copy issue key ${key}`}
        >
            <span className={s["issue-key"]}>{key}</span>
            {copied ? (
                <Check size={11} aria-hidden="true" />
            ) : (
                <Copy size={11} aria-hidden="true" />
            )}
            <span className="sr-only" role="status" aria-live="polite">
                {copied ? "Copied" : ""}
            </span>
        </button>
    );
}
