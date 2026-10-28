import { useState } from "react";
import { updateTaskStatus } from "../../../api/tasks";

type ShowConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    opts?: { confirmText?: string; isDanger?: boolean },
) => void;

/**
 * The one-click task actions on the Tasks page: toggling completion and the
 * backlog label chips. Kept here so the page itself stays a composition of
 * hooks.
 */
export function useTaskQuickActions({
    showConfirm,
    closeConfirm,
    fetchTasks,
    setError,
    initialState,
    terminalStates,
}: {
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
    fetchTasks: () => void;
    setError: (message: string) => void;
    initialState: any;
    terminalStates: any[];
}) {
    const toggleDone = (task: any) => {
        // The workflow state is the only status (D4): toggling completion moves
        // to the org's terminal state, or back to its initial one.
        const newStatus = task.completed_at ? initialState?.key : terminalStates?.[0]?.key;
        if (!newStatus) return;
        const label = task.completed_at ? "Mark as incomplete" : "Mark as done";
        showConfirm(
            label,
            `${label}: "${task.title}"?`,
            async () => {
                closeConfirm();
                try {
                    await updateTaskStatus(task.id, newStatus);
                    fetchTasks();
                } catch {
                    setError("Failed to update task");
                }
            },
            { confirmText: label },
        );
    };
    return { toggleDone };
}

/** The Backlog summary strip's actions: open the filters a count implies. */
export function useSummaryFilters(filters: any) {
    const showTotal = () => {
        filters.setFiltersOpen(true);
        filters.setFilterPriority("");
        filters.setFilterStatus("");
    };
    const showPriority = (value: string) => {
        filters.setFiltersOpen(true);
        filters.setFilterPriority((prev: string) => (prev === value ? "" : value));
    };
    return { showTotal, showPriority };
}

/** Add or remove one label id from a selected list. */
export function toggleLabelId(labelId: any, list: any[], setter: (updater: (prev: any[]) => any[]) => void) {
    setter((prev) =>
        prev.includes(labelId) ? prev.filter((id) => id !== labelId) : [...prev, labelId],
    );
}

