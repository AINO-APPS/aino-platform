import React from "react";
import s from "./AsyncSection.module.css";

interface AsyncSectionProps {
    /** What is loading, e.g. "backlog". Used in the accessible names. */
    label: string;
    loading?: boolean;
    error?: string | null;
    /** True while the section already has data to keep on screen. */
    hasData?: boolean;
    onRetry?: () => void;
    children: React.ReactNode;
}

function RetryButton({ onClick }: { onClick: () => void }) {
    return (
        <button type="button" className={s["retry"]} onClick={() => onClick()}>
            Retry
        </button>
    );
}

const TITLE = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/**
 * The shared async contract for a data-backed section.
 *
 * - first load → a skeleton, never an empty-state message;
 * - failure without data → the error and a Retry action;
 * - refetch → the last good data stays on screen, with a quiet stale notice.
 *
 * Every Plan surface uses this so "loading", "failed" and "empty" are never
 * mistaken for one another.
 */
export default function AsyncSection({
    label,
    loading = false,
    error = null,
    hasData = false,
    onRetry,
    children,
}: AsyncSectionProps) {
    if (loading && !hasData) {
        return (
            <div
                className={s["skeleton"]}
                role="status"
                aria-busy="true"
                aria-label={`Loading ${label.toLowerCase()}`}
            >
                {Array.from({ length: 4 }).map((_, index) => (
                    <div className={s["skeleton-row"]} key={index} aria-hidden="true">
                        <span className={s["skeleton-bar"]} />
                        <span className={`${s["skeleton-bar"]} ${s["skeleton-title"]}`} />
                        <span className={`${s["skeleton-bar"]} ${s["skeleton-tail"]}`} />
                    </div>
                ))}
            </div>
        );
    }

    if (error && !hasData) {
        return (
            <div className={s["failure"]} role="alert">
                <span>{error}</span>
                {onRetry && <RetryButton onClick={onRetry} />}
            </div>
        );
    }

    return (
        <>
            {error && hasData && (
                <div
                    className={s["stale"]}
                    role="status"
                    aria-label={`${TITLE(label)} out of date`}
                >
                    <span>{error}</span>
                    {onRetry && <RetryButton onClick={onRetry} />}
                </div>
            )}
            {children}
        </>
    );
}
