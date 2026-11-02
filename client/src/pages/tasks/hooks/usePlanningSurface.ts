/**
 * Which tabs a team gets, decided by the server's currentSprintId.
 *
 * Sprint and Scheduled are **alternatives**, never companions: a team that
 * plans work in a sprint plans it there, and a dated list beside it is noise.
 * So a current sprint shows the Sprint board, Backlog and Service Desk; with no
 * current sprint there is no board to show, Scheduled takes its place, and the
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
}: {
    agileEnabled: boolean;
    currentSprintId: number | string | null;
}): PlanningSurface {
    const current = agileEnabled ? currentSprintId : null;
    // `TAB_ORDER` holds the sprint-led set; the dated surface replaces the
    // board when there is no current sprint, so the two can never both be offered.
    const tabs: TasksView[] = current ? [...TAB_ORDER] : [...DATED_ORDER];
    return { tabs, currentSprintId: current };
}
