/**
 * The Tasks page's ticket-lifecycle actions.
 *
 * Two rules live here so the page itself stays within the file-size ratchet:
 *
 *   - A ticket is cancelled, never hard-deleted. The API moves it to the org's
 *     terminal "Cancelled" state, so its history, comments and time survive and
 *     the move can be undone by putting it back into an open state.
 *   - The backlog is where a ticket gets planned, so "Add to sprint" is offered
 *     on the backlog card and targets the sprint the user is looking at (or the
 *     team's active sprint).
 */
import { useCallback } from "react";
import { assignTaskToSprint, deleteTask } from "../../../api/tasks";

interface UseTicketLifecycleArgs {
    availableSprints: any[];
    selectedSprintId: any;
    activeTab: string;
    showConfirm: (
        title: string,
        message: string,
        onConfirm: () => void,
        opts?: { confirmText?: string; isDanger?: boolean },
    ) => void;
    closeConfirm: () => void;
    setError: (message: string) => void;
    fetchTasks: () => void;
    fetchBacklog: () => void;
    toast: { success: (message: string) => void };
}

export function useTicketLifecycle({
    availableSprints,
    selectedSprintId,
    activeTab,
    showConfirm,
    closeConfirm,
    setError,
    fetchTasks,
    fetchBacklog,
    toast,
}: UseTicketLifecycleArgs) {
    /** Cancel a ticket: it leaves the open work but keeps its record. */
    const cancelTicket = useCallback(
        async (task: any) => {
            try {
                await deleteTask(task.id);
                fetchTasks();
                if (activeTab === "backlog") fetchBacklog();
                toast.success("Ticket cancelled");
            } catch (err: any) {
                setError(err?.response?.data?.error || "Failed to cancel ticket");
            }
        },
        [activeTab, fetchTasks, fetchBacklog, setError, toast],
    );

    /** Move a backlog ticket into a sprint, after confirming the target. */
    const addToSprint = useCallback(
        (task: any) => {
            const target =
                availableSprints.find((sp: any) => sp.id === selectedSprintId) ||
                availableSprints.find((sp: any) => sp.status === "active") ||
                availableSprints[0];
            if (!target) {
                setError("No sprint available to add this ticket to");
                return;
            }
            showConfirm(
                "Add to sprint",
                `Move "${task.title}" into ${target.name}?`,
                async () => {
                    closeConfirm();
                    try {
                        await assignTaskToSprint(task.id, target.id);
                        fetchBacklog();
                        fetchTasks();
                        toast.success(`Added to ${target.name}`);
                    } catch (err: any) {
                        setError(err?.response?.data?.error || "Failed to add ticket to sprint");
                    }
                },
                { confirmText: "Add" },
            );
        },
        [
            availableSprints,
            selectedSprintId,
            showConfirm,
            closeConfirm,
            setError,
            fetchBacklog,
            fetchTasks,
            toast,
        ],
    );

    /** Ask before cancelling a batch; cancelling is reversible but not silent. */
    const confirmBulkCancel = useCallback(
        (count: number, onConfirm: () => void) => {
            showConfirm(
                "Cancel tickets",
                `Cancel ${count} ticket${count === 1 ? "" : "s"}? They keep their history and leave the open work.`,
                () => {
                    closeConfirm();
                    onConfirm();
                },
                { confirmText: "Cancel tickets", isDanger: true },
            );
        },
        [showConfirm, closeConfirm],
    );

    return { cancelTicket, addToSprint, confirmBulkCancel };
}
