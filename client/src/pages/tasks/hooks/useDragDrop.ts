import { useCallback, useRef, useState } from "react";
import { updateTaskStatus } from "../../../api/tasks";
import type { Task } from "../../../types";
import type { BoardColumn } from "../boardTypes";
import { doneAdvisory } from "../boardTypes";
import { boardTargetDecision, reasonCopy, writeError } from "../ticketCapabilities";
import type { ShowConfirm } from "./useConfirmDialog";
import { stageStatusMove } from "./stageStatusMove";

interface UseDragDropArgs {
    tasks: Task[];
    setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
    setError: (msg: string) => void;
    onBoardRefresh?: () => void;
}

type Id = number | string;

const targetState = (column: BoardColumn) => String(column.stateId);
const columnKey = (column: BoardColumn) => column.key ?? targetState(column);

/**
 * The board's pointer drag state and its one move path.
 *
 * The board renders with @dnd-kit; this hook owns what a drag means. A drop
 * lands the card in the target column immediately — the board shows the move
 * the user made — then asks for confirmation. Accept sends one PATCH (rolled
 * back if refused); Cancel restores the card and sends nothing.
 *
 * `commitMove` is the single place that sends an accepted move, shared with the
 * keyboard path in `useBoardDragWiring`.
 */
export function useDragDrop({
    tasks,
    setTasks,
    showConfirm,
    closeConfirm,
    setError,
    onBoardRefresh,
}: UseDragDropArgs) {
    const [draggingTaskId, setDraggingTaskId] = useState<Id | null>(null);
    const [dragOverCol, setDragOverCol] = useState<Id | null>(null);
    const tasksRef = useRef(tasks);
    tasksRef.current = tasks;

    const placeCard = useCallback(
        (taskId: Id, key: string, stateId: number | null | undefined) =>
            setTasks((prev) =>
                prev.map((candidate) =>
                    candidate.id === taskId
                        ? {
                              ...candidate,
                              workflow_state_key: key,
                              workflow_state_id: stateId ?? candidate.workflow_state_id,
                          }
                        : candidate,
                ),
            ),
        [setTasks],
    );

    const sendMove = useCallback(
        async (task: Task, column: BoardColumn): Promise<boolean> => {
            try {
                const { data: fresh } = await updateTaskStatus(task.id, targetState(column));
                setTasks((previous) =>
                    previous.map((candidate) =>
                        candidate.id === task.id ? fresh : candidate,
                    ),
                );
                onBoardRefresh?.();
                return true;
            } catch (err) {
                // Snap back so the board never claims a move the server refused.
                placeCard(task.id, task.workflow_state_key as string, task.workflow_state_id);
                setError(writeError(err, "Failed to move item"));
                return false;
            }
        },
        [placeCard, setError, setTasks, onBoardRefresh],
    );

    /** Accept a column: one optimistic update, one PATCH, roll back on error. */
    const commitMove = useCallback(
        async (task: Task, column: BoardColumn): Promise<boolean> => {
            placeCard(task.id, columnKey(column), column.stateId);
            return sendMove(task, column);
        },
        [placeCard, sendMove],
    );

    const onDragStart = useCallback((taskId: Id) => {
        setDraggingTaskId(taskId);
    }, []);

    const onDragOver = useCallback((columnId: Id | null) => {
        setDragOverCol(columnId);
    }, []);

    const clearDragState = useCallback(() => {
        setDraggingTaskId(null);
        setDragOverCol(null);
    }, []);

    /**
     * Drop a card on a column: land it, then confirm. Returns false when the
     * drop was refused outright (same column, illegal target).
     */
    const dropOnColumn = useCallback(
        (taskId: Id, column: BoardColumn): boolean => {
            clearDragState();
            const task = tasksRef.current.find((candidate) => candidate.id === taskId);
            if (!task) return false;
            if (
                (task.workflow_state_key && column.key === task.workflow_state_key) ||
                (task.workflow_state_id != null &&
                    String(task.workflow_state_id) === String(column.stateId))
            ) {
                return false;
            }
            const decision = boardTargetDecision(task, column);
            if (!decision.allowed) {
                setError(reasonCopy(decision.reason));
                return false;
            }
            const notice = doneAdvisory(task, column);
            placeCard(task.id, columnKey(column), column.stateId);
            stageStatusMove(task, {
                column,
                notice,
                showConfirm,
                closeConfirm,
                onConfirm: () => void sendMove(task, column),
                onCancel: () => placeCard(task.id, task.workflow_state_key as string, task.workflow_state_id),
            });
            return true;
        },
        [clearDragState, setError, placeCard, showConfirm, closeConfirm, sendMove],
    );

    return {
        dragOverCol,
        draggingTaskId,
        onDragStart,
        onDragOver,
        onDragCancel: clearDragState,
        dropOnColumn,
        commitMove,
    };
}
