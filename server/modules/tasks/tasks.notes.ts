/**
 * Task reads used by the Notes area (linked-entity panels, daily-note prefill
 * and the "link a task" picker).
 *
 * They live here rather than in `routes/notes.ts` so the route file stays under
 * its size ratchet and every task read goes through one place that knows the
 * workflow state is the only status (D4) and `planned_date` the only planner
 * day (D2).
 */

import {
    buildVisibilityPredicate,
    resolveTaskVisibility,
    type TaskActor,
} from "./tasks.policy";

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
    actor: TaskActor,
    query: string | undefined,
): Promise<any[]> {
    // The picker must use the same boundary as the Plan lists — it used to
    // return every task in the org, leaking other teams' titles.
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (actor.orgId != null) {
        conditions.push("t.org_id = $1");
        params.push(actor.orgId);
    } else {
        conditions.push("t.org_id IS NULL");
    }
    const visibility = buildVisibilityPredicate(resolveTaskVisibility(actor), params.length + 1);
    if (visibility.sql) {
        conditions.push(visibility.sql);
        params.push(...visibility.params);
    }
    const term = query && query.trim()
        ? `%${query.trim().replace(/[\\%_]/g, (character) => `\\${character}`)}%`
        : null;
    if (term) {
        params.push(term);
        conditions.push(`t.title ILIKE $${params.length}`);
    }
    return (await db.query(
        `${TASK_SELECT}
          WHERE ${conditions.join(" AND ")}
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
