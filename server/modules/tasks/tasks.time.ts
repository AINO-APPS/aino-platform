/**
 * Task time tracking.
 *
 * `logged` sits against `estimated` on the task, and the existing timer can be
 * started from a task so the time is attributed to it and rolls into the
 * timesheet.
 */

export interface TaskTime {
    estimated_minutes?: number | null;
    logged_minutes?: number | null;
}

export interface TimeSummary {
    estimated: number;
    logged: number;
    remaining: number;
    percent: number;
    over: boolean;
}

function minutes(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/** Logged against estimated, with the overrun made explicit. */
export function summariseTime(task: TaskTime): TimeSummary {
    const estimated = minutes(task.estimated_minutes);
    const logged = minutes(task.logged_minutes);
    const remaining = Math.max(0, estimated - logged);
    const percent = estimated > 0 ? Math.round((logged / estimated) * 100) : 0;

    return {
        estimated,
        logged,
        remaining,
        percent,
        over: estimated > 0 && logged > estimated,
    };
}

/** `90` → `1h 30m`, `45` → `45m`, `0` → `0m`. */
export function formatMinutes(value: unknown): string {
    const total = minutes(value);
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    if (hours === 0) return `${rest}m`;
    if (rest === 0) return `${hours}h`;
    return `${hours}h ${rest}m`;
}

/** The minutes to add when a timer stops. */
export function elapsedMinutes(startedAt: string | Date, stoppedAt: string | Date = new Date()): number {
    const start = new Date(startedAt).getTime();
    const stop = new Date(stoppedAt).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= start) return 0;
    return Math.max(1, Math.round((stop - start) / 60_000));
}
