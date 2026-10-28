import { useCallback, useRef, useState } from "react";
import { updateTaskStatus } from "../../../api/tasks";
import type { Task } from "../../../types";
import type { BoardColumn, TargetPolicy } from "./boardTargets";
import { moveAdvisory } from "./boardTargets";
import { useWorkflowTargetPolicy } from "./useWorkflowTargetPolicy";
import type { ShowConfirm } from "./useConfirmDialog";
import { stageStatusMove } from "./stageStatusMove";

interface UseDragDropArgs {
    tasks: Task[];
    setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
    setError: (msg: string) => void;
    targetPolicy?: TargetPolicy;
}

type Id = number | string;

const columnKey = (column: BoardColumn) => (column.key ?? column.id) as string;

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
    targetPolicy,
}: UseDragDropArgs) {
    // The board refuses illegal and over-limit columns before a drop, using
    // the same graph and WIP setting the server enforces.
    const policy = useWorkflowTargetPolicy(tasks, targetPolicy);
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
                // Sent by key (back-compat with the default workflow); the
                // server resolves it to the workflow state id.
                await updateTaskStatus(task.id, columnKey(column));
                return true;
            } catch (err) {
                // Snap back so the board never claims a move the server refused.
                placeCard(task.id, task.workflow_state_key as string, task.workflow_state_id);
                const error = err as { response?: { data?: { error?: string; code?: string } } };
                const apiMsg = error?.response?.data?.error;
                setError(
                    error?.response?.data?.code === "WIP_EXCEEDED"
                        ? apiMsg || "WIP limit reached for this column."
                        : apiMsg || "Failed to move item",
                );
                return false;
            }
        },
        [placeCard, setError],
    );

    /** Accept a column: one optimistic update, one PATCH, roll back on error. */
    const commitMove = useCallback(
        async (task: Task, column: BoardColumn): Promise<boolean> => {
            placeCard(task.id, columnKey(column), typeof column.id === "number" ? column.id : null);
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
            if (task.workflow_state_key === column.key || (column.id && task.workflow_state_id === column.id)) {
                return false;
            }
            const rejection = policy(task, column);
            if (rejection) {
                setError(rejection);
                return false;
            }
            const notice = moveAdvisory(task, column, tasksRef.current);
            placeCard(task.id, columnKey(column), typeof column.id === "number" ? column.id : null);
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
        [clearDragState, policy, setError, placeCard, showConfirm, closeConfirm, sendMove],
    );

    return {
        dragOverCol,
        draggingTaskId,
        onDragStart,
        onDragOver,
        onDragCancel: clearDragState,
        dropOnColumn,
        commitMove,
        targetPolicy: policy,
    };
}
