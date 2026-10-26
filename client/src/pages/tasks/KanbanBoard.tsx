import React, { useState } from "react";
import TaskCard from "./TaskCard";
import { useAgileConfig } from "../../AgileConfigContext";
import { useIsPhone } from "../../hooks/useViewportWidth";
import { useSwipe } from "./hooks/useSwipe";
import {
    allowAllTargets,
    boardColumns,
    type TargetPolicy,
} from "./hooks/boardTargets";
import s from "./KanbanBoard.module.css";

interface KanbanBoardProps {
    tasks: any[];
    dragOverCol: number | string | null;
    sprintMode?: boolean;
    onDragOver: (e: React.DragEvent, colId: number | string, col: any) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent, colId: number | string, col: any) => void;
    onDragStart: (e: React.DragEvent, id: number | string) => void;
    onDragEnd: (e: React.DragEvent, id: number | string) => void;
    onOpenDetail: (task: any) => void;
    onOpenComments: (id: number | string) => void;
    /** The card in flight under the pointer, for disabled-target feedback. */
    draggingTaskId?: number | string | null;
    /**
     * Keyboard navigation and announcements. Pointer drag belongs to
     * `useDragDrop`; this never receives pointer events.
     */
    boardDrag?: {
        draggingId: number | string | null;
        overColumn: number | string | null;
        onKeyDown: (event: React.KeyboardEvent, taskId: number | string) => void;
        /** Drop any keyboard lift, e.g. when a pointer drag ends. */
        reset?: () => void;
    };
    /** Which columns may receive a card. All are legal until issue 04. */
    targetPolicy?: TargetPolicy;
    wipWarning?: string | null;
    announcement?: string;
    /** "Updated by <name>" flashes keyed by task id, from realtime deltas. */
    attribution?: Record<string, { name: string }>;
    /** Adds a ticket straight into a column; the header "+" is hidden without it. */
    onAddTask?: (column: any) => void;
}

export default function KanbanBoard({
    tasks,
    dragOverCol,
    sprintMode,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragStart,
    onDragEnd,
    onOpenDetail,
    onOpenComments,
    draggingTaskId,
    boardDrag,
    targetPolicy = allowAllTargets,
    wipWarning,
    announcement,
    onAddTask,
    attribution,
}: KanbanBoardProps) {
    const { workflowStates, features } = useAgileConfig() as any;
    // Cancelled is a terminal state, not a work-in-progress column: a cancelled
    // ticket leaves the board rather than sitting in a fifth column. It stays
    // available in the status picker so a ticket can be cancelled from detail.
    const boardStates = boardColumns(workflowStates);
    // On a phone the board is one column at a time, swiped between. On wider
    // viewports every column is visible and the board scrolls horizontally.
    const isPhone = useIsPhone();
    const [phoneColumn, setPhoneColumn] = useState(0);
    const columnCount = boardStates.length;
    const swipe = useSwipe(
        () => setPhoneColumn((index) => Math.min(columnCount - 1, index + 1)),
        () => setPhoneColumn((index) => Math.max(0, index - 1)),
    );
    const visibleColumns = isPhone
        ? boardStates.slice(phoneColumn, phoneColumn + 1)
        : boardStates;
    // Match a task to a column by its workflow state key. The key is what the
    // task list always carries, and it is the only field that works before
    // `/agile` resolves: the fallback states all share `id: 0`, so an id match
    // can never place a card in a fallback column. `workflow_state_id` is kept
    // as a fallback for a task that has only the id.
    const getColTasks = (col: any) =>
        tasks.filter(
            (t) =>
                (col.key && t.workflow_state_key === col.key) ||
                (t.workflow_state_id &&
                    col.id &&
                    t.workflow_state_id === col.id),
        );
    // The card currently being dragged, under either input. Columns the policy
    // rejects are marked and cannot take the drop.
    const draggedId = draggingTaskId ?? boardDrag?.draggingId ?? null;
    const draggedTask =
        draggedId != null
            ? tasks.find((task) => task.id === draggedId)
            : undefined;

    return (
        <div className={s["kanban-board"]} data-phone={isPhone ? "true" : undefined}>
            {wipWarning && (
                <div className={s["wip-warning"]} role="status">
                    {wipWarning}
                </div>
            )}
            <div className="sr-only" role="status" aria-live="polite">
                {announcement}
            </div>
            {isPhone && columnCount > 1 && (
                <div className={s["phone-column-nav"]} role="group" aria-label="Board column">
                    <button
                        type="button"
                        aria-label="Previous column"
                        disabled={phoneColumn === 0}
                        onClick={() => setPhoneColumn((index) => Math.max(0, index - 1))}
                    >
                        ‹
                    </button>
                    <span className={s["phone-column-label"]} aria-live="polite">
                        {boardStates[phoneColumn]?.name} ({phoneColumn + 1}/{columnCount})
                    </span>
                    <button
                        type="button"
                        aria-label="Next column"
                        disabled={phoneColumn >= columnCount - 1}
                        onClick={() =>
                            setPhoneColumn((index) => Math.min(columnCount - 1, index + 1))
                        }
                    >
                        ›
                    </button>
                </div>
            )}
            <div className={s["kanban-columns"]} {...(isPhone ? swipe : {})}>
                {visibleColumns.map((col: any) => {
                const colTasks = getColTasks(col);
                const disabledReason = draggedTask
                    ? targetPolicy(draggedTask, col)
                    : null;
                // Drag-over compares against either id or key — useDragDrop passes whichever it has
                const isDragOver =
                    !disabledReason &&
                    (dragOverCol === col.id || dragOverCol === col.key);
                const isKeyboardOver =
                    !disabledReason &&
                    boardDrag?.overColumn != null &&
                    (boardDrag.overColumn === col.id ||
                        boardDrag.overColumn === col.key);
                const wipExceeded =
                    features.wipLimits &&
                    col.wip_limit &&
                    colTasks.length > col.wip_limit;

                return (
                    <div
                        key={col.id || col.key}
                        data-column-key={col.key}
                        className={`${s["kanban-column"]} ${isDragOver || isKeyboardOver ? s["drag-over"] : ""} ${wipExceeded ? s["wip-exceeded"] : ""} ${disabledReason ? s["column-disabled"] : ""}`}
                        style={{ "--col-color": col.color } as React.CSSProperties}
                        aria-disabled={disabledReason ? true : undefined}
                        title={disabledReason ?? undefined}
                        onDragOver={(e) => onDragOver(e, col.id || col.key, col)}
                        onDragLeave={onDragLeave}
                        onDrop={(e) => {
                            if (disabledReason) return;
                            onDrop(e, col.id || col.key, col);
                        }}
                    >
                        <div className={s["column-header"]}>
                            <div className={s["column-header-left"]}>
                                <span
                                    className={s["column-dot"]}
                                    style={{ background: col.color }}
                                />
                                <span className={s["column-label"]}>
                                    {sprintMode && col.is_initial ? "New" : col.name}
                                </span>
                            </div>
                            <span className={s["column-count"]}>
                                {colTasks.length}
                                {features.wipLimits && col.wip_limit
                                    ? ` / ${col.wip_limit}`
                                    : ""}
                            </span>
                            {onAddTask && (
                                <button
                                    type="button"
                                    className={s["column-add"]}
                                    aria-label={`Add a ticket to ${col.name}`}
                                    title={`Add a ticket to ${col.name}`}
                                    onClick={() => onAddTask(col)}
                                >
                                    +
                                </button>
                            )}
                        </div>

                        <div className={s["column-tasks"]}>
                            {(isDragOver || isKeyboardOver) && (
                                <div className={s["drop-indicator"]}>Drop here</div>
                            )}
                            {colTasks.length === 0 && !isDragOver && !isKeyboardOver && (
                                <div className={s["column-empty"]}>
                                    <span>No items</span>
                                </div>
                            )}
                            {colTasks.map((task) => (
                                <div
                                    key={task.id}
                                    className={
                                        boardDrag?.draggingId === task.id
                                            ? s["card-lifted"]
                                            : undefined
                                    }
                                    tabIndex={boardDrag ? 0 : undefined}
                                    role={boardDrag ? "listitem" : undefined}
                                    aria-roledescription={boardDrag ? "draggable card" : undefined}
                                    aria-grabbed={boardDrag ? boardDrag.draggingId === task.id : undefined}
                                    onKeyDown={(event) => boardDrag?.onKeyDown(event, task.id)}
                                >
                                    <TaskCard
                                        task={task}
                                        sprintMode={sprintMode}
                                        onOpenDetail={onOpenDetail}
                                        onOpenComments={onOpenComments}
                                        onDragStart={(event, id) => {
                                            boardDrag?.reset?.();
                                            onDragStart(event, id);
                                        }}
                                        onDragEnd={(event, id) => {
                                            // A pointer drag ending must also
                                            // clear any keyboard lift.
                                            boardDrag?.reset?.();
                                            onDragEnd(event, id);
                                        }}
                                        attribution={attribution?.[String(task.id)] ?? null}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                );
                })}
            </div>
        </div>
    );
}
