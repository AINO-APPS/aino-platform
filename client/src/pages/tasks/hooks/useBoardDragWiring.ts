import { useState } from "react";
import { updateTaskStatus } from "../../../api/tasks";
import { useBoardDrag } from "./useBoardDrag";

interface UseBoardDragWiringArgs {
    tasks: any[];
    columns: any[];
    fetchTasks: () => void;
    showConfirm: (
        title: string,
        message: string,
        onConfirm: () => void,
        opts?: { confirmText?: string; isDanger?: boolean },
    ) => void;
    closeConfirm: () => void;
}

/**
 * Wire the accessible board drag to the Tasks page.
 *
 * Kept out of the page so the page stays within the file-size ratchet.
 */
export function useBoardDragWiring({
    tasks,
    columns,
    fetchTasks,
    showConfirm,
    closeConfirm,
}: UseBoardDragWiringArgs) {
    const [announcement, setAnnouncement] = useState("");

    const boardDrag = useBoardDrag({
        tasks,
        columns,
        onMove: async (task, column) => {
            await updateTaskStatus(task.id, String(column.key ?? column.id));
            fetchTasks();
        },
        onAnnounce: setAnnouncement,
        confirmDone: (task, reason) =>
            new Promise<boolean>((resolve) => {
                showConfirm(
                    "Mark done anyway?",
                    `${reason} Mark "${task.title}" done anyway?`,
                    () => {
                        closeConfirm();
                        resolve(true);
                    },
                    { confirmText: "Mark done anyway" },
                );
            }),
    });

    return { boardDrag, announcement };
}
