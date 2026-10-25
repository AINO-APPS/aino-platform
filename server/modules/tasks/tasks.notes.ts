/**
 * Task reads used by the Notes area (linked-entity panels, daily-note prefill
 * and the "link a task" picker).
 *
 * They live here rather than in `routes/notes.ts` so the route file stays under
 * its size ratchet and every task read goes through one place that knows the
 * workflow state is the only status (D4) and `planned_date` the only planner
 * day (D2).
 */

export interface NotesTaskDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

/** The task columns the Notes UI renders, with the workflow-state key as `status`. */
const TASK_SELECT = `SELECT t.id, t.title, ws.key AS status, t.priority, t.planned_date AS date
                       FROM tasks t
                       LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id`;

/**
 * Tasks the user owns, is assigned to, or that belong to their org, optionally
 * narrowed by a title search. Newest first, capped at 20.
 */
export async function searchTasksForLinking(
    db: NotesTaskDb,
    userId: number,
    orgId: number | null,
    query: string | undefined,
): Promise<any[]> {
    const params: unknown[] = [userId];
    const scope = `(t.user_id = $1 OR t.assigned_to = $1${orgId ? " OR t.org_id = $2" : ""})`;
    if (orgId) params.push(orgId);
    const term = query && query.trim()
        ? `%${query.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
        : null;
    if (term) params.push(term);
    return (await db.query(
        `${TASK_SELECT}
          WHERE ${scope}${term ? ` AND t.title ILIKE $${params.length}` : ""}
          ORDER BY t.created_at DESC LIMIT 20`,
        params,
    )).rows;
}

/** One task's summary for a linked-entity panel. */
export async function findLinkedTask(db: NotesTaskDb, taskId: unknown): Promise<any | null> {
    return (await db.query(
        `SELECT t.id, t.title, ws.key AS status, t.priority, t.planned_date AS date,
                t.due_date, t.sprint_id
           FROM tasks t
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.id = $1`,
        [taskId],
    )).rows[0] || null;
}
