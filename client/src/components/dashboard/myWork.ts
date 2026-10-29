/**
 * The rules behind the home "My Work" card.
 *
 * The card shows the user's tickets in the running sprint, or — when there is
 * no running sprint — the tickets planned into this week. These functions hold
 * both modes' filtering and bucketing so the component stays a renderer and the
 * two modes cannot drift apart.
 *
 * Nothing here re-derives a planning container: the caller asks the server for
 * the ADR-015 containers (a sprint's tickets, or `GET /tasks?start_date&end_date`
 * for Scheduled) and these helpers decide what is the viewer's and how it groups.
 */
import { addDays, parseDateString, startOfWeek, toDateString } from "../../pages/tasks/calendar";

/** The subset of the enriched task row the card reads. */
export interface MyWorkTask {
    id: number | string;
    title: string;
    priority?: string | null;
    planned_date?: string | null;
    assigned_to?: number | string | null;
    /** The workflow state is the only status (D4). */
    workflow_state_key?: string | null;
    workflow_state_name?: string | null;
    workflow_state_category?: string | null;
    completed_at?: string | null;
}

export interface DayRange {
    start: string;
    end: string;
}

export interface MyWorkGroup {
    key: string;
    label: string;
    tasks: MyWorkTask[];
}

/** How many rows the card shows before it collapses the rest into "＋N more". */
export const MY_WORK_ROW_LIMIT = 6;

/** How far back the Overdue lookup reaches. Older slipped work is history. */
export const OVERDUE_DAYS = 30;

/** The workflow state a ticket reaches by cancelling; never shown in "my work". */
export const CANCELLED_STATE_KEY = "cancelled";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Monday to Sunday of the week containing `today`, in local time.
 *
 * `startOfWeek` owns the Monday arithmetic (and the local-time rule that keeps a
 * Sunday afternoon in the week that began six days earlier); this only adds the
 * closing Sunday the card needs for its range query.
 */
export function weekRange(today: Date = new Date()): DayRange {
    const start = startOfWeek(toDateString(today));
    return { start, end: addDays(start, 6) };
}

/** The Sunday that closes the previous week — the Overdue range's end. */
export function previousWeekEnd(monday: string): string {
    return addDays(monday, -1);
}

/** The first day the Overdue lookup reaches back to. */
export function overdueFrom(monday: string): string {
    return addDays(previousWeekEnd(monday), -(OVERDUE_DAYS - 1));
}

function isMine(task: MyWorkTask, userId: number | string): boolean {
    return task.assigned_to != null && String(task.assigned_to) === String(userId);
}

function isCancelled(task: MyWorkTask): boolean {
    return task.workflow_state_key === CANCELLED_STATE_KEY;
}

/**
 * The viewer's commitments: assigned to them, not finished, not cancelled.
 *
 * Assignee is checked here rather than trusted from the request — the server's
 * `assignee=me` also returns tickets the viewer created and nobody picked up —
 * and cancelled is dropped because the date-range query does not carry the
 * board's cancelled exclusion.
 */
export function myOpenTasks(tasks: MyWorkTask[], userId: number | string): MyWorkTask[] {
    return tasks.filter((task) => isMine(task, userId) && !task.completed_at && !isCancelled(task));
}

/** Completed tickets of the same set, for the header's "N of M done". */
export function myDoneCount(tasks: MyWorkTask[], userId: number | string): number {
    return tasks.filter((task) => isMine(task, userId) && !!task.completed_at && !isCancelled(task)).length;
}

/** Everything of the viewer's, done and open, cancelled excluded. */
export function myWorkCount(tasks: MyWorkTask[], userId: number | string): number {
    return tasks.filter((task) => isMine(task, userId) && !isCancelled(task)).length;
}

/**
 * The dot colour for a workflow state.
 *
 * The server sends the state's key, name and category but not its colour, so the
 * card maps categories itself — the same three-tone convention the Tasks page
 * uses (`pages/tasks/scheduled`). An unknown or custom state reads as neutral.
 */
export function stateTone(task: MyWorkTask): "progress" | "review" | "neutral" {
    switch (task.workflow_state_category) {
        case "in_progress":
            return "progress";
        case "in_review":
            return "review";
        default:
            return "neutral";
    }
}

/** The team's own word for the state; the category is a reporting bucket. */
export function stateLabel(task: MyWorkTask): string {
    if (task.workflow_state_name) return task.workflow_state_name;
    switch (task.workflow_state_category) {
        case "in_progress":
            return "In Progress";
        case "in_review":
            return "In Review";
        case "done":
            return "Done";
        default:
            return "Pending";
    }
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

function priorityRank(priority?: string | null): number {
    return PRIORITY_ORDER[priority ?? ""] ?? 3;
}

/**
 * Week mode: **Overdue** first (rows keep their day in the label), then one
 * group per day of the week that has work, Monday through Sunday.
 *
 * The server returns this path priority-ordered, which is the order within a
 * day; only the buckets are reordered here.
 */
export function weekGroups(
    overdue: MyWorkTask[],
    week: MyWorkTask[],
    weekStart: string,
): MyWorkGroup[] {
    const groups: MyWorkGroup[] = [];
    if (overdue.length > 0) {
        const sorted = [...overdue].sort(
            (a, b) =>
                (a.planned_date ?? "").localeCompare(b.planned_date ?? "") ||
                priorityRank(a.priority) - priorityRank(b.priority),
        );
        groups.push({ key: "overdue", label: "Overdue", tasks: sorted });
    }
    for (let offset = 0; offset < 7; offset++) {
        const day = addDays(weekStart, offset);
        const tasks = week.filter((task) => task.planned_date === day);
        if (tasks.length === 0) continue;
        groups.push({ key: day, label: DAY_NAMES[parseDateString(day).getDay()], tasks });
    }
    return groups;
}

/**
 * Sprint mode: the viewer's open tickets, one flat block (a sprint is a container).
 *
 * The board scope orders by `created_at`, not by priority, so the card sorts —
 * "priority within a group" is the promise both modes make (spec D10).
 */
export function sprintGroups(tasks: MyWorkTask[]): MyWorkGroup[] {
    if (tasks.length === 0) return [];
    const sorted = [...tasks].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
    return [{ key: "sprint", label: "", tasks: sorted }];
}

/**
 * The day a row shows: only Overdue rows carry one, because the group header
 * already names the day everywhere else (spec D4).
 */
export function rowDayLabel(task: MyWorkTask, groupKey: string): string | null {
    if (groupKey !== "overdue" || !task.planned_date) return null;
    const date = parseDateString(task.planned_date);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Trim to `limit` rows across all groups, keeping group order and dropping a
 * group whose rows were all trimmed away.
 */
export function capGroups(
    groups: MyWorkGroup[],
    limit: number = MY_WORK_ROW_LIMIT,
): { groups: MyWorkGroup[]; hidden: number } {
    let remaining = limit;
    let hidden = 0;
    const kept: MyWorkGroup[] = [];
    for (const group of groups) {
        if (remaining <= 0) {
            hidden += group.tasks.length;
            continue;
        }
        const take = Math.min(remaining, group.tasks.length);
        remaining -= take;
        if (take > 0) kept.push({ ...group, tasks: group.tasks.slice(0, take) });
        hidden += group.tasks.length - take;
    }
    return { groups: kept, hidden };
}
