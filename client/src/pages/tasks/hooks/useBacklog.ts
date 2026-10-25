import { useState, useCallback, useMemo, useEffect } from "react";
import { getBacklog, addBacklogTask, scheduleTask, unscheduleTask, assignTaskToSprint, updateTask, bulkTaskAction } from "../../../api/tasks";
import { getLocalToday } from "../../../api/client";
import useRealtimeEvent from "../../../hooks/useRealtimeEvent";
import { useVisiblePoll } from "./useVisiblePoll";
import { useTaskPreferences } from "./useTaskPreferences";
import { useBacklogReorder } from "./useBacklogReorder";
import { useUndo } from "./useUndo";
import { useBulkSelection, type BulkAction, type BulkResult } from "./useBulkSelection";
import { useTaskDeltas } from "./useTaskDeltas";
import type { Task } from "../../../types";

/**
 * Put a bulk action back the way it was.
 *
 * The bulk endpoint reports each task's prior value, so undo replays those
 * values through the same endpoint rather than refetching and hoping. A
 * deleted task cannot be restored this way — the row is gone — so delete is
 * the one action whose undo is a refetch.
 */
async function reverseBulkAction(action: BulkAction, applied: BulkResult[]): Promise<void> {
    if (action === "delete" || applied.length === 0) return;

    if (action === "move_to_sprint") {
        // Group by the sprint each task came from so one request per sprint.
        const bySprint = new Map<number | null, number[]>();
        applied.forEach((result) => {
            const sprintId = (result.previous?.sprint_id ?? null) as number | null;
            bySprint.set(sprintId, [...(bySprint.get(sprintId) ?? []), result.id]);
        });
        for (const [sprintId, group] of bySprint) {
            await bulkTaskAction({ ids: group, action: "move_to_sprint", value: sprintId });
        }
        return;
    }

    if (action === "status") {
        const byState = new Map<number, number[]>();
        applied.forEach((result) => {
            const stateId = result.previous?.workflow_state_id as number | undefined;
            if (stateId === undefined) return;
            byState.set(stateId, [...(byState.get(stateId) ?? []), result.id]);
        });
        for (const [stateId, group] of byState) {
            await bulkTaskAction({ ids: group, action: "status", value: stateId });
        }
        return;
    }

    if (action === "assign") {
        const byAssignee = new Map<number | null, number[]>();
        applied.forEach((result) => {
            const assignee = (result.previous?.assigned_to ?? null) as number | null;
            byAssignee.set(assignee, [...(byAssignee.get(assignee) ?? []), result.id]);
        });
        for (const [assignee, group] of byAssignee) {
            await bulkTaskAction({ ids: group, action: "assign", value: assignee });
        }
    }
}

interface BacklogSummary {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
}

type ShowConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    opts?: { confirmText?: string; isDanger?: boolean },
) => void;

interface UseBacklogParams {
    activeTab: string;
    backlogOpen: boolean;
    date: string;
    backlogFilters: Record<string, unknown> | null;
    selectedSprintId: number | string | null;
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
    fetchTasks: () => void;
    setError: (msg: string) => void;
    /** Called after a successful schedule (e.g. a toast with a "View" action). */
    onScheduled?: (taskId: number | string, date: string) => void;
}

export function useBacklog({
    activeTab,
    backlogOpen,
    date,
    backlogFilters,
    selectedSprintId,
    showConfirm,
    closeConfirm,
    fetchTasks,
    setError,
    onScheduled,
}: UseBacklogParams) {
    const [backlogTasks, setBacklogTasks] = useState<Task[]>([]);
    const [backlogLoading, setBacklogLoading] = useState(false);
    const [backlogFormOpen, setBacklogFormOpen] = useState(false);
    const [backlogTitle, setBacklogTitle] = useState("");
    const [backlogDesc, setBacklogDesc] = useState("");
    const [backlogPriority, setBacklogPriority] = useState("medium");
    const [backlogAssignedTo, setBacklogAssignedTo] = useState("");
    const [backlogDueDate, setBacklogDueDate] = useState("");
    const [backlogLabels, setBacklogLabels] = useState<(number | string)[]>([]);
    const [backlogLabelDropdownOpen, setBacklogLabelDropdownOpen] =
        useState(false);
    const [backlogSprintId, setBacklogSprintId] = useState("");
    const [backlogStoryPoints, setBacklogStoryPoints] = useState<number | null>(
        null,
    );
    const [backlogWorkItemType, setBacklogWorkItemType] = useState("");
    const [backlogProjectId, setBacklogProjectId] = useState("");
    const [scheduleTaskId, setScheduleTaskId] = useState<number | string | null>(
        null,
    );
    const [scheduleDate, setScheduleDate] = useState<string>(() => getLocalToday());
    const [backlogSummary, setBacklogSummary] = useState<BacklogSummary>({
        total: 0,
        byStatus: {},
        byPriority: {},
    });
    const [backlogSort, setBacklogSort] = useState("priority");
    const [importConfigTask, setImportConfigTask] = useState<Task | null>(null);
    const [importAssignedTo, setImportAssignedTo] = useState("");
    const [importDueDate, setImportDueDate] = useState("");
    // Pagination state. Server caps page size and returns
    // { tasks, summary, pagination: { limit, offset, total, hasMore } } so we
    // can drive page controls without a second round-trip for the total.
    const [backlogLimit, setBacklogLimit] = useState(25);
    const [backlogOffset, setBacklogOffset] = useState(0);
    const [backlogTotal, setBacklogTotal] = useState(0);
    // Completed work is hidden by default. The count comes from the first
    // backlog response; expanding loads the recent window, and "View all"
    // removes the window.
    const [completedCount, setCompletedCount] = useState(0);
    const [completedTasks, setCompletedTasks] = useState<Task[]>([]);
    const [completedOpen, setCompletedOpen] = useState(false);
    const [completedLoading, setCompletedLoading] = useState(false);
    const [completedShowingAll, setCompletedShowingAll] = useState(false);
    // Manual ordering: the client sends neighbours, the server computes rank.
    const [reorderAnnouncement, setReorderAnnouncement] = useState("");
    const reorder = useBacklogReorder({
        tasks: backlogTasks as any,
        setTasks: (updater) => setBacklogTasks((current) => updater(current as any) as any),
        onError: setError,
        onAnnounce: setReorderAnnouncement,
    });
    const undo = useUndo();
    // Bulk actions are backlog-only. Selection is keyed by id, so it survives
    // reordering, and one undo reverses the whole batch.
    const bulk = useBulkSelection({
        onApplied: (action, changed, results) => {
            // The server reports what each task was before the action, so undo
            // can put it back rather than merely refetching and hoping.
            const applied = results.filter((result) => result.ok && result.previous);
            undo.register({
                label: `Bulk ${action.replace(/_/g, " ")} (${changed})`,
                undo: async () => {
                    await reverseBulkAction(action, applied);
                    await fetchBacklog(true);
                },
            });
            void fetchBacklog(true);
        },
        onError: setError,
    });
    // The stored preference decides whether the section starts expanded. A
    // `completed` URL parameter overrides it for this view only.
    const { showCompleted, preferences, setCardDensity } = useTaskPreferences();
    useEffect(() => {
        setCompletedOpen(showCompleted);
    }, [showCompleted]);

    // Resetting offset on filter/page-size change avoids landing on an empty
    // page when the filtered result set shrinks below the current offset.
    useEffect(() => {
        setBacklogOffset(0);
    }, [backlogFilters, backlogLimit]);

    /**
     * Load the backlog page.
     *
     * `quiet` refreshes the rows in place without flipping `backlogLoading`.
     * The visible-tab poll and realtime refreshes use it: the tab renders a
     * full-panel spinner while loading, so a background refresh would blank
     * the list every 30 seconds. Only a user-initiated load (first paint,
     * filter/page change) shows the spinner.
     */
    const fetchBacklog = useCallback(async (quiet = false) => {
        if (!quiet) setBacklogLoading(true);
        try {
            const res = await getBacklog({
                ...(backlogFilters || {}),
                limit: backlogLimit,
                offset: backlogOffset,
            });
            const data = res.data as {
                tasks: Task[];
                summary?: BacklogSummary;
                completed_count?: number;
                pagination?: { total?: number };
            };
            setBacklogTasks(data.tasks);
            if (typeof data.completed_count === "number") {
                setCompletedCount(data.completed_count);
            }
            if (data.summary) setBacklogSummary(data.summary);
            // `pagination.total` is the authoritative count for the current
            // filter set; fall back to summary.total / list length for older
            // server builds that don't return pagination.
            if (data.pagination?.total != null) {
                setBacklogTotal(data.pagination.total);
            } else if (data.summary?.total != null) {
                setBacklogTotal(data.summary.total);
            } else {
                setBacklogTotal(data.tasks?.length || 0);
            }
        } catch {
            setError("Failed to load backlog");
        } finally {
            if (!quiet) setBacklogLoading(false);
        }
    }, [backlogFilters, backlogLimit, backlogOffset]);

    const sortedBacklogTasks = useMemo(() => {
        const sorted = [...backlogTasks];
        switch (backlogSort) {
            case "priority":
                sorted.sort((a, b) => {
                    const order: Record<string, number> = {
                        high: 0,
                        medium: 1,
                        low: 2,
                    };
                    return (
                        (order[a.priority as string] ?? 1) -
                        (order[b.priority as string] ?? 1)
                    );
                });
                break;
            case "newest":
                sorted.sort(
                    (a, b) =>
                        new Date(b.created_at as string).getTime() -
                        new Date(a.created_at as string).getTime(),
                );
                break;
            case "oldest":
                sorted.sort(
                    (a, b) =>
                        new Date(a.created_at as string).getTime() -
                        new Date(b.created_at as string).getTime(),
                );
                break;
            case "due_date":
                sorted.sort((a, b) => {
                    if (!a.due_date && !b.due_date) return 0;
                    if (!a.due_date) return 1;
                    if (!b.due_date) return -1;
                    return (a.due_date as string).localeCompare(
                        b.due_date as string,
                    );
                });
                break;
            case "title":
                sorted.sort((a, b) =>
                    (a.title || "").localeCompare(b.title || ""),
                );
                break;
            default:
                break;
        }
        return sorted;
    }, [backlogTasks, backlogSort]);

    const handleAddBacklog = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!backlogTitle.trim()) return;
        try {
            await addBacklogTask({
                title: backlogTitle,
                description: backlogDesc,
                priority: backlogPriority,
                assigned_to: backlogAssignedTo || null,
                due_date: backlogDueDate || null,
                label_ids: backlogLabels.length > 0 ? backlogLabels : undefined,
                sprint_id: backlogSprintId || null,
                story_points: backlogStoryPoints,
                work_item_type_id: backlogWorkItemType || null,
                project_id: backlogProjectId || null,
            });
            setBacklogTitle("");
            setBacklogDesc("");
            setBacklogPriority("medium");
            setBacklogAssignedTo("");
            setBacklogDueDate("");
            setBacklogLabels([]);
            setBacklogSprintId("");
            setBacklogStoryPoints(null);
            setBacklogWorkItemType("");
            setBacklogProjectId("");
            setBacklogFormOpen(false);
            fetchBacklog(true);
            if (backlogSprintId && activeTab === "sprint") fetchTasks();
        } catch (err) {
            const error = err as {
                response?: { data?: { error?: string } };
            };
            setError(
                error.response?.data?.error || "Failed to create backlog item",
            );
        }
    };

    /**
     * Quick-add: create from a title alone and keep the list in place. The
     * caller keeps focus, so consecutive entry never needs the mouse.
     */
    const quickAdd = useCallback(async (title: string) => {
        try {
            await addBacklogTask({ title, priority: "medium" });
            await fetchBacklog(true);
        } catch (err) {
            const error = err as { response?: { data?: { error?: string } } };
            setError(error.response?.data?.error || "Failed to create backlog item");
        }
    }, [fetchBacklog, setError]);

    /**
     * Inline edit: patch one field without opening the detail view. The prior
     * value is registered for undo so a mis-click is reversible.
     */
    const inlineEdit = useCallback(async (
        task: Task,
        patch: Record<string, unknown>,
    ) => {
        const previous = Object.fromEntries(
            Object.keys(patch).map((key) => [key, (task as any)[key]]),
        );
        setBacklogTasks((current) =>
            current.map((item) => (item.id === task.id ? { ...item, ...patch } : item)),
        );
        try {
            await updateTask(task.id, patch);
            undo.register({
                label: "Edited ticket",
                undo: async () => {
                    await updateTask(task.id, previous);
                    await fetchBacklog(true);
                },
            });
        } catch {
            setBacklogTasks((current) =>
                current.map((item) => (item.id === task.id ? { ...item, ...previous } : item)),
            );
            setError("Failed to save ticket");
        }
    }, [fetchBacklog, setError, undo, setBacklogTasks]);

    const handleScheduleTask = (
        taskId: number | string,
        taskTitle: string | undefined,
        closeAfter?: () => void,
        overrideDate?: string,
    ) => {
        const dateToUse = overrideDate || scheduleDate;
        if (!dateToUse) return;
        showConfirm(
            "Schedule Task",
            `Schedule "${taskTitle || "this task"}" to ${dateToUse}?`,
            async () => {
                closeConfirm();
                try {
                    await scheduleTask(taskId, dateToUse);
                    setScheduleTaskId(null);
                    fetchBacklog(true);
                    if (dateToUse === date) fetchTasks();
                    if (closeAfter) closeAfter();
                    onScheduled?.(taskId, dateToUse);
                } catch {
                    setError("Failed to schedule task");
                }
            },
            { confirmText: "Schedule" },
        );
    };

    const handleUnscheduleTask = (
        taskId: number | string,
        taskTitle: string | undefined,
        closeAfter?: () => void,
    ) => {
        showConfirm(
            "Move to Backlog",
            `Move "${taskTitle || "this task"}" to backlog? It will be removed from the planner.`,
            async () => {
                closeConfirm();
                try {
                    await unscheduleTask(taskId);
                    fetchTasks();
                    if (backlogOpen || activeTab === "backlog") fetchBacklog(true);
                    if (closeAfter) closeAfter();
                } catch {
                    setError("Failed to move task to backlog");
                }
            },
            { confirmText: "Move to Backlog" },
        );
    };

    const handleImportToSprint = async () => {
        if (!importConfigTask || !selectedSprintId) return;
        const importedId = importConfigTask.id;
        try {
            await assignTaskToSprint(importedId, selectedSprintId);
            if (importAssignedTo || importDueDate) {
                await updateTask(importedId, {
                    assigned_to: importAssignedTo || null,
                    due_date: importDueDate || null,
                });
            }
            setBacklogTasks((prev) => prev.filter((t) => t.id !== importedId));
            setImportConfigTask(null);
            setImportAssignedTo("");
            setImportDueDate("");
            fetchTasks();
            fetchBacklog(true);
        } catch {
            setError("Failed to import task to sprint");
        }
    };

    // Live refresh of the Tasks page: edits/status moves/comments/assignments
    // made by other users or on other devices (server `task_updated`).
    // Quiet: a background refresh must not blank the list behind a spinner.
    const refreshVisible = () => {
        if (activeTab === "backlog") fetchBacklog(true);
        else if (activeTab === "sprint") fetchTasks();
    };
    // Field deltas patch the rows already on screen, so a teammate's edit lands
    // without a refetch and without flicker. `task_assigned` still refetches
    // because it can add a row that is not on screen yet.
    const deltas = useTaskDeltas(setBacklogTasks, {
        enabled: activeTab === "backlog",
    });
    useRealtimeEvent(["task_assigned"], refreshVisible);
    // Teammates' edits never reach this user's socket; poll while visible.
    useVisiblePoll(refreshVisible, 30_000, activeTab === "backlog" || activeTab === "sprint");

    /**
     * Load the completed window: the last 30 days, or the last closed sprint
     * when that reaches further back. "View all" drops the window entirely.
     */
    const fetchCompleted = useCallback(async (showAll = false) => {
        setCompletedLoading(true);
        try {
            const params: Record<string, unknown> = {
                ...(backlogFilters || {}),
                include_completed: 1,
                completed_only: 1,
                limit: 100,
                offset: 0,
            };
            if (!showAll) {
                const since = new Date();
                since.setDate(since.getDate() - 30);
                params.completed_since = since.toISOString().slice(0, 10);
            }
            const res = await getBacklog(params);
            const data = res.data as { tasks?: Task[] };
            setCompletedTasks(data.tasks || []);
            setCompletedShowingAll(showAll);
        } catch {
            setError("Failed to load completed work");
        } finally {
            setCompletedLoading(false);
        }
    }, [backlogFilters, setError]);

    const toggleCompleted = useCallback(() => {
        setCompletedOpen((open) => {
            const next = !open;
            if (next && completedTasks.length === 0) void fetchCompleted(false);
            return next;
        });
    }, [completedTasks.length, fetchCompleted]);

    const showAllCompleted = useCallback(() => {
        void fetchCompleted(true);
    }, [fetchCompleted]);

    return {
        backlogTasks,
        setBacklogTasks,
        backlogLoading,
        completedCount,
        completedTasks,
        completedOpen,
        completedLoading,
        completedShowingAll,
        toggleCompleted,
        showAllCompleted,
        cardDensity: preferences.card_density,
        setCardDensity,
        attribution: deltas.attribution,
        reorder,
        reorderAnnouncement,
        quickAdd,
        inlineEdit,
        undo,
        bulk,
        backlogFormOpen,
        setBacklogFormOpen,
        backlogTitle,
        setBacklogTitle,
        backlogDesc,
        setBacklogDesc,
        backlogPriority,
        setBacklogPriority,
        backlogAssignedTo,
        setBacklogAssignedTo,
        backlogDueDate,
        setBacklogDueDate,
        backlogLabels,
        setBacklogLabels,
        backlogLabelDropdownOpen,
        setBacklogLabelDropdownOpen,
        backlogSprintId,
        setBacklogSprintId,
        backlogStoryPoints,
        setBacklogStoryPoints,
        backlogWorkItemType,
        setBacklogWorkItemType,
        backlogProjectId,
        setBacklogProjectId,
        backlogLimit,
        setBacklogLimit,
        backlogOffset,
        setBacklogOffset,
        backlogTotal,
        scheduleTaskId,
        setScheduleTaskId,
        scheduleDate,
        setScheduleDate,
        backlogSummary,
        backlogSort,
        setBacklogSort,
        importConfigTask,
        setImportConfigTask,
        importAssignedTo,
        setImportAssignedTo,
        importDueDate,
        setImportDueDate,
        fetchBacklog,
        sortedBacklogTasks,
        handleAddBacklog,
        handleScheduleTask,
        handleUnscheduleTask,
        handleImportToSprint,
    };
}