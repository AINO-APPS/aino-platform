/**
 * Calendar maths for the Schedule view.
 *
 * Dates are date-only strings (`YYYY-MM-DD`), matching the server's
 * `planned_date` column. "Today" is the viewer's local today.
 */

export type CalendarMode = "month" | "week" | "list";

export interface CalendarDay {
    date: string;
    inMonth: boolean;
    isToday: boolean;
}

function pad(value: number): string {
    return String(value).padStart(2, "0");
}

/** A local date as `YYYY-MM-DD`, with no timezone shift. */
export function toDateString(date: Date): string {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDateString(value: string): Date {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

export function addDays(value: string, days: number): string {
    const date = parseDateString(value);
    date.setDate(date.getDate() + days);
    return toDateString(date);
}

/** The Monday that starts the week containing `value`. */
export function startOfWeek(value: string): string {
    const date = parseDateString(value);
    const weekday = (date.getDay() + 6) % 7; // Monday = 0
    date.setDate(date.getDate() - weekday);
    return toDateString(date);
}

/** The first day of the month containing `value`. */
export function startOfMonth(value: string): string {
    const date = parseDateString(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

/**
 * The days a month grid renders: whole weeks, starting on Monday, covering the
 * month plus the leading and trailing days that complete the grid.
 */
export function monthGrid(anchor: string, today = toDateString(new Date())): CalendarDay[] {
    const first = startOfMonth(anchor);
    const gridStart = startOfWeek(first);
    const month = first.slice(0, 7);

    const days: CalendarDay[] = [];
    for (let index = 0; index < 42; index += 1) {
        const date = addDays(gridStart, index);
        days.push({ date, inMonth: date.startsWith(month), isToday: date === today });
    }
    return days;
}

/** The seven days of the week containing `anchor`. */
export function weekDays(anchor: string, today = toDateString(new Date())): CalendarDay[] {
    const start = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, index) => {
        const date = addDays(start, index);
        return { date, inMonth: true, isToday: date === today };
    });
}

export interface ScheduledTask {
    id: number | string;
    title?: string;
    planned_date?: string | null;
    due_date?: string | null;
    story_points?: number | null;
    completed_at?: string | null;
    [key: string]: unknown;
}

/** The planned day of a task. `planned_date` is the only scheduling field (D2). */
export function plannedDay(task: ScheduledTask): string | null {
    return task.planned_date || null;
}

/** Group tasks by their planned day. */
export function groupByDay(tasks: ScheduledTask[]): Map<string, ScheduledTask[]> {
    const groups = new Map<string, ScheduledTask[]>();
    for (const task of tasks) {
        const day = plannedDay(task);
        if (!day) continue;
        groups.set(day, [...(groups.get(day) ?? []), task]);
    }
    return groups;
}

/** Count and point total for a day, so overload is visible at a glance. */
export function dayTotals(tasks: ScheduledTask[]): { count: number; points: number } {
    return {
        count: tasks.length,
        points: tasks.reduce((sum, task) => sum + (Number(task.story_points) || 0), 0),
    };
}

/**
 * Overdue work: planned before today and not completed. It is pinned above the
 * calendar rather than shown inside past days.
 */
export function overdueTasks(tasks: ScheduledTask[], today = toDateString(new Date())): ScheduledTask[] {
    return tasks.filter((task) => {
        const day = plannedDay(task);
        return Boolean(day && day < today && !task.completed_at);
    });
}

/** The unscheduled tray: backlog work with no planned day. */
export function unscheduledTasks(tasks: ScheduledTask[]): ScheduledTask[] {
    return tasks.filter((task) => !plannedDay(task));
}
