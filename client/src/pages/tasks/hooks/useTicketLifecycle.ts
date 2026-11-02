/**
 * The Tasks page's ticket-lifecycle actions.
 *
 * Two rules live here so the page itself stays within the file-size ratchet:
 *
 *   - A ticket is cancelled, never hard-deleted. The API moves it to the org's
 *     terminal "Cancelled" state, so its history, comments and time survive and
 *     cancellation is terminal.
 *   - The backlog is where a ticket gets planned, so "Add to sprint" is offered
 *     on the backlog card and targets the sprint the user is looking at (or the
 *     team's current sprint).
 */
import { useCallback } from "react";
import { assignTaskToSprint, deleteTask } from "../../../api/tasks";
import { showsBacklog } from "./useTasksRoute";
import { writeError } from "../ticketCapabilities";

interface UseTicketLifecycleArgs {
    onReplaced?: (ticket: any) => void;
    availableSprints: any[];
    currentSprintId: number | string | null;
    selectedSprintId: any;
    activeTab: string;
    /** True when the sprint tab is showing the Plan split view, which renders the backlog. */
    planOpen?: boolean;
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
    currentSprintId,
    selectedSprintId,
    activeTab,
    planOpen = false,
    showConfirm,
    closeConfirm,
    setError,
    fetchTasks,
    fetchBacklog,
    toast,
    onReplaced,
}: UseTicketLifecycleArgs) {
    /** Cancel a ticket: it leaves the open work but keeps its record. */
    const cancelTicket = useCallback(
        async (task: any) => {
            try {
                const { data } = await deleteTask(task.id);
                onReplaced?.(data.task);
                fetchTasks();
                if (showsBacklog(activeTab, planOpen)) fetchBacklog();
                toast.success("Ticket cancelled");
            } catch (err: any) {
                setError(writeError(err, "Failed to cancel ticket"));
            }
        },
        [activeTab, planOpen, fetchTasks, fetchBacklog, setError, toast, onReplaced],
    );

    /** Move a backlog ticket into a sprint, after confirming the target. */
    const addToSprint = useCallback(
        (task: any) => {
            const target =
                availableSprints.find((sp: any) => sp.id === selectedSprintId) ||
                availableSprints.find((sp: any) => sp.id === currentSprintId) ||
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
                        const { data } = await assignTaskToSprint(task.id, target.id);
                        onReplaced?.(data);
                        fetchBacklog();
                        fetchTasks();
                        toast.success(`Added to ${target.name}`);
                    } catch (err: any) {
                        setError(writeError(err, "Failed to add ticket to sprint"));
                    }
                },
                { confirmText: "Add" },
            );
        },
        [
            availableSprints,
            currentSprintId,
            selectedSprintId,
            showConfirm,
            closeConfirm,
            setError,
            fetchBacklog,
            fetchTasks,
            toast,
            onReplaced,
        ],
    );

    /** Ask before cancelling a batch; cancellation is terminal. */
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
