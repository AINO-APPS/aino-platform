import type { LifecycleDb } from "./tasks.workflowRules";
import type { SprintLike } from "./tasks.sprintLifecycle";

export async function findDecisionHierarchy(db: LifecycleDb, ids: number[], orgId: number | null): Promise<Array<{ id: number; is_subtask: boolean; is_epic: boolean }>> {
    if (!ids.length) return [];
    return (await db.query(
        `SELECT t.id, w.is_subtask, w.is_epic FROM tasks t JOIN work_item_types w ON w.id = t.work_item_type_id
         WHERE t.id = ANY($1::int[]) AND t.org_id IS NOT DISTINCT FROM $2`,
        [ids, orgId],
    )).rows;
}
export async function findDecisionSubtasks(db: LifecycleDb, ids: number[], orgId: number | null) {
    return (await findDecisionHierarchy(db, ids, orgId)).filter((row) => row.is_subtask);
}

export async function findDecisionProjects(db: LifecycleDb, ids: number[], orgId: number | null) {
    if (!ids.length) return [];
    return (await db.query("SELECT id, is_archived, type, kanban_backlog_enabled FROM projects WHERE id = ANY($1::int[]) AND org_id = $2",
        [ids, orgId])).rows;
}

export async function findDecisionSprints(db: LifecycleDb, ids: number[], orgId: number | null): Promise<SprintLike[]> {
    if (ids.length === 0) return [];
    return (await db.query(
        `SELECT s.id, s.project_id, s.status, p.org_id FROM sprints s
         JOIN projects p ON p.id = s.project_id
         WHERE s.id = ANY($1::int[]) AND p.org_id IS NOT DISTINCT FROM $2`, [ids, orgId],
    )).rows;
}
