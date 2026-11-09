/** Server project tabs are authoritative; legacy team surfaces retain their compatibility rule. */
import type { TasksView } from "./useTasksRoute";

export interface PlanningSurface {
    tabs: TasksView[];
    currentSprintId: number | string | null;
}

/**
 * The tabs in the order they are shown. `PlanningTabs` renders exactly this
 * list, so a surface added to the rule cannot silently miss the row (or appear
 * in it without the rule agreeing).
 */
export const TAB_ORDER: TasksView[] = ["sprint", "backlog", "service-desk"];

/** Shown instead of the Sprint board when there is no current sprint. */
export const DATED_TAB: TasksView = "scheduled";

/** With no current sprint the dated list takes the board's place. */
const DATED_ORDER: TasksView[] = ["backlog", "scheduled", "service-desk"];

export function planningTabs({
    agileEnabled,
    currentSprintId,
    planTabs,
}: {
    agileEnabled: boolean;
    currentSprintId: number | string | null;
    planTabs?: TasksView[];
}): PlanningSurface {
    if (planTabs) return { tabs: [...planTabs, "service-desk"], currentSprintId };
    const current = agileEnabled ? currentSprintId : null;
    // `TAB_ORDER` holds the sprint-led set; the dated surface replaces the
    // board when there is no current sprint, so the two can never both be offered.
    const tabs: TasksView[] = current ? [...TAB_ORDER] : [...DATED_ORDER];
    return { tabs, currentSprintId: current };
}
