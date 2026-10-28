import React, { useState } from "react";
import {
    DndContext,
    DragOverlay,
    PointerSensor,
    TouchSensor,
    closestCorners,
    defaultDropAnimationSideEffects,
    useDraggable,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragOverEvent,
    type DragStartEvent,
    type DropAnimation,
} from "@dnd-kit/core";
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

type Id = number | string;

/** The pointer drag surface of `useDragDrop`. */
interface BoardPointerDrag {
    draggingTaskId: Id | null;
    dragOverCol: Id | null;
    onDragStart: (taskId: Id) => void;
    onDragOver: (columnId: Id | null) => void;
    onDragCancel: () => void;
    dropOnColumn: (taskId: Id, column: any) => boolean;
    targetPolicy?: TargetPolicy;
}

interface KanbanBoardProps {
    tasks: any[];
    sprintMode?: boolean;
    /** Pointer drag (mouse and touch). Without it, cards are not draggable. */
    drag?: BoardPointerDrag;
    onOpenDetail: (task: any) => void;
    onOpenComments: (id: Id) => void;
    /**
     * Keyboard navigation and announcements. Pointer drag belongs to
     * `useDragDrop`; this never receives pointer events.
     */
    boardDrag?: {
        draggingId: Id | null;
        overColumn: Id | null;
        onKeyDown: (event: React.KeyboardEvent, taskId: Id) => void;
        /** Drop any keyboard lift, e.g. when a pointer drag starts. */
        reset?: () => void;
    };
    /** Which columns may receive a card. Defaults to the drag hook's policy. */
    targetPolicy?: TargetPolicy;
    wipWarning?: string | null;
    announcement?: string;
    /** "Updated by <name>" flashes keyed by task id, from realtime deltas. */
    attribution?: Record<string, { name: string }>;
    /** Adds a ticket straight into a column; the header "+" is hidden without it. */
    onAddTask?: (column: any) => void;
}

const colId = (col: any): Id => col.id || col.key;

/** The card settles into its new slot instead of vanishing on release. */
const dropAnimation: DropAnimation = {
    duration: 220,
    easing: "cubic-bezier(0.2, 0.9, 0.3, 1.2)",
    sideEffects: defaultDropAnimationSideEffects({
        styles: { active: { opacity: "0.35" } },
    }),
};

function DraggableCard({
    task,
    enabled,
    children,
}: {
    task: any;
    enabled: boolean;
    children: React.ReactNode;
}) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: task.id,
        disabled: !enabled,
        data: { task },
    });
    // The original slot stays as a faded placeholder; the overlay is the card
    // under the pointer.
    return (
        <div
            ref={setNodeRef}
            className={`${s["card-slot"]} ${isDragging ? s["card-placeholder"] : ""}`}
            data-dragging={isDragging ? "true" : undefined}
            {...(enabled ? listeners : {})}
            {...(enabled ? { "aria-describedby": attributes["aria-describedby"] } : {})}
        >
            {children}
        </div>
    );
}

function DroppableColumn({
    col,
    disabled,
    className,
    children,
    ...rest
}: {
    col: any;
    disabled: boolean;
    className: string;
    children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
    const { setNodeRef } = useDroppable({ id: `col:${colId(col)}`, disabled, data: { column: col } });
    return (
        <div ref={setNodeRef} className={className} {...rest}>
            {children}
        </div>
    );
}

export default function KanbanBoard({
    tasks,
    sprintMode,
    drag,
    onOpenDetail,
    onOpenComments,
    boardDrag,
    targetPolicy,
    wipWarning,
    announcement,
    onAddTask,
    attribution,
}: KanbanBoardProps) {
    const { workflowStates, features } = useAgileConfig() as any;
    // Cancelled is a terminal state, not a work-in-progress column: a cancelled
    // ticket leaves the board rather than sitting in a fifth column.
    const boardStates = boardColumns(workflowStates);
    const policy = targetPolicy ?? drag?.targetPolicy ?? allowAllTargets;
    // On a phone the board is one column at a time, swiped between.
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

    // A small movement threshold keeps clicks (open detail) working; touch
    // waits for a short press so the board still scrolls.
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    );

    // Match a task to a column by its workflow state key; the id is a fallback
    // for a task that carries only the id.
    const getColTasks = (col: any) =>
        tasks.filter(
            (t) =>
                (col.key && t.workflow_state_key === col.key) ||
                (t.workflow_state_id && col.id && t.workflow_state_id === col.id),
        );
    const draggedId = drag?.draggingTaskId ?? boardDrag?.draggingId ?? null;
    const draggedTask = draggedId != null ? tasks.find((task) => task.id === draggedId) : undefined;
    const overlayTask = drag?.draggingTaskId != null
        ? tasks.find((task) => task.id === drag.draggingTaskId)
        : undefined;

    const columnOf = (overId: unknown) => {
        const key = String(overId ?? "");
        if (!key.startsWith("col:")) return null;
        return boardStates.find((col: any) => String(colId(col)) === key.slice(4)) ?? null;
    };

    const handleDragStart = (event: DragStartEvent) => {
        boardDrag?.reset?.();
        drag?.onDragStart(event.active.id as Id);
    };
    const handleDragOver = (event: DragOverEvent) => {
        const col = columnOf(event.over?.id);
        drag?.onDragOver(col ? colId(col) : null);
    };
    const handleDragEnd = (event: DragEndEvent) => {
        const col = columnOf(event.over?.id);
        if (!drag) return;
        if (!col) {
            drag.onDragCancel();
            return;
        }
        drag.dropOnColumn(event.active.id as Id, col);
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={() => drag?.onDragCancel()}
        >
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
                            onClick={() => setPhoneColumn((index) => Math.min(columnCount - 1, index + 1))}
                        >
                            ›
                        </button>
                    </div>
                )}
                <div className={s["kanban-columns"]} {...(isPhone && draggedId == null ? swipe : {})}>
                    {visibleColumns.map((col: any) => {
                        const colTasks = getColTasks(col);
                        const disabledReason = draggedTask ? policy(draggedTask, col) : null;
                        const isDragOver =
                            !disabledReason &&
                            drag?.dragOverCol != null &&
                            (drag.dragOverCol === col.id || drag.dragOverCol === col.key);
                        const isKeyboardOver =
                            !disabledReason &&
                            boardDrag?.overColumn != null &&
                            (boardDrag.overColumn === col.id || boardDrag.overColumn === col.key);
                        // The column the card came from is not a drop target.
                        const isSource = draggedTask != null && colTasks.some((t) => t.id === draggedTask.id);
                        const wipExceeded =
                            features.wipLimits && col.wip_limit && colTasks.length > col.wip_limit;

                        return (
                            <DroppableColumn
                                key={colId(col)}
                                col={col}
                                disabled={Boolean(disabledReason)}
                                data-column-key={col.key}
                                className={`${s["kanban-column"]} ${isDragOver || isKeyboardOver ? s["drag-over"] : ""} ${wipExceeded ? s["wip-exceeded"] : ""} ${disabledReason ? s["column-disabled"] : ""}`}
                                style={{ "--col-color": col.color } as React.CSSProperties}
                                aria-disabled={disabledReason ? true : undefined}
                                title={disabledReason ?? undefined}
                            >
                                <div className={s["column-header"]}>
                                    <div className={s["column-header-left"]}>
                                        <span className={s["column-dot"]} style={{ background: col.color }} />
                                        <span className={s["column-label"]}>
                                            {sprintMode && col.is_initial ? "New" : col.name}
                                        </span>
                                    </div>
                                    <span className={s["column-count"]}>
                                        {colTasks.length}
                                        {features.wipLimits && col.wip_limit ? ` / ${col.wip_limit}` : ""}
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
                                    {(isDragOver || isKeyboardOver) && !isSource && (
                                        <div className={s["drop-indicator"]}>Drop here</div>
                                    )}
                                    {colTasks.length === 0 && !isDragOver && !isKeyboardOver && (
                                        <div className={s["column-empty"]}>
                                            <span>No items</span>
                                        </div>
                                    )}
                                    {colTasks.map((task) => (
                                        <DraggableCard key={task.id} task={task} enabled={Boolean(drag)}>
                                            <div
                                                className={boardDrag?.draggingId === task.id ? s["card-lifted"] : undefined}
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
                                                    attribution={attribution?.[String(task.id)] ?? null}
                                                />
                                            </div>
                                        </DraggableCard>
                                    ))}
                                </div>
                            </DroppableColumn>
                        );
                    })}
                </div>
            </div>
            {/* The ticket under the pointer: lifted, tilted, fully opaque. */}
            <DragOverlay dropAnimation={dropAnimation}>
                {overlayTask ? (
                    <div className={s["drag-overlay"]} data-testid="drag-overlay">
                        <TaskCard
                            task={overlayTask}
                            sprintMode={sprintMode}
                            onOpenDetail={() => {}}
                            onOpenComments={() => {}}
                        />
                    </div>
                ) : null}
            </DragOverlay>
        </DndContext>
    );
}
