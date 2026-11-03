import type { TasksDb } from "./tasks.types";

export async function readTimeSpent(db: TasksDb, ids: number[], orgId: number | null): Promise<Record<number, number>> {
    if (!ids.length) return {};
    const { rows } = await db.query(`SELECT t.id, COALESCE(SUM(w.minutes), 0)::int AS minutes
        FROM tasks t LEFT JOIN task_worklogs w ON w.task_id = t.id AND w.deleted_at IS NULL
        WHERE t.id = ANY($1::int[]) AND t.org_id IS NOT DISTINCT FROM $2
        GROUP BY t.id`, [ids, orgId]);
    return Object.fromEntries(rows.map(row => [row.id, row.minutes]));
}

export async function listWorklogs(db: TasksDb, taskId: number, orgId: number | null) {
    return (await db.query(`SELECT w.*, u.username, u.full_name, u.avatar,
            logger.username AS logged_by_username, logger.full_name AS logged_by_name, logger.avatar AS logged_by_avatar
        FROM task_worklogs w JOIN tasks t ON t.id = w.task_id
        JOIN users u ON u.id = w.author_id JOIN users logger ON logger.id = w.logged_by_id
        WHERE w.task_id = $1 AND t.org_id IS NOT DISTINCT FROM $2 AND w.deleted_at IS NULL
        ORDER BY w.day_worked DESC, w.created_at DESC, w.id DESC`, [taskId, orgId])).rows;
}

export async function lockTicket(db: TasksDb, taskId: number, orgId: number | null) {
    return (await db.query("SELECT id, estimated_minutes FROM tasks WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2 FOR UPDATE", [taskId, orgId])).rows[0];
}

export async function lockRunningTimer(db: TasksDb, taskId: number, userId: number, orgId: number | null) {
    return (await db.query(`SELECT tt.id, tt.started_at FROM task_timers tt JOIN tasks t ON t.id = tt.task_id
        WHERE tt.task_id = $1 AND tt.user_id = $2 AND tt.stopped_at IS NULL
          AND t.org_id IS NOT DISTINCT FROM $3 ORDER BY tt.id FOR UPDATE OF tt`, [taskId, userId, orgId])).rows[0];
}

export async function recordTimerWorklog(db: TasksDb, timerId: number, taskId: number, userId: number,
    stoppedAt: string, minutes: number, dayWorked: string, startTime: string) {
    await db.query("UPDATE task_timers SET stopped_at = $1, minutes = $2 WHERE id = $3", [stoppedAt, minutes, timerId]);
    await db.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, start_time, minutes, source_timer_id)
        VALUES ($1, $2, $2, $3, $4, $5, $6)`, [taskId, userId, dayWorked, startTime, minutes, timerId]);
}

export async function recordLegacyHistory(db: TasksDb, taskId: number, userId: number, previous: number, total: number) {
    await db.query(`INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        VALUES ($1, $2, 'time_logged', 'logged_minutes', $3, $4)`, [taskId, userId, String(previous), String(total)]);
}

export async function findRunningTimer(db: TasksDb, taskId: unknown, userId: number, orgId: number | null) {
    return (await db.query(`SELECT tt.id, tt.started_at FROM task_timers tt JOIN tasks t ON t.id = tt.task_id
        WHERE tt.task_id = $1 AND tt.user_id = $2 AND tt.stopped_at IS NULL
          AND t.org_id IS NOT DISTINCT FROM $3
        ORDER BY tt.started_at DESC LIMIT 1`, [taskId, userId, orgId])).rows[0] || null;
}

export async function startTimer(db: TasksDb, taskId: unknown, userId: number, startedAt: string, orgId: number | null): Promise<void> {
    await db.query(`INSERT INTO task_timers (task_id, user_id, started_at)
        SELECT id, $2, $3::timestamptz FROM tasks WHERE id = $1 AND org_id IS NOT DISTINCT FROM $4
        ON CONFLICT (task_id, user_id) WHERE stopped_at IS NULL DO NOTHING`, [taskId, userId, startedAt, orgId]);
}
