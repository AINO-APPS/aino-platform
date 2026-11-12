import React from "react";
import { XCircle } from "../../constants/icons";
import type { Task } from "../../types";
import s from "./CompletedSection.module.css";

type HistoryTicket = Pick<Task, "id" | "title"> &
    Partial<Pick<Task, "ticket_key" | "workflow_state_key" | "completed_at">>;

export default function TicketHistoryRow<T extends HistoryTicket>({
    task, onOpenDetail, formatDate,
}: {
    task: T;
    onOpenDetail: (task: T) => void;
    formatDate?: (value: string | null | undefined) => string | null;
}) {
    return (
        <button type="button" className={s["completed-row"]} onClick={() => onOpenDetail(task)}>
            <span className={s["completed-key"]}>{task.ticket_key || `#${task.id}`}</span>
            <span className={s["completed-row-title"]}>{task.title}</span>
            <span className={s["completed-date"]}>
                {task.workflow_state_key === "cancelled" && (
                    <span className={s["completed-cancelled"]}>
                        <XCircle size={12} aria-hidden="true" /> Cancelled
                    </span>
                )}
                {formatDate?.(task.completed_at)}
            </span>
        </button>
    );
}
