import type { LifecycleDb } from "./tasks.workflowRules";
import type { SprintLike } from "./tasks.sprintLifecycle";

export async function findDecisionSprints(db: LifecycleDb, ids: number[], orgId: number | null): Promise<SprintLike[]> {
    if (ids.length === 0) return [];
    return (await db.query(
        `SELECT s.id, s.team_id, s.project_id, s.status, t.org_id FROM sprints s
         JOIN projects t ON t.id = s.project_id
         WHERE s.id = ANY($1::int[]) AND t.org_id IS NOT DISTINCT FROM $2`, [ids, orgId],
    )).rows;
}

export async function findDecisionOwners(
    db: LifecycleDb, ids: number[], orgId: number | null,
): Promise<Array<{ id: number; team_id: number | null }>> {
    if (ids.length === 0) return [];
    return (await db.query(
        "SELECT id, team_id FROM users WHERE id = ANY($1::int[]) AND org_id IS NOT DISTINCT FROM $2",
        [ids, orgId],
    )).rows;
}
