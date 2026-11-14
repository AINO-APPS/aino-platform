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

export async function readWorklogEstimates(db: TasksDb, taskId: number, orgId: number | null) {
    return (await db.query('SELECT original_estimate_minutes, remaining_estimate_minutes FROM tasks WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2', [taskId, orgId])).rows[0];
}

export async function lockWorklogTicket(db: TasksDb, taskId: number, orgId: number | null, lock = true) {
    return (await db.query(`SELECT * FROM tasks WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2${lock ? " FOR UPDATE" : ""}`, [taskId, orgId])).rows[0];
}

export async function worklogAuthorExists(db: TasksDb, authorId: number, orgId: number | null): Promise<boolean> {
    return (await db.query('SELECT id FROM users WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2 FOR SHARE',
        [authorId, orgId])).rows.length > 0;
}

export async function workingHoursPerDay(db: TasksDb, orgId: number | null): Promise<number> {
    const row = (await db.query('SELECT work_hours_per_day FROM organizations WHERE id IS NOT DISTINCT FROM $1', [orgId])).rows[0];
    return Number(row?.work_hours_per_day ?? 8);
}

export async function insertWorklog(db: TasksDb, taskId: number, authorId: number, loggedById: number,
    input: { day_worked: string; start_time?: string | null; comment?: string | null }, minutes: number, orgId: number | null) {
    return (await db.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, start_time, minutes, comment)
        SELECT id, $2, $3, $4::date, $5::time, $6, $7 FROM tasks WHERE id = $1 AND org_id IS NOT DISTINCT FROM $8 RETURNING id`,
        [taskId, authorId, loggedById, input.day_worked, input.start_time || null, minutes, input.comment ?? null, orgId])).rows[0].id as number;
}

export async function recordWorklogAddition(db: TasksDb, taskId: number, userId: number, orgId: number | null,
    worklog: Record<string, unknown>, ip?: string, userAgent?: string) {
    await db.query(`INSERT INTO task_history (task_id, user_id, action, field, new_value)
        VALUES ($1, $2, 'worklog_added', 'worklog', $3)`, [taskId, userId, JSON.stringify(worklog)]);
    await db.query(`INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
        VALUES ($1, $2, 'worklog_added', 'task', $3, $4, $5, $6)`,
        [orgId, userId, taskId, JSON.stringify(worklog), ip ?? null, userAgent ?? null]);
}

export async function lockWorklog(db: TasksDb, taskId: number, worklogId: number, orgId: number | null) {
    return (await db.query(`SELECT w.* FROM task_worklogs w JOIN tasks t ON t.id = w.task_id
        WHERE w.task_id = $1 AND w.id = $2 AND w.deleted_at IS NULL AND t.org_id IS NOT DISTINCT FROM $3
        FOR UPDATE OF w`, [taskId, worklogId, orgId])).rows[0];
}

export async function updateWorklog(db: TasksDb, worklogId: number, input: LogWorkFields, minutes: number, taskId: number, orgId: number | null) {
    await db.query(`UPDATE task_worklogs w SET day_worked = $2, start_time = $3, minutes = $4, comment = $5,
        author_id = COALESCE($6, w.author_id), updated_at = NOW() FROM tasks t
        WHERE w.id = $1 AND w.task_id = $7 AND t.id = w.task_id AND t.org_id IS NOT DISTINCT FROM $8 AND w.deleted_at IS NULL`,
        [worklogId, input.day_worked, input.start_time || null, minutes, input.comment ?? null, input.author_id ?? null, taskId, orgId]);
}

export async function softDeleteWorklog(db: TasksDb, worklogId: number, taskId: number, orgId: number | null) {
    return (await db.query(`UPDATE task_worklogs w SET deleted_at = NOW(), updated_at = NOW() FROM tasks t
        WHERE w.id = $1 AND w.task_id = $2 AND t.id = w.task_id AND t.org_id IS NOT DISTINCT FROM $3 AND w.deleted_at IS NULL
        RETURNING w.*`, [worklogId, taskId, orgId])).rows[0];
}

type LogWorkFields = { day_worked: string; start_time?: string | null; comment?: string | null; author_id?: number };

export async function recordWorklogChange(db: TasksDb, taskId: number, userId: number, orgId: number | null,
    action: 'worklog_updated' | 'worklog_deleted', before: Record<string, unknown>, after: Record<string, unknown>, ip?: string, userAgent?: string) {
    await db.query(`INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        VALUES ($1, $2, $3, 'worklog', $4, $5)`, [taskId, userId, action, JSON.stringify(before), JSON.stringify(after)]);
    await db.query(`INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
        VALUES ($1, $2, $3, 'task', $4, $5, $6, $7)`,
        [orgId, userId, action, taskId, JSON.stringify({ before, after }), ip ?? null, userAgent ?? null]);
}

