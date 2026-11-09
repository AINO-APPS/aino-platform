/** Server project tabs are authoritative; legacy team surfaces keep stable planning tabs. */
import type { TasksView } from "./useTasksRoute";

export interface PlanningSurface {
    tabs: TasksView[];
    currentSprintId: number | string | null;
}

/**
 * The legacy team tabs in the order they are shown.
 */
export const TAB_ORDER: TasksView[] = ["sprint", "backlog", "service-desk"];

export function planningTabs({
    agileEnabled,
    currentSprintId,
    planTabs,
}: {
    agileEnabled: boolean;
    currentSprintId: number | string | null;
    planTabs?: TasksView[];
}): PlanningSurface {
    if (planTabs) return { tabs: [...planTabs], currentSprintId };
    const tabs: TasksView[] = agileEnabled ? [...TAB_ORDER] : ["backlog", "service-desk"];
    return { tabs, currentSprintId: agileEnabled ? currentSprintId : null };
}
