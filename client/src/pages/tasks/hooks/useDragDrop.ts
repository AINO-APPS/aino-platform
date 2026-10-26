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
    /** Which columns may receive the card. All are legal until issue 04. */
    targetPolicy?: TargetPolicy;
}

/**
 * The board's only pointer drag path.
 *
 * A drop is staged: it opens one confirmation naming the ticket and the target
 * state, and neither the card nor the server changes until the user accepts.
 * `commitMove` is the single place that performs an accepted move, so the
 * keyboard path in `useBoardDragWiring` cannot drift from this one.
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
    const [dragOverCol, setDragOverCol] = useState<string | number | null>(
        null,
    );
    // Which card is in flight, for the board's disabled-target feedback.
    const [draggingTaskId, setDraggingTaskId] = useState<number | string | null>(null);
    const dragTaskId = useRef<number | string | null>(null);

    const onDragStart = (e: React.DragEvent, taskId: number | string) => {
        dragTaskId.current = taskId;
        setDraggingTaskId(taskId);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(taskId));
    };

    const clearDragState = () => {
        dragTaskId.current = null;
        setDraggingTaskId(null);
        setDragOverCol(null);
    };

    /**
     * Accept a column: one optimistic update, one PATCH, roll back on error.
     * Returns whether the server accepted the move.
     */
    const commitMove = useCallback(
        async (task: Task, column: BoardColumn): Promise<boolean> => {
            const targetKey = column.key ?? column.id;
            const previousStatus = task.workflow_state_key;
            const previousStateId = task.workflow_state_id;

            setTasks((prev) =>
                prev.map((candidate) =>
                    candidate.id === task.id
                        ? {
                              ...candidate,
                              workflow_state_key: targetKey as string,
                              workflow_state_id:
                                  typeof column.id === "number"
                                      ? column.id
                                      : candidate.workflow_state_id,
                          }
                        : candidate,
                ),
            );

            try {
                // Send by key (back-compat with default workflow); the server
                // resolves it to the workflow state id.
                await updateTaskStatus(task.id, String(targetKey));
                return true;
            } catch (err) {
                // Snap the card back to its original column so the board never
                // claims a move the server refused.
                setTasks((prev) =>
                    prev.map((candidate) =>
                        candidate.id === task.id
                            ? {
                                  ...candidate,
                                  workflow_state_key: previousStatus,
                                  workflow_state_id: previousStateId,
                              }
                            : candidate,
                    ),
                );
                const error = err as {
                    response?: { data?: { error?: string; code?: string } };
                };
                const apiMsg = error?.response?.data?.error;
                const code = error?.response?.data?.code;
                if (code === "WIP_EXCEEDED") {
                    setError(apiMsg || "WIP limit reached for this column.");
                } else {
                    setError(apiMsg || "Failed to move item");
                }
                return false;
            }
        },
        [setTasks, setError],
    );

    const onDragEnd = (_e: React.DragEvent, _taskId: number | string) => {
        clearDragState();
    };

    const onDragOver = (
        e: React.DragEvent,
        colId: string | number,
        col: BoardColumn,
    ) => {
        const task = tasks.find((candidate) => candidate.id === dragTaskId.current);
        if (task && policy(task, col)) {
            // Not a target: leave `preventDefault` unset so the browser shows
            // "no drop" and no drop event fires.
            e.dataTransfer.dropEffect = "none";
            if (dragOverCol !== null) setDragOverCol(null);
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (dragOverCol !== colId) setDragOverCol(colId);
    };

    const onDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
            setDragOverCol(null);
    };

    const onDrop = (
        e: React.DragEvent,
        colId: string | number,
        col: BoardColumn,
    ) => {
        e.preventDefault();
        const rawId = e.dataTransfer.getData("text/plain");
        const taskId = rawId ? parseInt(rawId, 10) : dragTaskId.current;
        clearDragState();
        if (!taskId) return;
        const task = tasks.find((candidate) => candidate.id === taskId);
        if (!task) return;
        if (task.workflow_state_key === col.key || task.workflow_state_id === col.id)
            return;

        const rejection = policy(task, col);
        if (rejection) {
            setError(rejection);
            return;
        }

        stageStatusMove(task, {
            column: col,
            notice: moveAdvisory(task, col, tasks),
            showConfirm,
            closeConfirm,
            onConfirm: () => void commitMove(task, col),
        });
    };

    return {
        dragOverCol,
        draggingTaskId,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDragLeave,
        onDrop,
        commitMove,
        targetPolicy: policy,
    };
}
