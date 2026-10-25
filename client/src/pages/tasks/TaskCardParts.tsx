import React, { useState } from "react";
import { CalendarDays, MessageSquare, Ban, Clock, X } from "../../constants/icons";
import { StoryPointBadge, WorkItemTypeBadge } from "../../components/agile/AgilePickers";
import { PRIORITIES, type PriorityOption } from "./constants";
import type { StatusOption } from "./taskStatus";
import { formatDate, formatDueDate, isDueOverdue, getAvatarUrl, stripHtml } from "./utils";
import { getLocalToday } from "../../api/client";
import { addDays } from "./calendar";
import s from "./TaskCard.module.css";

/**
 * The shared Plan card anatomy, used by the board, schedule and backlog cards:
 *
 *   top     type · KEY · (points)              priority
 *   title   up to two lines
 *   footer  status · due · 2 labels (+N)       avatar
 *
 * Comfortable density adds a description preview and the comment count.
 */

export function getPriority(p: string | undefined): PriorityOption {
    return PRIORITIES.find((pr) => pr.value === p) || PRIORITIES[1];
}

/** Three ascending bars; filled bars carry the priority tone. */
export function PriorityBars({ priority }: { priority: string | undefined }) {
    const pri = getPriority(priority);
    const filled = pri.value === "high" ? 3 : pri.value === "medium" ? 2 : 1;
    return (
        <span
            className={s["pri-bars"]}
            role="img"
            aria-label={`${pri.label} priority`}
            title={`${pri.label} priority`}
            style={{ "--pri-color": pri.color } as React.CSSProperties}
        >
            {[0, 1, 2].map((i) => (
                <i key={i} className={i < filled ? s["pri-on"] : undefined} />
            ))}
        </span>
    );
}

export function StatusPill({ status }: { status: StatusOption | undefined }) {
    if (!status) return null;
    return (
        <span
            className={s["status-pill"]}
            style={{ "--status-color": status.color, "--status-ink": status.ink } as React.CSSProperties}
        >
            {status.label}
        </span>
    );
}

export function DueChip({ task }: { task: any }) {
    const due = formatDueDate(task.due_date);
    if (!due) return null;
    const overdue = isDueOverdue(task.due_date) && !task.completed_at;
    return (
        <span
            className={`${s["due-chip"]} ${overdue ? s["due-over"] : ""}`}
            title={overdue ? `Overdue since ${formatDate(task.due_date)}` : `Due ${formatDate(task.due_date)}`}
        >
            {overdue ? <Clock size={12} aria-hidden="true" /> : <CalendarDays size={12} aria-hidden="true" />}
            {overdue ? "Overdue" : due}
        </span>
    );
}

export function CardLabels({ labels }: { labels: any[] | undefined }) {
    const [expanded, setExpanded] = useState(false);
    const all = labels ?? [];
    if (all.length === 0) return null;
    const visible = expanded ? all : all.slice(0, 2);
    const hidden = all.length - visible.length;
    return (
        <span className={s["task-labels"]}>
            {visible.map((l: any) => (
                <span
                    key={l.id}
                    className={s["label-pill"]}
                    style={{ "--label-color": l.color } as React.CSSProperties}
                >
                    {l.name}
                </span>
            ))}
            {hidden > 0 && (
                <button
                    type="button"
                    className={s["label-overflow"]}
                    onClick={(event) => {
                        event.stopPropagation();
                        setExpanded(true);
                    }}
                    aria-label={`Show all ${all.length} labels`}
                >
                    +{hidden}
                </button>
            )}
        </span>
    );
}

export function AssigneeAvatar({ assignee }: { assignee: any }) {
    if (!assignee) return null;
    const name = assignee.full_name || assignee.username || "?";
    const initials = name
        .split(/\s+/)
        .map((part: string) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
    return (
        <span className={s.avatar} title={`Assigned to ${name}`} aria-label={`Assigned to ${name}`} role="img">
            {assignee.avatar ? <img src={getAvatarUrl(assignee.avatar)} alt="" /> : initials}
        </span>
    );
}

export function BlockedFlag({ task, enabled }: { task: any; enabled: boolean }) {
    if (!task.is_blocked || !enabled) return null;
    return (
        <span className={s["task-exception"]} title={task.blocked_reason || "Blocked"}>
            <Ban size={12} aria-hidden="true" /> Blocked
        </span>
    );
}

interface CardBodyProps {
    task: any;
    status: StatusOption | undefined;
    compact: boolean;
    showStatus?: boolean;
    blockersEnabled: boolean;
    /** The key control (copyable chip); rendered in the top line. */
    keySlot: React.ReactNode;
    /** Controls pinned to the top-right (overflow menu). */
    actionsSlot?: React.ReactNode;
    /** Replaces the title text (inline edit). */
    titleSlot?: React.ReactNode;
    onOpenComments?: () => void;
}

/** The card interior shared by every Plan surface. */
export function CardBody({
    task,
    status,
    compact,
    showStatus = true,
    blockersEnabled,
    keySlot,
    actionsSlot,
    titleSlot,
    onOpenComments,
}: CardBodyProps) {
    const description = compact ? "" : stripHtml(task.description || "").trim();
    return (
        <>
            <div className={s["card-top"]}>
                <WorkItemTypeBadge value={task.work_item_type_id || task.work_item_type_key} />
                {keySlot}
                <StoryPointBadge value={task.story_points} />
                {task.parent_task_id && (
                    <span className={s["epic-badge"]} title="Part of an epic">
                        Epic
                    </span>
                )}
                <BlockedFlag task={task} enabled={blockersEnabled} />
                <span className={s.grow} />
                <PriorityBars priority={task.priority} />
                {actionsSlot}
            </div>
            <div className={s["task-title"]}>{titleSlot ?? task.title}</div>
            {description && <div className={s["card-desc"]}>{description}</div>}
            <div className={s["card-foot"]}>
                {showStatus && <StatusPill status={status} />}
                <DueChip task={task} />
                <CardLabels labels={task.labels} />
                <span className={s.grow} />
                {!compact && onOpenComments && (
                    <button
                        type="button"
                        className={s["comment-icon"]}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpenComments();
                        }}
                        aria-label={`${task.comment_count || 0} comments on ${task.issue_key || `#${task.id}`}`}
                    >
                        <MessageSquare size={13} />
                        {task.comment_count > 0 && <span className={s["comment-count"]}>{task.comment_count}</span>}
                    </button>
                )}
                {!compact && !onOpenComments && task.comment_count > 0 && (
                    <span className={s["comment-icon"]}>
                        <MessageSquare size={13} aria-hidden="true" />
                        <span className={s["comment-count"]}>{task.comment_count}</span>
                    </span>
                )}
                <AssigneeAvatar assignee={task.assignee} />
            </div>
        </>
    );
}

function nextMonday(base: string): string {
    const [y, m, d] = base.split("-").map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return addDays(base, ((8 - day) % 7) || 7);
}

interface ScheduleControlProps {
    open: boolean;
    date: string;
    onOpen: () => void;
    onClose: () => void;
    onDateChange: (value: string) => void;
    onConfirm: () => void;
}

/** "Schedule to a day": an org-themed button with quick picks and a date input. */
export function ScheduleControl({ open, date, onOpen, onClose, onDateChange, onConfirm }: ScheduleControlProps) {
    const today = getLocalToday();
    const quick = [
        { label: "Today", value: today },
        { label: "Tomorrow", value: addDays(today, 1) },
        { label: "Next Mon", value: nextMonday(today) },
    ];
    return (
        <span className={s["schedule-wrap"]} onClick={(event) => event.stopPropagation()}>
            <button
                type="button"
                className={s["schedule-btn"]}
                aria-label="Schedule to a day"
                aria-expanded={open}
                title="Schedule to a day"
                onClick={open ? onClose : onOpen}
            >
                <CalendarDays size={13} aria-hidden="true" />
                <span className={s["schedule-btn-text"]}>Schedule</span>
            </button>
            {open && (
                <div className={s["schedule-pop"]} role="dialog" aria-label="Schedule to a day">
                    <div className={s["schedule-pop-head"]}>
                        <span>Schedule to a day</span>
                        <button type="button" className={s["schedule-close"]} aria-label="Close" onClick={onClose}>
                            <X size={14} />
                        </button>
                    </div>
                    <div className={s["schedule-quick"]}>
                        {quick.map((q) => (
                            <button
                                key={q.label}
                                type="button"
                                className={date === q.value ? s["quick-on"] : undefined}
                                onClick={() => onDateChange(q.value)}
                            >
                                {q.label}
                            </button>
                        ))}
                    </div>
                    <input
                        type="date"
                        value={date}
                        aria-label="Schedule date"
                        onChange={(event) => onDateChange(event.target.value)}
                        className={s["schedule-date"]}
                    />
                    <div className={s["schedule-actions"]}>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="button" className="btn btn-primary btn-sm" onClick={onConfirm} disabled={!date}>
                            Schedule
                        </button>
                    </div>
                </div>
            )}
        </span>
    );
}
