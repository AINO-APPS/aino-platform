import { useCallback, useEffect, useState } from "react";
import { getSprintStats } from "../../../api/tasks";

export function useSprintStats(
    activeTab: string,
    sprintId: number | string | null,
    taskCount: number,
    completedCount: number,
) {
    const [sprintStats, setSprintStats] = useState<any>(null);
    const refreshSprintStats = useCallback(() => {
        if (activeTab !== "sprint" || !sprintId) {
            setSprintStats(null);
            return;
        }
        getSprintStats(sprintId)
            .then((response) => setSprintStats(response.data))
            .catch(() => setSprintStats(null));
    }, [activeTab, sprintId]);

    useEffect(() => {
        refreshSprintStats();
    }, [refreshSprintStats, taskCount, completedCount]);

    return { sprintStats, refreshSprintStats };
}
