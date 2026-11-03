import type { TasksDb } from './tasks.types';

export async function readAuthorDayMinutes(db: TasksDb, authorId: number, orgId: number | null, day: string): Promise<number> {
    const { rows } = await db.query(`SELECT COALESCE(SUM(w.minutes), 0) AS minutes
        FROM task_worklogs w JOIN tasks t ON t.id = w.task_id
        WHERE w.author_id = $1 AND t.org_id IS NOT DISTINCT FROM $2
          AND w.day_worked = $3::date AND w.deleted_at IS NULL`, [authorId, orgId, day]);
    return Number(rows[0].minutes);
}
