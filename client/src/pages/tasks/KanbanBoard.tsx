import React, { useState } from "react";
import TaskCard from "./TaskCard";
import { useAgileConfig } from "../../AgileConfigContext";
import { useIsPhone } from "../../hooks/useViewportWidth";
import { useSwipe } from "./hooks/useSwipe";
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
    /** Accessible drag: keyboard lift/move/drop and touch, shared with backlog. */
    boardDrag?: {
        draggingId: number | string | null;
        overColumn: number | string | null;
        onKeyDown: (event: React.KeyboardEvent, taskId: number | string) => void;
        onDragStart: (taskId: number | string) => void;
        onDragOver: (column: any) => void;
        onDrop: (column: any) => void;
    };
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
    boardDrag,
    wipWarning,
    announcement,
    onAddTask,
    attribution,
}: KanbanBoardProps) {
    const { workflowStates, features } = useAgileConfig() as any;
    // Cancelled is a terminal state, not a work-in-progress column: a cancelled
    // ticket leaves the board rather than sitting in a fifth column. It stays
    // available in the status picker so a ticket can be cancelled from detail.
    const boardStates = (workflowStates || []).filter(
        (state: any) => state.key !== "cancelled",
    );
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
    // Match a task to a column either by workflow_state_id (preferred) or by the
    // legacy `status` key (back-compat for tasks created pre-migration).
    const getColTasks = (col: any) =>
        tasks.filter(
            (t) =>
                (t.workflow_state_id &&
                    col.id &&
                    t.workflow_state_id === col.id) ||
                (t.status && col.key && t.status === col.key),
        );

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
                // Drag-over compares against either id or key — useDragDrop passes whichever it has
                const isDragOver =
                    dragOverCol === col.id || dragOverCol === col.key;
                const wipExceeded =
                    features.wipLimits &&
                    col.wip_limit &&
                    colTasks.length > col.wip_limit;

                return (
                    <div
                        key={col.id || col.key}
                        className={`${s["kanban-column"]} ${isDragOver ? s["drag-over"] : ""} ${wipExceeded ? s["wip-exceeded"] : ""}`}
                        style={{ "--col-color": col.color } as React.CSSProperties}
                        onDragOver={(e) => {
                            onDragOver(e, col.id || col.key, col);
                            boardDrag?.onDragOver(col);
                        }}
                        onDragLeave={onDragLeave}
                        onDrop={(e) => {
                            onDrop(e, col.id || col.key, col);
                            boardDrag?.onDrop(col);
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
                            {isDragOver && (
                                <div className={s["drop-indicator"]}>Drop here</div>
                            )}
                            {colTasks.length === 0 && !isDragOver && (
                                <div className={s["column-empty"]}>
                                    <span>No items</span>
                                </div>
                            )}
                            {colTasks.map((task) => (
                                <div
                                    key={task.id}
                                    tabIndex={boardDrag ? 0 : undefined}
                                    role={boardDrag ? "listitem" : undefined}
                                    aria-roledescription={boardDrag ? "draggable card" : undefined}
                                    aria-grabbed={boardDrag ? boardDrag.draggingId === task.id : undefined}
                                    onKeyDown={(event) => boardDrag?.onKeyDown(event, task.id)}
                                    onDragStart={() => boardDrag?.onDragStart(task.id)}
                                >
                                    <TaskCard
                                        task={task}
                                        sprintMode={sprintMode}
                                        onOpenDetail={onOpenDetail}
                                        onOpenComments={onOpenComments}
                                        onDragStart={onDragStart}
                                        onDragEnd={onDragEnd}
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