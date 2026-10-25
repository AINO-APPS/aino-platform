import React from "react";
import { X } from "../../constants/icons";
import s from "./BulkActionBar.module.css";

interface BulkActionBarProps {
    count: number;
    applying: boolean;
    sprints: Array<{ id: number | string; name: string }>;
    statuses: Array<{ key: string; label: string }>;
    users: Array<{ id: number | string; full_name?: string; username?: string }>;
    onMoveToSprint: (sprintId: number | string | null) => void;
    onStatus: (status: string) => void;
    onAssign: (userId: number | string | null) => void;
    onDelete: () => void;
    onClear: () => void;
}

/**
 * The selection bar.
 *
 * Shows the count, offers the four bulk actions, and clears in one action.
 * Every control is a real button, so the bar is operable by keyboard.
 */
export default function BulkActionBar({
    count,
    applying,
    sprints,
    statuses,
    users,
    onMoveToSprint,
    onStatus,
    onAssign,
    onDelete,
    onClear,
}: BulkActionBarProps) {
    if (count === 0) return null;

    return (
        <div className={s["bulk-bar"]} role="region" aria-label="Bulk actions">
            <span className={s["bulk-count"]} aria-live="polite">
                {count} selected
            </span>

            <label className={s["bulk-field"]}>
                <span className={s["bulk-label"]}>Sprint</span>
                <select
                    className={s["bulk-select"]}
                    disabled={applying}
                    defaultValue=""
                    onChange={(event) => {
                        const value = event.target.value;
                        // "backlog" is a distinct choice from the placeholder, so
                        // moving work out of a sprint is reachable from the bar.
                        if (value === "") return;
                        onMoveToSprint(value === "backlog" ? null : value);
                        event.target.value = "";
                    }}
                >
                    <option value="">Move to…</option>
                    <option value="backlog">Backlog</option>
                    {sprints.map((sprint) => (
                        <option key={sprint.id} value={sprint.id}>
                            {sprint.name}
                        </option>
                    ))}
                </select>
            </label>

            <label className={s["bulk-field"]}>
                <span className={s["bulk-label"]}>Status</span>
                <select
                    className={s["bulk-select"]}
                    disabled={applying}
                    defaultValue=""
                    onChange={(event) => {
                        if (event.target.value) onStatus(event.target.value);
                        event.target.value = "";
                    }}
                >
                    <option value="">Set status…</option>
                    {statuses.map((status) => (
                        <option key={status.key} value={status.key}>
                            {status.label}
                        </option>
                    ))}
                </select>
            </label>

            <label className={s["bulk-field"]}>
                <span className={s["bulk-label"]}>Assignee</span>
                <select
                    className={s["bulk-select"]}
                    disabled={applying}
                    defaultValue=""
                    onChange={(event) => {
                        const value = event.target.value;
                        if (value === "") return;
                        onAssign(value === "unassigned" ? null : value);
                        event.target.value = "";
                    }}
                >
                    <option value="">Assign to…</option>
                    <option value="unassigned">Unassigned</option>
                    {users.map((user) => (
                        <option key={user.id} value={user.id}>
                            {user.full_name || user.username}
                        </option>
                    ))}
                </select>
            </label>

            <button
                type="button"
                className={s["bulk-delete"]}
                disabled={applying}
                onClick={onDelete}
            >
                Delete
            </button>

            <button
                type="button"
                className={s["bulk-clear"]}
                onClick={onClear}
                aria-label="Clear selection"
            >
                <X size={14} aria-hidden="true" /> Clear
            </button>
        </div>
    );
}
