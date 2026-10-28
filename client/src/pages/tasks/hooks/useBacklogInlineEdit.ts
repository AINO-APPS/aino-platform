import { useCallback } from "react";
import { updateTask } from "../../../api/tasks";
import type { Task } from "../../../types";

interface InlineEditOptions {
    setBacklogTasks: React.Dispatch<React.SetStateAction<Task[]>>;
    fetchBacklog: (quiet?: boolean) => Promise<unknown>;
    setError: (message: string) => void;
    undo: { register: (entry: { label: string; undo: () => Promise<void> }) => void };
    /** A ticket left the backlog for Scheduled or a sprint. */
    onMoved?: (to: "scheduled" | "sprint") => void;
}

/**
 * Inline edit: patch one field without opening the detail view.
 *
 * A planned day, due date or sprint moves the ticket out of the backlog (to
 * Scheduled or the sprint), so it leaves the list rather than lingering until
 * the next reload. The prior value is registered for undo so a mis-click is
 * reversible.
 */
export function useBacklogInlineEdit({
    setBacklogTasks,
    fetchBacklog,
    setError,
    undo,
    onMoved,
}: InlineEditOptions) {
    return useCallback(async (task: Task, patch: Record<string, unknown>) => {
        const previous = Object.fromEntries(
            Object.keys(patch).map((key) => [key, (task as any)[key]]),
        );
        const leaves = Boolean(patch.due_date || patch.planned_date || patch.sprint_id);
        const drop = (list: Task[]) => list.filter((item) => item.id !== task.id);
        setBacklogTasks((current) =>
            leaves ? drop(current) : current.map((item) => (item.id === task.id ? { ...item, ...patch } : item)),
        );
        try {
            await updateTask(task.id, patch);
            if (leaves) {
                onMoved?.(patch.sprint_id ? "sprint" : "scheduled");
                await fetchBacklog(true);
            }
            undo.register({
                label: "Edited ticket",
                undo: async () => {
                    await updateTask(task.id, previous);
                    await fetchBacklog(true);
                },
            });
        } catch {
            if (leaves) await fetchBacklog(true);
            else setBacklogTasks((current) => current.map((item) => (item.id === task.id ? { ...item, ...previous } : item)));
            setError("Failed to save ticket");
        }
    }, [fetchBacklog, setError, undo, setBacklogTasks, onMoved]);
}
