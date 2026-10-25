import React, { useState } from "react";
import { CalendarDays, MessageSquare, X } from "../../constants/icons";
import {
    StoryPointBadge,
    WorkItemTypeBadge,
    BlockerBadge,
} from "../../components/agile/AgilePickers";
import { PRIORITIES, type PriorityOption } from "./constants";
import { currentStatusOption, statusOptions } from "./taskStatus";
import { formatDueDate, formatRelativeTime, isDueOverdue, stripHtml, getAvatarUrl } from "./utils";
import { getLocalToday } from "../../api/client";
import IssueKey from "./IssueKey";
import { useCardDensity } from "./TaskContext";
import s from "./BacklogTab.module.css";

function getPriority(p: string | undefined): PriorityOption {
    return PRIORITIES.find((pr) => pr.value === p) || PRIORITIES[1];
}

interface BacklogCardProps {
    task: any;
    workflowStates: any;
    scheduleTaskId: number | string | null;
    scheduleDate: string;
    setScheduleTaskId: (v: number | string | null) => void;
    setScheduleDate: (v: string) => void;
    onOpenDetail: (task: any) => void;
    onScheduleTask: (id: number | string, title: string) => void;
    /** Manual ordering: drag, keyboard and touch all route through here. */
    reorder?: {
        draggingId: number | string | null;
        overId: number | string | null;
        onKeyDown: (event: React.KeyboardEvent, taskId: number | string) => void;
        onDragStart: (taskId: number | string) => void;
        onDragOver: (taskId: number | string) => void;
        onDrop: (taskId: number | string) => void;
        onTouchStart?: (event: React.TouchEvent, taskId: number | string) => void;
        onTouchMove?: (event: React.TouchEvent) => void;
        onTouchEnd?: () => void;
    };
    /** Patch one field without opening the detail view. */
    onInlineEdit?: (task: any, patch: Record<string, unknown>) => Promise<void> | void;
    /** Multi-select for bulk actions. */
    selection?: {
        isSelected: (id: number | string) => boolean;
        toggle: (id: number | string) => void;
    };
    /** "Updated by <name>" flash after a realtime delta. Non-blocking. */
    attribution?: { name: string } | null;
}

/** One backlog row. Extracted so the tab stays within the file-size ratchet. */
export default function BacklogCard({
    task,
    workflowStates,
    scheduleTaskId,
    scheduleDate,
    setScheduleTaskId,
    setScheduleDate,
    onOpenDetail,
    onScheduleTask,
    reorder,
    onInlineEdit,
    selection,
    attribution,
}: BacklogCardProps) {
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(task.title ?? "");
    // Compact keeps key, title and points; comfortable adds assignee, priority,
    // status, labels and the description preview.
    const compact = useCardDensity() === "compact";
    const pri = getPriority(task.priority);
    const dueFmt = formatDueDate(task.due_date);
    const overdue = isDueOverdue(task.due_date) && !task.completed_at;
    const colInfo =
        currentStatusOption(task, workflowStates, statusOptions(workflowStates)) ||
        statusOptions(workflowStates)[0];
    const descPreview = stripHtml(task.description);

    return (
        <div
            className={`${s["backlog-card"]} ${s.clickable} ${compact ? s["backlog-card-compact"] : ""} ${task.completed_at ? s["backlog-card-done"] : ""} ${reorder?.draggingId === task.id ? s["backlog-card-dragging"] : ""} ${reorder?.overId === task.id ? s["backlog-card-over"] : ""}`}
            draggable={Boolean(reorder)}
            onDragStart={() => reorder?.onDragStart(task.id)}
            onDragOver={(e) => {
                if (!reorder) return;
                e.preventDefault();
                reorder.onDragOver(task.id);
            }}
            onDrop={(e) => {
                if (!reorder) return;
                e.preventDefault();
                reorder.onDrop(task.id);
            }}
            tabIndex={reorder ? 0 : undefined}
            role={reorder ? "listitem" : undefined}
            aria-roledescription={reorder ? "sortable backlog item" : undefined}
            aria-grabbed={reorder ? reorder.draggingId === task.id : undefined}
            data-task-id={reorder ? String(task.id) : undefined}
            onKeyDown={(e) => reorder?.onKeyDown(e, task.id)}
            onTouchStart={(e) => reorder?.onTouchStart?.(e, task.id)}
            onTouchMove={(e) => reorder?.onTouchMove?.(e)}
            onTouchEnd={() => reorder?.onTouchEnd?.()}
            onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest(`.${s["backlog-actions"]}`)) return;
                onOpenDetail(task);
            }}
        >
            <div
                className={s["backlog-priority-bar"]}
                style={{ "--pri-color": pri.color } as React.CSSProperties}
            />
            <div className={s["backlog-card-body"]}>
                <div className={s["backlog-card-header"]}>
                    {selection && (
                        <input
                            type="checkbox"
                            className={s["backlog-select"]}
                            checked={selection.isSelected(task.id)}
                            aria-label={`Select ${task.title}`}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => selection.toggle(task.id)}
                        />
                    )}
                    <span className={s["backlog-ticket-id"]}>
                        <IssueKey task={task} />
                    </span>
                    {!compact && (
                        <span
                            className={s["backlog-status-badge"]}
                            style={
                                {
                                    "--badge-bg": colInfo.color + "20",
                                    "--badge-color": colInfo.color,
                                } as React.CSSProperties
                            }
                        >
                            {colInfo.icon ? `${colInfo.icon} ` : ""}
                            {colInfo.label}
                        </span>
                    )}
                    {!compact && (
                        <span
                            className={s["task-priority-badge"]}
                            style={
                                {
                                    "--badge-bg": pri.color + "20",
                                    "--badge-color": pri.color,
                                } as React.CSSProperties
                            }
                        >
                            {pri.icon} {pri.label}
                        </span>
                    )}
                    {!compact && <WorkItemTypeBadge value={task.work_item_type_id} />}
                    {!compact && task.parent_task_id && (
                        <span className={s["epic-indicator"]} title="Part of an epic">
                            Epic
                        </span>
                    )}
                    <StoryPointBadge value={task.story_points} />
                    {!compact && <BlockerBadge task={task} />}
                    {!compact &&
                        task.labels &&
                        task.labels.length > 0 &&
                        task.labels.map((l: any) => (
                            <span
                                key={l.id}
                                className={s["label-pill"]}
                                style={{ "--label-color": l.color } as React.CSSProperties}
                            >
                                {l.name}
                            </span>
                        ))}
                </div>
                <span className={s["backlog-card-title"]}>
                    {editingTitle ? (
                        <input
                            className={s["backlog-inline-input"]}
                            value={titleDraft}
                            autoFocus
                            aria-label="Ticket title"
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onBlur={() => {
                                setEditingTitle(false);
                                const next = titleDraft.trim();
                                if (next && next !== task.title) {
                                    void onInlineEdit?.(task, { title: next });
                                } else {
                                    setTitleDraft(task.title ?? "");
                                }
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    (event.target as HTMLInputElement).blur();
                                }
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setTitleDraft(task.title ?? "");
                                    setEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <span
                            onDoubleClick={(event) => {
                                if (!onInlineEdit) return;
                                event.stopPropagation();
                                setEditingTitle(true);
                            }}
                            title={onInlineEdit ? "Double-click to edit" : undefined}
                        >
                            {task.title}
                        </span>
                    )}
                </span>
                {!compact && descPreview && (
                    <div className={s["backlog-desc-preview"]}>{descPreview}</div>
                )}
                <div className={s["backlog-card-footer"]}>
                    {!compact && task.assignee && (
                        <span className={s["backlog-meta-chip"]}>
                            {task.assignee.avatar ? (
                                <img
                                    src={getAvatarUrl(task.assignee.avatar)}
                                    alt=""
                                    className={s["backlog-meta-avatar"]}
                                />
                            ) : (
                                <span className={s["backlog-meta-avatar-placeholder"]}>
                                    {(
                                        task.assignee.full_name ||
                                        task.assignee.username ||
                                        "?"
                                    )[0].toUpperCase()}
                                </span>
                            )}
                            {task.assignee.full_name || task.assignee.username}
                        </span>
                    )}
                    {!compact && dueFmt && (
                        <span
                            className={`${s["backlog-meta-chip"]} ${overdue ? s["overdue"] : ""}`}
                        >
                            <CalendarDays
                                size={11}
                                style={{ marginRight: 3, verticalAlign: "middle" }}
                            />
                            {dueFmt}
                        </span>
                    )}
                    {!compact && task.comment_count > 0 && (
                        <span className={s["backlog-meta-chip"]}>
                            <MessageSquare
                                size={11}
                                style={{ marginRight: 3, verticalAlign: "middle" }}
                            />
                            {task.comment_count}
                        </span>
                    )}
                    {!compact && (
                        <span className={s["backlog-meta-time"]}>
                            {formatRelativeTime(task.created_at)}
                        </span>
                    )}
                    {attribution && (
                        <span className={s["backlog-attribution"]} role="status">
                            Updated by {attribution.name}
                        </span>
                    )}
                    <div className={s["backlog-actions"]}>
                        {scheduleTaskId === task.id ? (
                            <div className={s["schedule-popover"]}>
                                <input
                                    type="date"
                                    value={scheduleDate}
                                    onChange={(e) => setScheduleDate(e.target.value)}
                                    className={s["date-input"]}
                                />
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => onScheduleTask(task.id, task.title)}
                                >
                                    Go
                                </button>
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => setScheduleTaskId(null)}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => {
                                    setScheduleTaskId(task.id);
                                    setScheduleDate(getLocalToday());
                                }}
                                title="Schedule to a day"
                            >
                                <CalendarDays
                                    size={13}
                                    style={{ marginRight: 4, verticalAlign: "middle" }}
                                />
                                Schedule
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
