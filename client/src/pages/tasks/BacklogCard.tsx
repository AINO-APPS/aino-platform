import React, { useState } from "react";
import { currentStatusOption, statusOptions } from "./taskStatus";
import { CardBody } from "./TaskCardParts";
import { useAgileConfig } from "../../AgileConfigContext";
import IssueKey from "./IssueKey";
import TaskCardMenu from "./TaskCardMenu";
import { actionDecision, decisionProps, isReadOnlyTicket, transitionOptions } from "./ticketCapabilities";
import { useCardDensity } from "./TaskContext";
import s from "./BacklogTab.module.css";
import c from "./TaskCard.module.css";

interface BacklogCardProps {
    task: any;
    workflowStates: any;
    onOpenDetail: (task: any) => void;
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
    /**
     * Move this ticket into a sprint. The backlog is the only place a ticket
     * can be planned, so the action lives on the card rather than behind the
     * Sprint tab. Hidden when the tenant has no sprints to offer.
     */
    onAddToSprint?: (task: any) => void;
    /** Multi-select for bulk actions. */
    selection?: {
        isSelected: (id: number | string) => boolean;
        toggle: (id: number | string) => void;
    };
    /** "Updated by <name>" flash after a realtime delta. Non-blocking. */
    attribution?: { name: string } | null;
}

/** One backlog row: the shared Plan card plus selection, reorder and inline title edit. */
export default function BacklogCard({
    task,
    workflowStates,
    onOpenDetail,
    reorder,
    onInlineEdit,
    onAddToSprint,
    selection,
    attribution,
}: BacklogCardProps) {
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(task.title ?? "");
    const compact = useCardDensity() === "compact";
    const { features } = useAgileConfig() as any;
    const status =
        currentStatusOption(task, workflowStates, statusOptions(workflowStates)) ||
        statusOptions(workflowStates)[0];
    const issueKey = task.ticket_key || `#${task.id}`;
    const selected = selection?.isSelected(task.id) ?? false;
    const canReorder = Boolean(reorder) && actionDecision(task, "edit").allowed;
    const titleSlot = editingTitle && actionDecision(task, "edit").allowed ? (
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
                if (next && next !== task.title && actionDecision(task, "edit").allowed) {
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
                if (!onInlineEdit || !actionDecision(task, "edit").allowed) return;
                event.stopPropagation();
                setEditingTitle(true);
            }}
            title={decisionProps(actionDecision(task, "edit")).title || (onInlineEdit ? "Double-click to edit" : undefined)}
        >
            {task.title}
        </span>
    );

    return (
        <div
            className={s["backlog-row"]}
        >
            {selection && (
                <input
                    type="checkbox"
                    className={s["backlog-select"]}
                    checked={selected}
                    aria-label={`Select ${task.title}`}
                    onClick={(event) => event.stopPropagation()}
                    onChange={() => selection.toggle(task.id)}
                />
            )}
            <div
                className={`${c["task-card"]} ${c.clickable} ${s["backlog-card"]} ${compact ? c["task-card-compact"] : ""} ${task.completed_at ? c["task-done"] : ""} ${selected ? c["task-card-selected"] : ""} ${reorder?.draggingId === task.id ? s["backlog-card-dragging"] : ""} ${reorder?.overId === task.id ? s["backlog-card-over"] : ""}`}
                draggable={canReorder}
                onDragStart={() => { if (canReorder) reorder?.onDragStart(task.id); }}
                onDragOver={(e) => {
                    if (!reorder || !canReorder) return;
                    e.preventDefault();
                    reorder.onDragOver(task.id);
                }}
                onDrop={(e) => {
                    if (!reorder || !canReorder) return;
                    e.preventDefault();
                    reorder.onDrop(task.id);
                }}
                tabIndex={canReorder ? 0 : undefined}
                role={reorder ? "listitem" : undefined}
                aria-roledescription={reorder ? "sortable backlog item" : undefined}
                aria-grabbed={reorder ? reorder.draggingId === task.id : undefined}
                data-task-id={reorder ? String(task.id) : undefined}
                onKeyDown={(e) => { if (canReorder) reorder?.onKeyDown(e, task.id); }}
                onTouchStart={(e) => { if (canReorder) reorder?.onTouchStart?.(e, task.id); }}
                onTouchMove={(e) => reorder?.onTouchMove?.(e)}
                onTouchEnd={() => reorder?.onTouchEnd?.()}
                onClick={(e) => {
                    const target = e.target as HTMLElement;
                    if (target.closest(`.${s["backlog-actions"]}`) || target.closest(`.${c["task-labels"]}`)) return;
                    onOpenDetail(task);
                }}
            >
                <CardBody
                    task={task}
                    status={status}
                    compact={compact}
                    blockersEnabled={features?.blockers !== false}
                    keySlot={
                        <span className={c["issue-key-plain"]}>
                            <IssueKey task={task} />
                        </span>
                    }
                    titleSlot={titleSlot}
                    actionsSlot={
                        <span className={s["backlog-actions"]}>
                            <TaskCardMenu
                                label={`Actions for ${issueKey}`}
                                items={[
                                    { label: "Open task", onSelect: () => onOpenDetail(task) },
                                    ...(onAddToSprint && !isReadOnlyTicket(task)
                                        ? [{ label: "Add to sprint", ...decisionProps(actionDecision(task, "placeInSprint")), onSelect: () => onAddToSprint(task) }]
                                        : []),
                                    ...(onInlineEdit && !isReadOnlyTicket(task) ? [{
                                        label: "Edit title", ...decisionProps(actionDecision(task, "edit")),
                                        onSelect: () => setEditingTitle(true),
                                    }, ...transitionOptions(task, workflowStates).map((option) => ({
                                        label: option.label, ...decisionProps(option),
                                        onSelect: () => void onInlineEdit(task, { workflow_state_id: option.to }),
                                    }))] : []),
                                ]}
                            />
                        </span>
                    }
                />
                {attribution && (
                    <span className={s["backlog-attribution"]} role="status">
                        Updated by {attribution.name}
                    </span>
                )}
            </div>
        </div>
    );
}