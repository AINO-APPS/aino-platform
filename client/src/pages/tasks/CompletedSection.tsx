import React from "react";
import { ChevronDown, ChevronRight, CheckCircle2 } from "../../constants/icons";
import s from "./CompletedSection.module.css";

interface CompletedSectionProps {
    count: number;
    tasks: any[];
    open: boolean;
    loading: boolean;
    /** True once the user asked for every completed item, not just the window. */
    showingAll: boolean;
    onToggle: () => void;
    onShowAll: () => void;
    onOpenDetail: (task: any) => void;
    formatDate: (value: string | null | undefined) => string | null;
}

/**
 * The collapsed Completed section at the bottom of the backlog.
 *
 * The count renders from the first backlog response, so the section is
 * discoverable while collapsed without a second request. Expanding loads the
 * recent window; "View all completed" is the escape hatch to older work.
 */
export default function CompletedSection({
    count,
    tasks,
    open,
    loading,
    showingAll,
    onToggle,
    onShowAll,
    onOpenDetail,
    formatDate,
}: CompletedSectionProps) {
    if (count === 0 && tasks.length === 0) return null;

    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <section className={s["completed-section"]} aria-label="Completed tasks">
            <button
                type="button"
                className={s["completed-toggle"]}
                onClick={onToggle}
                aria-expanded={open}
                // Only reference the list while it exists: `aria-controls` must
                // point at a real element, and the list is not rendered closed.
                {...(open ? { "aria-controls": "backlog-completed-list" } : {})}
            >
                <Chevron size={16} aria-hidden="true" />
                <CheckCircle2 size={16} aria-hidden="true" />
                <span className={s["completed-title"]}>Completed</span>
                <span className={s["completed-count"]}>({count})</span>
            </button>

            {open && (
                <div id="backlog-completed-list" className={s["completed-list"]}>
                    {loading && <div className={s["completed-loading"]}>Loading completed work…</div>}

                    {!loading && tasks.length === 0 && (
                        <div className={s["completed-empty"]}>
                            No completed work in this window.
                        </div>
                    )}

                    {tasks.map((task) => (
                        <button
                            key={task.id}
                            type="button"
                            className={s["completed-row"]}
                            onClick={() => onOpenDetail(task)}
                        >
                            <span className={s["completed-key"]}>
                                {task.issue_key || `#${task.id}`}
                            </span>
                            <span className={s["completed-row-title"]}>{task.title}</span>
                            <span className={s["completed-date"]}>
                                {formatDate(task.completed_at)}
                            </span>
                        </button>
                    ))}

                    {!showingAll && (
                        <button
                            type="button"
                            className={s["completed-show-all"]}
                            onClick={onShowAll}
                        >
                            View all completed
                        </button>
                    )}
                </div>
            )}
        </section>
    );
}
