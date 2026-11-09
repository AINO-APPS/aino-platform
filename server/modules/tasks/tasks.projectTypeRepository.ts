import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";
import type { ProjectType } from "./tasks.projectTypes";

export async function projectSprintStatuses(db: ProjectAccessRepositoryDb, ids: number[]): Promise<Map<number, string[]>> {
    if (!ids.length) return new Map();
    const rows = (await db.query("SELECT project_id, status FROM sprints WHERE project_id = ANY($1::int[])", [ids])).rows;
    const result = new Map<number, string[]>();
    for (const row of rows) result.set(Number(row.project_id), [...(result.get(Number(row.project_id)) ?? []), row.status]);
    return result;
}

export async function lockTypedProject(db: ProjectAccessRepositoryDb, id: number, orgId: number) {
    return (await db.query("SELECT * FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE", [id, orgId])).rows[0];
}

export async function writeProjectType(db: ProjectAccessRepositoryDb, id: number, type: ProjectType) {
    return (await db.query("UPDATE projects SET type = $2, updated_at = NOW() WHERE id = $1 RETURNING *", [id, type])).rows[0];
}
