/**
 * Which tabs a team gets, decided by its sprint state.
 *
 * Sprint and Scheduled are **alternatives**, never companions: a team that
 * plans work in a sprint plans it there, and a dated list beside it is noise.
 * So a started sprint shows the Sprint board, Backlog and Service Desk; with no
 * started sprint there is no board to show, Scheduled takes its place, and the
 * team works from Backlog and Scheduled. Service Desk belongs to every team.
 *
 * Every entry point must agree: the tab row, the URL guard and the command
 * palette all read `tabs` from here, so hiding a tab cannot leave a way in.
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
export const TAB_ORDER: TasksView[] = ["sprint", "backlog", "service-desk"];

/** Shown instead of the Sprint board when no sprint is running. */
export const DATED_TAB: TasksView = "scheduled";

/** With no running sprint the dated list takes the board's place. */
const DATED_ORDER: TasksView[] = ["backlog", "scheduled", "service-desk"];

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
    // `TAB_ORDER` holds the sprint-led set; the dated surface replaces the
    // board when nothing is running, so the two can never both be offered.
    const tabs: TasksView[] = active ? [...TAB_ORDER] : [...DATED_ORDER];
    return { tabs, activeSprintId: active?.id ?? null };
}
