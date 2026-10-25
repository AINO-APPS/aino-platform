import { useCallback, useEffect, useState } from "react";
import {
    assignTaskToSprint,
    getRecentVelocity,
    getSprintBurndown,
    updateSprint,
} from "../../../api/tasks";

interface UseSprintPlanArgs {
    sprintId: number | string | null;
    fetchTasks: () => void;
    fetchBacklog: () => void;
    onError?: (message: string) => void;
}

/**
 * Data for the Plan split view: recent velocity, the mini burndown, and the
 * two moves that pull work in or push it back out.
 */
export function useSprintPlan({
    sprintId,
    fetchTasks,
    fetchBacklog,
    onError,
}: UseSprintPlanArgs) {
    const [velocity, setVelocity] = useState<{ sprints: any[]; average: number }>({
        sprints: [],
        average: 0,
    });
    const [burndown, setBurndown] = useState<any[]>([]);

    useEffect(() => {
        let cancelled = false;
        getRecentVelocity(3)
            .then((res) => {
                if (!cancelled) setVelocity(res.data || { sprints: [], average: 0 });
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!sprintId) {
            setBurndown([]);
            return;
        }
        let cancelled = false;
        getSprintBurndown(sprintId)
            .then((res) => {
                if (!cancelled) setBurndown(res.data?.snapshots || res.data || []);
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, [sprintId]);

    const moveToSprint = useCallback(
        async (taskId: number | string) => {
            if (!sprintId) return;
            try {
                await assignTaskToSprint(taskId, sprintId);
                // Both lists update immediately; the reload confirms it.
                fetchBacklog();
                fetchTasks();
            } catch {
                onError?.("Failed to move task into the sprint");
            }
        },
        [sprintId, fetchBacklog, fetchTasks, onError],
    );

    const moveToBacklog = useCallback(
        async (taskId: number | string) => {
            try {
                await assignTaskToSprint(taskId, "");
                fetchBacklog();
                fetchTasks();
            } catch {
                onError?.("Failed to move task back to the backlog");
            }
        },
        [fetchBacklog, fetchTasks, onError],
    );

    const saveGoal = useCallback(
        async (goal: string) => {
            if (!sprintId) return;
            try {
                await updateSprint(sprintId, { goal });
            } catch {
                onError?.("Failed to save the sprint goal");
            }
        },
        [sprintId, onError],
    );

    return { velocity, burndown, moveToSprint, moveToBacklog, saveGoal };
}
