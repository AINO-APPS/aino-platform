/**
 * Task reads used by the Notes area (linked-entity panels, daily-note prefill
 * and the "link a task" picker).
 *
 * They live here rather than in `routes/notes.ts` so the route file stays under
 * its size ratchet and every task read goes through one place that knows the
 * workflow state is the only status (D4) and start date drives date reads.
 */

import {
    buildVisibilityPredicate,
    resolveTaskVisibilityForRequest,
    type TaskActor,
} from "./tasks.policy";

export interface NotesTaskDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

/** The task columns the Notes UI renders, with the workflow-state key as `status`. */
const TASK_SELECT = `SELECT t.*, ws.key AS status
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
    const visibility = buildVisibilityPredicate(await resolveTaskVisibilityForRequest(actor), params.length + 1);
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

/**
 * Insert a ticket from a note checklist item, with no container: the caller
 * places it in a sprint in the same transaction. Starts in the
 * org's initial workflow state.
 */
export async function insertNoteTicket(
    db: NotesTaskDb,
    input: { userId: number; orgId: number | null; title: string },
): Promise<number> {
    return (await db.query(
        `INSERT INTO tasks (user_id, org_id, project_id, title, workflow_state_id, priority)
         SELECT $1, $2, p.id, $3, ws.id, 'medium'
           FROM projects p
           LEFT JOIN workflow_states ws ON ws.project_id = p.id AND ws.is_active = TRUE AND ws.is_initial = TRUE
          WHERE p.org_id IS NOT DISTINCT FROM $2 AND p.is_general
          ORDER BY p.id, ws.sort_order, ws.id LIMIT 1
         RETURNING id`,
        [input.userId, input.orgId, input.title],
    )).rows[0].id;
}

/** One task's summary for a linked-entity panel, scoped to the actor's org. */
export async function findLinkedTask(db: NotesTaskDb, taskId: unknown, orgId: number | null): Promise<any | null> {
    return (await db.query(
        `SELECT t.*, ws.key AS status
           FROM tasks t
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.id = $1 AND t.org_id IS NOT DISTINCT FROM $2`,
        [taskId, orgId],
    )).rows[0] || null;
}
