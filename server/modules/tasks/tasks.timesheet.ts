/**
 * Task time in the timesheet.
 *
 * A stopped timer is a row in `task_timers`; the timesheet reads those rows so
 * the time a person logged against a task shows up next to their attendance
 * instead of living only on the task.
 */

export interface TaskTimerRow {
    task_id: number;
    task_title?: string | null;
    issue_key?: string | null;
    started_at: string | Date;
    stopped_at?: string | Date | null;
    minutes?: number | null;
}

export interface TaskTimeEntry {
    task_id: number;
    title: string;
    issue_key: string | null;
    date: string;
    minutes: number;
}

export interface TaskTimeDay {
    date: string;
    minutes: number;
    entries: TaskTimeEntry[];
}

function toMinutes(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/** The local calendar day a timer belongs to, from its start instant. */
export function localDate(startedAt: string | Date, timezoneOffsetMinutes = 0): string {
    const ms = new Date(startedAt).getTime();
    if (!Number.isFinite(ms)) return "";
    return new Date(ms - timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * Group stopped timers into per-day, per-task rows, newest day first.
 *
 * `timezoneOffsetMinutes` is JS `getTimezoneOffset()` (positive west of UTC),
 * so a timer started at 23:30 IST lands on the day the person worked.
 */
export function summariseTaskTime(
    rows: TaskTimerRow[],
    timezoneOffsetMinutes = 0,
): TaskTimeDay[] {
    const byDate = new Map<string, Map<number, TaskTimeEntry>>();

    for (const row of rows) {
        const minutes = toMinutes(row.minutes);
        if (minutes === 0) continue;
        const date = localDate(row.started_at, timezoneOffsetMinutes);
        if (!date) continue;

        const day = byDate.get(date) ?? new Map<number, TaskTimeEntry>();
        const existing = day.get(row.task_id);
        if (existing) {
            existing.minutes += minutes;
        } else {
            day.set(row.task_id, {
                task_id: row.task_id,
                title: row.task_title || `Task #${row.task_id}`,
                issue_key: row.issue_key || null,
                date,
                minutes,
            });
        }
        byDate.set(date, day);
    }

    return [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
        .map(([date, entries]) => {
            const list = [...entries.values()].sort((a, b) => b.minutes - a.minutes);
            return {
                date,
                minutes: list.reduce((sum, entry) => sum + entry.minutes, 0),
                entries: list,
            };
        });
}
