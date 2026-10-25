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

/** Database port for the timer queries. */
export interface TimerDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

/** The timer currently running for this task and user, if any. */
export async function findRunningTimer(db: TimerDb, taskId: unknown, userId: number) {
    return (await db.query(
        `SELECT id, started_at FROM task_timers
          WHERE task_id = $1 AND user_id = $2 AND stopped_at IS NULL
          ORDER BY started_at DESC LIMIT 1`,
        [taskId, userId],
    )).rows[0] || null;
}

/**
 * Start a timer. The partial unique index makes this idempotent: starting an
 * already running timer keeps the original start rather than resetting it.
 */
export async function startTimer(db: TimerDb, taskId: unknown, userId: number, startedAt: string): Promise<void> {
    await db.query(
        `INSERT INTO task_timers (task_id, user_id, started_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (task_id, user_id) WHERE stopped_at IS NULL DO NOTHING`,
        [taskId, userId, startedAt],
    );
}

/** Close a timer and add its minutes to the task's logged total. */
export async function stopTimer(
    db: TimerDb,
    timerId: number,
    taskId: unknown,
    stoppedAt: string,
    minutes: number,
) {
    await db.query(
        "UPDATE task_timers SET stopped_at = $1, minutes = $2 WHERE id = $3",
        [stoppedAt, minutes, timerId],
    );
    return (await db.query(
        `UPDATE tasks SET logged_minutes = COALESCE(logged_minutes, 0) + $1
          WHERE id = $2
          RETURNING estimated_minutes, logged_minutes`,
        [minutes, taskId],
    )).rows[0];
}
