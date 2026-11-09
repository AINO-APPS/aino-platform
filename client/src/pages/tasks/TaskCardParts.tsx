import React, { useState } from "react";
import ArchivedProjectLabel from "./ArchivedProjectLabel";
import { CalendarDays, MessageSquare, Ban, Clock, ChevronUp, ChevronDown, Minus } from "../../constants/icons";
import { StoryPointBadge, WorkItemTypeBadge } from "../../components/agile/AgilePickers";
import { PRIORITIES, type PriorityOption } from "./constants";
import type { StatusOption } from "./taskStatus";
import { formatDate, formatDueDate, isDueOverdue, getAvatarUrl, stripHtml } from "./utils";
import s from "./TaskCard.module.css";
import { formatMinutes } from './time';

/**
 * The shared Plan card anatomy, used by the board and backlog cards:
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

/** Priority chevron: up for high, a dash for medium, down for low. */
export function PriorityIcon({ priority }: { priority: string | undefined }) {
    const pri = getPriority(priority);
    const Glyph = pri.value === "high" ? ChevronUp : pri.value === "low" ? ChevronDown : Minus;
    return (
        <span
            className={s["pri-icon"]}
            role="img"
            aria-label={`${pri.label} priority`}
            title={`${pri.label} priority`}
            style={{ "--pri-color": pri.color } as React.CSSProperties}
        >
            <Glyph size={15} strokeWidth={3} aria-hidden="true" />
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
    sprintEndDate?: string | null;
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

/** The card interior shared by the planning surfaces. */
export function CardBody({
    task,
    sprintEndDate,
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
    const spent = formatMinutes(task.time_spent_minutes ?? task.logged_minutes);
    const originalValue = task.original_estimate_minutes !== undefined ? task.original_estimate_minutes : task.estimated_minutes;
    const original = originalValue == null ? '—' : formatMinutes(originalValue);
    const remaining = task.remaining_estimate_minutes == null ? '—' : formatMinutes(task.remaining_estimate_minutes);
    return (
        <>
            <div className={s["card-top"]}>
                <WorkItemTypeBadge value={task.work_item_type_id || task.work_item_type_key} />
                {keySlot}
                {!task.is_subtask && <StoryPointBadge value={task.story_points} />}
                {task.is_subtask && task.parent_key && (
                    <span className={s["epic-badge"]}>Subtask of {task.parent_key}</span>
                )}
                {!task.is_subtask && task.parent_task_id && (
                    <span className={s["epic-badge"]} title="Part of an epic">
                        Epic
                    </span>
                )}
                <BlockedFlag task={task} enabled={blockersEnabled} />
                <span className={s.grow} />
                <PriorityIcon priority={task.priority} />
                {actionsSlot}
            </div>
            <div className={s["task-title"]}>{titleSlot ?? task.title}</div>
            <ArchivedProjectLabel task={task} />
            {description && <div className={s["card-desc"]}>{description}</div>}
            <div className={s['card-effort']} aria-label={`Time spent ${spent}; original estimate ${original}; remaining estimate ${remaining}`}>
                Spent {spent} · Original {original} · Remaining {remaining}
            </div>
            <div className={s["card-foot"]}>
                {showStatus && <StatusPill status={status} />}
                <DueChip task={task} />
                {sprintEndDate && (
                    <span className={s["due-chip"]} title={`Sprint ends ${formatDate(sprintEndDate)}`}>
                        Sprint ends {formatDate(sprintEndDate)}
                    </span>
                )}
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
