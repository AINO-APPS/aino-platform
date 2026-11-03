import React, { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, XCircle } from "../../constants/icons";
import { getTasks } from "../../api/tasks";
import useRealtimeEvent from "../../hooks/useRealtimeEvent";
import type { Task } from "../../types";
import { writeError } from "./ticketCapabilities";
import TicketHistoryRow from "./TicketHistoryRow";
import s from "./CompletedSection.module.css";

interface SprintCancelledSectionProps {
    sprintId: number | string | null | undefined;
    /** The board's team scope (`team_id` / `unassigned`), so the list matches the columns. */
    scopeParams?: Record<string, unknown>;
    boardTasks?: readonly unknown[];
    onOpenDetail: (task: Task) => void;
}

/**
 * The sprint's cancelled tickets, collapsed under the board.
 *
 * The board endpoint leaves cancelled out — it is an outcome, not a column — so
 * without this a cancelled ticket simply vanished. It is history: no drag, no
 * actions, just a way back into the ticket.
 */
export default function SprintCancelledSection({ sprintId, scopeParams, boardTasks, onOpenDetail }: SprintCancelledSectionProps) {
    const teamId = scopeParams?.team_id;
    const unassigned = scopeParams?.unassigned;
    const scopeKey = JSON.stringify([sprintId, teamId, unassigned]);
    const [result, setResult] = useState<{ scopeKey: string; tasks: Task[]; error: string }>({
        scopeKey, tasks: [], error: "",
    });
    const [open, setOpen] = useState(false);
    const request = useRef(0);
    const tasks = result.scopeKey === scopeKey ? result.tasks : [];
    const error = result.scopeKey === scopeKey ? result.error : "";

    const load = useCallback(async () => {
        const id = ++request.current;
        if (!sprintId) {
            setResult({ scopeKey, tasks: [], error: "" });
            return;
        }
        try {
            const res = await getTasks(undefined, {
                ...(teamId != null ? { team_id: teamId } : {}),
                ...(unassigned != null ? { unassigned } : {}),
                sprint_id: sprintId, status: "cancelled",
            });
            if (id !== request.current) return;
            const rows = ((res.data as { tasks: Task[] }).tasks).filter((task) => task.workflow_state_key === "cancelled");
            setResult({ scopeKey, tasks: rows, error: "" });
        } catch (failure) {
            if (id !== request.current) return;
            setResult((previous) => ({
                scopeKey,
                tasks: previous.scopeKey === scopeKey ? previous.tasks : [],
                error: writeError(failure, "Could not load cancelled tickets."),
            }));
        }
    }, [sprintId, teamId, unassigned, scopeKey]);

    useEffect(() => {
        setOpen(false);
    }, [scopeKey]);

    useEffect(() => {
        void load();
        return () => { request.current++; };
    }, [load, boardTasks]);

    useRealtimeEvent(["task_updated", "task_assigned"], () => { void load(); });

    if (tasks.length === 0 && !error) return null;
    const Chevron = open ? ChevronDown : ChevronRight;

    return (
        <section className={s["completed-section"]} aria-label="Cancelled tickets">
            {error && (
                <div role="alert">
                    {error} <button type="button" onClick={() => { void load(); }}>Retry</button>
                </div>
            )}
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
                        <TicketHistoryRow key={task.id} task={task} onOpenDetail={onOpenDetail} />
                    ))}
                </div>
            )}
        </section>
    );
}
