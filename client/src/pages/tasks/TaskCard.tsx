import React, { useState } from "react";
import { Check, Copy } from "../../constants/icons";
import { CardBody } from "./TaskCardParts";
import { useToast } from "../../components/common/Toast";
import { useCardDensity } from "./TaskContext";
import { useAgileConfig } from "../../AgileConfigContext";
import { currentStatusOption, statusOptions } from "./taskStatus";
import TaskCardMenu from "./TaskCardMenu";
import s from "./TaskCard.module.css";
import type { Task } from "../../types";

// Copy a string to the clipboard. Uses the modern async API when available,
// and falls back to a hidden <textarea> + execCommand for older browsers
// and non-secure contexts (e.g. plain-HTTP dev environments where
// navigator.clipboard is unavailable).
async function copyToClipboard(text: string): Promise<boolean> {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        /* fall through */
    }
    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
    } catch {
        return false;
    }
}

interface TaskCardProps {
    task: any;
    sprintMode?: boolean;
    onOpenDetail: (task: Task) => void;
    onOpenComments: (id: number | string) => void;
    /** HTML5 drag. Omitted on the board, where @dnd-kit owns dragging. */
    onDragStart?: (e: React.DragEvent, id: number | string) => void;
    onDragEnd?: (e: React.DragEvent, id: number | string) => void;
    /** "Updated by <name>" flash after a realtime delta. Non-blocking. */
    attribution?: { name: string } | null;
}

/**
 * The board and schedule card.
 *
 * The shared Plan anatomy (see TaskCardParts): key and priority, the title,
 * then status, due, labels and the assignee avatar. Blocked and overdue stay
 * visible in both densities.
 */
export default function TaskCard({
    task,
    sprintMode,
    onOpenDetail,
    onOpenComments,
    onDragStart,
    onDragEnd,
    attribution,
}: TaskCardProps) {
    const compact = useCardDensity() === "compact";
    const toast = useToast() as any;
    const { workflowStates, features } = useAgileConfig() as any;
    const [copied, setCopied] = useState(false);

    // Issue key (e.g. WEB-123) only exists once a task is assigned to a project;
    // legacy / unkeyed tickets fall back to "#<id>" so the chip is always
    // present and consistently placed.
    const issueKey = task.issue_key || `#${task.id}`;
    const status = currentStatusOption(
        task,
        workflowStates,
        statusOptions(workflowStates),
    );

    // One copy path for both the key chip and the menu item, so the feedback
    // cannot drift between them.
    const copyKey = async () => {
        const ok = await copyToClipboard(issueKey);
        if (ok) {
            setCopied(true);
            try {
                toast.success(`Copied ${issueKey}`);
            } catch {
                /* toast optional */
            }
            setTimeout(() => setCopied(false), 1500);
        } else {
            try {
                toast.error("Copy failed");
            } catch {
                /* ignore */
            }
        }
    };

    const onCopyKey = (e: React.MouseEvent) => {
        e.stopPropagation();
        void copyKey();
    };

    return (
        <div
            key={task.id}
            id={`task-${task.id}`}
            className={`${s["task-card"]} ${s.clickable} ${compact ? s["task-card-compact"] : ""} ${task.completed_at ? s["task-done"] : ""}`}
            draggable={Boolean(onDragStart)}
            onDragStart={onDragStart ? (e) => onDragStart(e, task.id) : undefined}
            onDragEnd={onDragEnd ? (e) => onDragEnd(e, task.id) : undefined}
            onClick={(e) => {
                const target = e.target as HTMLElement;
                if (
                    target.closest(`.${s["task-actions"]}`) ||
                    target.closest(`.${s["comment-icon"]}`) ||
                    target.closest(`.${s["task-labels"]}`) ||
                    target.closest(`.${s["issue-key-chip"]}`)
                )
                    return;
                onOpenDetail(task);
            }}
        >
            <CardBody
                task={task}
                status={status}
                compact={compact}
                showStatus={!sprintMode}
                blockersEnabled={features?.blockers !== false}
                onOpenComments={() => onOpenComments(task.id)}
                keySlot={
                    <button
                        type="button"
                        className={s["issue-key-chip"]}
                        onClick={onCopyKey}
                        title={`Click to copy ${issueKey}`}
                        style={
                            task.project?.color
                                ? ({ "--key-color": task.project.color } as React.CSSProperties)
                                : undefined
                        }
                    >
                        <span className={s["issue-key-text"]}>{issueKey}</span>
                        {copied ? <Check size={11} /> : <Copy size={11} className={s["copy-ic"]} />}
                    </button>
                }
                actionsSlot={
                    <span className={s["task-actions"]}>
                        <TaskCardMenu
                            label={`Actions for ${issueKey}`}
                            items={[
                                { label: "Open task", onSelect: () => onOpenDetail(task) },
                                { label: `Copy ${issueKey}`, onSelect: () => void copyKey() },
                                { label: "Comments", onSelect: () => onOpenComments(task.id) },
                            ]}
                        />
                    </span>
                }
            />
            {attribution && (
                <span className={s["task-attribution"]} role="status">
                    Updated by {attribution.name}
                </span>
            )}
        </div>
    );
}