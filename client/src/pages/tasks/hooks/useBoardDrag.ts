import { useCallback, useRef, useState } from "react";

export interface BoardColumn {
    id?: number | string;
    key?: string;
    name?: string;
    category?: string;
    is_terminal?: boolean;
    wip_limit?: number | null;
    [key: string]: unknown;
}

export interface BoardTask {
    id: number | string;
    title?: string;
    /** The workflow state is the only status (D4). */
    workflow_state_id?: number | string | null;
    workflow_state_key?: string | null;
    is_blocked?: boolean;
    acceptance_criteria?: unknown[] | null;
    [key: string]: unknown;
}

interface UseBoardDragArgs {
    tasks: BoardTask[];
    columns: BoardColumn[];
    onMove: (task: BoardTask, column: BoardColumn) => Promise<void> | void;
    onAnnounce?: (message: string) => void;
    /** Ask before entering a done state with open blockers or unchecked criteria. */
    confirmDone?: (task: BoardTask, reason: string) => Promise<boolean> | boolean;
}

function columnOf(task: BoardTask, columns: BoardColumn[]): BoardColumn | undefined {
    return columns.find(
        (column) =>
            (task.workflow_state_id && column.id && task.workflow_state_id === column.id) ||
            (task.workflow_state_key && column.key && task.workflow_state_key === column.key),
    );
}

function isDoneColumn(column: BoardColumn | undefined): boolean {
    return Boolean(column && (column.category === "done" || column.is_terminal));
}

/**
 * Board drag for mouse, touch and keyboard.
 *
 * All three inputs route through `move`, so the result is identical and the
 * outcome is announced. WIP limits warn without blocking, and entering a done
 * state with open blockers or unchecked acceptance criteria asks first.
 */
export function useBoardDrag({
    tasks,
    columns,
    onMove,
    onAnnounce,
    confirmDone,
}: UseBoardDragArgs) {
    const [draggingId, setDraggingId] = useState<number | string | null>(null);
    const [overColumn, setOverColumn] = useState<number | string | null>(null);
    const [wipWarning, setWipWarning] = useState<string | null>(null);
    const lastAnnouncement = useRef("");

    const announce = useCallback(
        (message: string) => {
            if (message === lastAnnouncement.current) return;
            lastAnnouncement.current = message;
            onAnnounce?.(message);
        },
        [onAnnounce],
    );

    const move = useCallback(
        async (taskId: number | string, column: BoardColumn) => {
            const task = tasks.find((candidate) => candidate.id === taskId);
            if (!task) return;

            const current = columnOf(task, columns);
            if (current && (current.id === column.id || current.key === column.key)) return;

            // WIP limits warn without blocking.
            if (column.wip_limit) {
                const occupancy = tasks.filter(
                    (candidate) => columnOf(candidate, columns)?.id === column.id,
                ).length;
                if (occupancy >= column.wip_limit) {
                    setWipWarning(
                        `${column.name} is over its WIP limit (${occupancy}/${column.wip_limit}). The move is allowed.`,
                    );
                } else {
                    setWipWarning(null);
                }
            }

            // Entering done is advisory-checked.
            if (isDoneColumn(column) && confirmDone) {
                const openBlockers = Boolean(task.is_blocked);
                const unchecked = Array.isArray(task.acceptance_criteria)
                    && task.acceptance_criteria.some(
                        (item: any) => item && typeof item === "object" && item.done === false,
                    );
                if (openBlockers || unchecked) {
                    const reason = openBlockers
                        ? "This task has an open blocker."
                        : "This task has unchecked acceptance criteria.";
                    const proceed = await confirmDone(task, reason);
                    if (!proceed) {
                        announce("Move cancelled");
                        return;
                    }
                }
            }

            await onMove(task, column);
            announce(`Moved ${task.title ?? "task"} to ${column.name ?? "column"}`);
        },
        [tasks, columns, onMove, confirmDone, announce],
    );

    /** Keyboard: space lifts, arrows move between columns, space drops. */
    const onKeyDown = useCallback(
        (event: React.KeyboardEvent, taskId: number | string) => {
            const task = tasks.find((candidate) => candidate.id === taskId);
            if (!task) return;
            const currentIndex = columns.findIndex(
                (column) => columnOf(task, columns)?.id === column.id,
            );

            if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                if (draggingId === taskId) {
                    setDraggingId(null);
                    announce("Dropped");
                } else {
                    setDraggingId(taskId);
                    announce("Lifted. Use the arrow keys to choose a column, space to drop, escape to cancel.");
                }
                return;
            }

            if (draggingId !== taskId) return;

            if (event.key === "Escape") {
                event.preventDefault();
                setDraggingId(null);
                announce("Move cancelled");
                return;
            }

            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const delta = event.key === "ArrowLeft" ? -1 : 1;
                const nextIndex = Math.max(0, Math.min(columns.length - 1, currentIndex + delta));
                const next = columns[nextIndex];
                if (next) {
                    setOverColumn(next.id ?? next.key ?? null);
                    void move(taskId, next);
                }
            }
        },
        [tasks, columns, draggingId, move, announce],
    );

    /** Pointer/touch drag. */
    const onDragStart = useCallback((taskId: number | string) => {
        setDraggingId(taskId);
    }, []);

    const onDragOver = useCallback((column: BoardColumn) => {
        setOverColumn(column.id ?? column.key ?? null);
    }, []);

    const onDrop = useCallback(
        (column: BoardColumn) => {
            const taskId = draggingId;
            setDraggingId(null);
            setOverColumn(null);
            if (taskId === null) return;
            void move(taskId, column);
        },
        [draggingId, move],
    );

    return {
        draggingId,
        overColumn,
        wipWarning,
        clearWipWarning: () => setWipWarning(null),
        move,
        onKeyDown,
        onDragStart,
        onDragOver,
        onDrop,
    };
}
