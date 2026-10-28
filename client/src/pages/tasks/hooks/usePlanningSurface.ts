/**
 * Which tabs a team gets, decided by its sprint state.
 *
 * A started sprint is the team's working surface: the Sprint board leads and
 * Backlog / Scheduled sit beside it. With no active sprint there is no board to
 * show, so the Sprint tab is hidden and the team works from Backlog and
 * Scheduled. Service Desk belongs to every team.
 *
 * The sprint list must already be narrowed to the selected team (an admin's
 * picker or the user's own team) so one team's sprint never drives another's
 * tabs.
 */
import type { TasksView } from "./useTasksRoute";

export interface PlanningSurface {
    tabs: TasksView[];
    activeSprintId: number | string | null;
}

/**
 * The tabs in the order they are shown. `PlanningTabs` renders exactly this
 * list, so a surface added to the rule cannot silently miss the row (or appear
 * in it without the rule agreeing).
 */
export const TAB_ORDER: TasksView[] = ["sprint", "backlog", "scheduled", "service-desk"];

export function activeSprintOf(sprints: any[]): any | null {
    return sprints.find((sprint) => sprint?.status === "active") ?? null;
}

export function planningTabs({
    agileEnabled,
    sprints,
}: {
    agileEnabled: boolean;
    sprints: any[];
}): PlanningSurface {
    const active = agileEnabled ? activeSprintOf(sprints) : null;
    const tabs = TAB_ORDER.filter((tab) => tab !== "sprint" || active != null);
    return { tabs, activeSprintId: active?.id ?? null };
}
