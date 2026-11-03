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

export async function lockWorklogTicket(db: TasksDb, taskId: number, orgId: number | null) {
    return (await db.query('SELECT * FROM tasks WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2 FOR UPDATE', [taskId, orgId])).rows[0];
}

export async function workingHoursPerDay(db: TasksDb, orgId: number | null): Promise<number> {
    const row = (await db.query('SELECT work_hours_per_day FROM organizations WHERE id IS NOT DISTINCT FROM $1', [orgId])).rows[0];
    return Number(row?.work_hours_per_day ?? 8);
}

export async function insertWorklog(db: TasksDb, taskId: number, userId: number,
    input: { day_worked: string; start_time?: string | null; comment?: string | null }, minutes: number) {
    return (await db.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, start_time, minutes, comment)
        VALUES ($1, $2, $2, $3, $4, $5, $6) RETURNING id`,
        [taskId, userId, input.day_worked, input.start_time || null, minutes, input.comment ?? null])).rows[0].id as number;
}

export async function recordWorklogAddition(db: TasksDb, taskId: number, userId: number, orgId: number | null,
    worklog: Record<string, unknown>, ip?: string, userAgent?: string) {
    await db.query(`INSERT INTO task_history (task_id, user_id, action, field, new_value)
        VALUES ($1, $2, 'worklog_added', 'worklog', $3)`, [taskId, userId, JSON.stringify(worklog)]);
    await db.query(`INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
        VALUES ($1, $2, 'worklog_added', 'task', $3, $4, $5, $6)`,
        [orgId, userId, taskId, JSON.stringify(worklog), ip ?? null, userAgent ?? null]);
}

export async function lockWorklog(db: TasksDb, taskId: number, worklogId: number) {
    return (await db.query('SELECT * FROM task_worklogs WHERE task_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE',
        [taskId, worklogId])).rows[0];
}

export async function updateWorklog(db: TasksDb, worklogId: number, input: LogWorkFields, minutes: number) {
    await db.query(`UPDATE task_worklogs SET day_worked = $2, start_time = $3, minutes = $4, comment = $5, updated_at = NOW()
        WHERE id = $1`, [worklogId, input.day_worked, input.start_time || null, minutes, input.comment ?? null]);
}

export async function softDeleteWorklog(db: TasksDb, worklogId: number) {
    return (await db.query('UPDATE task_worklogs SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *', [worklogId])).rows[0];
}

type LogWorkFields = { day_worked: string; start_time?: string | null; comment?: string | null };

export async function recordWorklogChange(db: TasksDb, taskId: number, userId: number, orgId: number | null,
    action: 'worklog_updated' | 'worklog_deleted', before: Record<string, unknown>, after: Record<string, unknown>, ip?: string, userAgent?: string) {
    await db.query(`INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        VALUES ($1, $2, $3, 'worklog', $4, $5)`, [taskId, userId, action, JSON.stringify(before), JSON.stringify(after)]);
    await db.query(`INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
        VALUES ($1, $2, $3, 'task', $4, $5, $6, $7)`,
        [orgId, userId, action, taskId, JSON.stringify({ before, after }), ip ?? null, userAgent ?? null]);
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
