import { useCallback } from "react";
import { updateTask } from "../../../api/tasks";
import type { Task } from "../../../types";
import { writeError } from "../ticketCapabilities";

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
 * The response owns the ticket and its container, including after undo.
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
        try {
            const { data: fresh } = await updateTask(task.id, patch);
            setBacklogTasks((current) => current.map((item) => item.id === task.id ? fresh as Task : item).filter((item) => item.container === "backlog"));
            if (fresh.container !== "backlog") {
                if (fresh.container === "sprint" || fresh.container === "scheduled") onMoved?.(fresh.container);
                await fetchBacklog(true);
            }
            undo.register({
                label: "Edited ticket",
                undo: async () => {
                    try {
                        const { data: restored } = await updateTask(task.id, previous);
                        setBacklogTasks((current) => current.map((item) => item.id === task.id ? restored as Task : item).filter((item) => item.container === "backlog"));
                        await fetchBacklog(true);
                    } catch (error) {
                        setError(writeError(error, "Failed to undo edit"));
                    }
                },
            });
        } catch (error) {
            setError(writeError(error, "Failed to save ticket"));
        }
    }, [fetchBacklog, setError, undo, setBacklogTasks, onMoved]);
}
