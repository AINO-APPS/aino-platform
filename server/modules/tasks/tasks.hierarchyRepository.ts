import type { PlacementDb as TasksDb } from "./tasks.placementRepository";

export const PLANNING_PARENT_SQL = `NOT EXISTS (
    SELECT 1 FROM work_item_types hierarchy_type
    WHERE hierarchy_type.id = t.work_item_type_id AND hierarchy_type.is_subtask = TRUE
)`;

export async function findHierarchyTicket(db: TasksDb, id: number, orgId: number | null) {
    return (await db.query(
        `SELECT t.*, COALESCE(w.is_epic, FALSE) AS is_epic, COALESCE(w.is_subtask, FALSE) AS is_subtask
         FROM tasks t LEFT JOIN work_item_types w ON w.id = t.work_item_type_id
         WHERE t.id = $1 AND t.org_id IS NOT DISTINCT FROM $2`,
        [id, orgId],
    )).rows[0];
}

export async function findHierarchyType(db: TasksDb, id: unknown, orgId: number | null, activeOnly = true) {
    return (await db.query(
        `SELECT * FROM work_item_types WHERE org_id IS NOT DISTINCT FROM $2
         AND (id::text = $1 OR key = $1)${activeOnly ? " AND is_active = TRUE" : ""}`,
        [String(id), orgId],
    )).rows[0];
}

export async function findHierarchyChildren(db: TasksDb, id: number) {
    return (await db.query(
        `SELECT t.*, COALESCE(w.is_epic, FALSE) AS is_epic, COALESCE(w.is_subtask, FALSE) AS is_subtask
         FROM tasks t LEFT JOIN work_item_types w ON w.id = t.work_item_type_id
         WHERE t.parent_task_id = $1 ORDER BY t.id`,
        [id],
    )).rows;
}

export async function findHierarchySubtasks(db: TasksDb, parentIds: number[], orgId: number | null) {
    if (!parentIds.length) return [];
    return (await db.query(
        `SELECT t.* FROM tasks t JOIN work_item_types w ON w.id = t.work_item_type_id
         WHERE t.parent_task_id = ANY($1::int[]) AND t.org_id IS NOT DISTINCT FROM $2
         AND w.is_subtask = TRUE ORDER BY t.id`,
        [parentIds, orgId],
    )).rows;
}

export async function hierarchyTypeIsUsed(db: TasksDb, id: number): Promise<boolean> {
    return (await db.query("SELECT EXISTS (SELECT 1 FROM tasks WHERE work_item_type_id = $1) AS used", [id])).rows[0]?.used === true;
}

export async function writeHierarchyParent(db: TasksDb, id: number, parentId: number | null, oldParentId: number | null, userId: number) {
    await db.query("UPDATE tasks SET parent_task_id = $1 WHERE id = $2", [parentId, id]);
    await recordHierarchyHistory(db, id, userId, "parent", oldParentId, parentId);
}

export async function recordHierarchyHistory(db: TasksDb, id: number, userId: number, field: string, from: unknown, to: unknown) {
    if (String(from ?? "") === String(to ?? "")) return;
    await db.query(
        `INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
         VALUES ($1, $2, 'updated', $3, $4, $5)`,
        [id, userId, field, from == null ? null : String(from), to == null ? null : String(to)],
    );
}
