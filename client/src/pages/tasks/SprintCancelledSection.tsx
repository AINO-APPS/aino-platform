import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, XCircle } from "../../constants/icons";
import { getTasks } from "../../api/tasks";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import s from "./CompletedSection.module.css";

interface SprintCancelledSectionProps {
    sprintId: number | string | null | undefined;
    /** The board's team scope (`team_id` / `unassigned`), so the list matches the columns. */
    scopeParams?: Record<string, unknown>;
    onOpenDetail: (task: any) => void;
}

/**
 * The sprint's cancelled tickets, collapsed under the board.
 *
 * The board endpoint leaves cancelled out — it is an outcome, not a column — so
 * without this a cancelled ticket simply vanished. It is history: no drag, no
 * actions, just a way back into the ticket.
 */
export default function SprintCancelledSection({ sprintId, scopeParams, onOpenDetail }: SprintCancelledSectionProps) {
    const [tasks, setTasks] = useState<any[]>([]);
    const [open, setOpen] = useState(false);
    const request = useRef(0);
    const scopeKey = JSON.stringify(scopeParams ?? {});

    const load = useCallback(async () => {
        const id = ++request.current;
        if (!sprintId) {
            setTasks([]);
            return;
        }
        try {
            const res = await getTasks(undefined, { ...JSON.parse(scopeKey), sprint_id: sprintId, status: "cancelled" });
            if (id !== request.current) return;
            const rows = ((res.data as { tasks?: any[] }).tasks || []).filter((task) => task.workflow_state_key === "cancelled");
            setTasks(rows);
        } catch {
            // Keep the rows already shown: a failed refresh must not erase history.
        }
    }, [sprintId, scopeKey]);

    useEffect(() => {
        setOpen(false);
        void load();
    }, [load]);

    useRealtimeEvent(["task_updated", "task_assigned"], () => { void load(); });

    if (tasks.length === 0) return null;
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <section className={s["completed-section"]} aria-label="Cancelled tickets">
            <button
                type="button"
                className={s["completed-toggle"]}
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                {...(open ? { "aria-controls": "sprint-cancelled-list" } : {})}
            >
                <Chevron size={16} aria-hidden="true" />
                <XCircle size={16} aria-hidden="true" />
                <span className={s["completed-title"]}>Cancelled</span>
                <span className={s["completed-count"]}>({tasks.length})</span>
            </button>
            {open && (
                <div id="sprint-cancelled-list" className={s["completed-list"]}>
                    {tasks.map((task) => (
                        <button key={task.id} type="button" className={s["completed-row"]} onClick={() => onOpenDetail(task)}>
                            <span className={s["completed-key"]}>{task.issue_key || `#${task.id}`}</span>
                            <span className={s["completed-row-title"]}>{task.title}</span>
                            <span className={s["completed-date"]}>
                                <span className={s["completed-cancelled"]}>Cancelled</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
