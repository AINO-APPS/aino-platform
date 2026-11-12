/**
 * Task time in the timesheet, grouped by the recorded worklog day.
 */

export interface TaskWorklogRow {
    task_id: number;
    task_title?: string | null;
    ticket_key?: string | null;
    day_worked?: string;
    minutes?: number | null;
}

export interface TaskTimeEntry {
    task_id: number;
    title: string;
    ticket_key: string | null;
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

/** Group worklogs into per-day, per-ticket rows, newest day first. */
export function summariseTaskTime(
    rows: TaskWorklogRow[],
): TaskTimeDay[] {
    const byDate = new Map<string, Map<number, TaskTimeEntry>>();

    for (const row of rows) {
        const minutes = toMinutes(row.minutes);
        if (minutes === 0) continue;
        const date = row.day_worked ?? "";
        if (!date) continue;

        const day = byDate.get(date) ?? new Map<number, TaskTimeEntry>();
        const existing = day.get(row.task_id);
        if (existing) {
            existing.minutes += minutes;
        } else {
            day.set(row.task_id, {
                task_id: row.task_id,
                title: row.task_title || `Task #${row.task_id}`,
                ticket_key: row.ticket_key ?? null,
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
