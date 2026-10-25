import React from "react";
import {
    Plus as ActivityPlus,
    ArrowLeftRight as ActivitySwap,
    Edit as ActivityEdit,
    Calendar as ActivityCalendar,
    MessageSquare as ActivityMessage,
    Trash2 as ActivityDelete,
    type IconComponent,
} from "../../constants/icons";
import s from "./TaskDetailModal.module.css";

interface HistoryEntry {
    id: number | string;
    action: string;
    field?: string | null;
    old_value?: string | null;
    new_value?: string | null;
    full_name?: string | null;
    username?: string | null;
    created_at: string;
}

const ACTION_ICONS: Record<string, IconComponent> = {
    created: ActivityPlus,
    status_change: ActivitySwap,
    updated: ActivityEdit,
    scheduled: ActivityCalendar,
    unscheduled: ActivityCalendar,
    comment_added: ActivityMessage,
    comment_edited: ActivityEdit,
    comment_deleted: ActivityDelete,
    deleted: ActivityDelete,
};

const FIELD_LABELS: Record<string, string> = {
    status: "status",
    title: "title",
    description: "description",
    priority: "priority",
    assigned_to: "assignee",
    due_date: "due date",
    planned_date: "planned date",
    date: "schedule",
    labels: "labels",
    story_points: "story points",
    work_item_type: "work item type",
    sprint: "sprint",
    parent: "parent task",
    is_blocked: "blocked status",
    project: "project",
    logged_minutes: "logged time",
};

/** The task's change log, rendered as a readable activity feed. */
export default function TaskHistoryList({ history }: { history: HistoryEntry[] }) {
    if (history.length === 0) {
        return <div className={s["history-empty"]}>No history recorded yet.</div>;
    }

    return (
        <div className={s["history-list"]}>
            {history.map((h) => {
                const ActivityIcon = ACTION_ICONS[h.action] || ActivityEdit;
                return (
                    <div key={h.id} className={s["history-item"]}>
                        <span className={s["history-icon"]}>
                            <ActivityIcon size={14} />
                        </span>
                        <div className={s["history-content"]}>
                            <span className={s["history-actor"]}>
                                {h.full_name || h.username}
                            </span>{" "}
                            <span className={s["history-action"]}>
                                {describe(h, s)}
                            </span>
                        </div>
                        <span className={s["history-time"]}>
                            {new Date(h.created_at).toLocaleString()}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function describe(h: HistoryEntry, styles: Record<string, string>): React.ReactNode {
    const old = <span className={styles["history-old"]}>{h.old_value || "—"}</span>;
    const next = <span className={styles["history-new"]}>{h.new_value || "—"}</span>;

    switch (h.action) {
        case "created":
            if (h.field === "date" && h.old_value) {
                return <>carried forward from {old}</>;
            }
            return "created this task";
        case "comment_added":
            return "added a comment";
        case "comment_edited":
            return "edited a comment";
        case "comment_deleted":
            return "deleted a comment";
        case "status_change":
            return <>changed status from {old} → {next}</>;
        case "scheduled":
            return <>scheduled to {next}</>;
        case "unscheduled":
            return "moved to backlog";
        case "time_logged":
            return <>logged time: {old} → {next} minutes</>;
        case "updated":
            if (!h.field) return "updated this task";
            if (h.field === "description") {
                return `updated ${FIELD_LABELS[h.field] || h.field}`;
            }
            return (
                <>
                    {`updated ${FIELD_LABELS[h.field] || h.field}: `}
                    {old}
                    {" → "}
                    {next}
                </>
            );
        default:
            return h.action;
    }
}
