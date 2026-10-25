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
    return {
        estimated,
        logged,
        remaining: Math.max(0, estimated - logged),
        percent: estimated > 0 ? Math.round((logged / estimated) * 100) : 0,
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
