import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";

export async function lockProjectKey(db: ProjectAccessRepositoryDb, projectId: number, orgId: number) {
    return (await db.query(
        "SELECT id, key, key_published, is_archived FROM projects WHERE id = $1 AND org_id = $2 FOR UPDATE",
        [projectId, orgId],
    )).rows[0];
}

export async function projectKeyInUse(db: ProjectAccessRepositoryDb, orgId: number, key: string): Promise<boolean> {
    return (await db.query(
        `SELECT 1 FROM projects WHERE org_id = $1 AND key = $2
         UNION ALL SELECT 1 FROM reserved_project_keys WHERE org_id = $1 AND key = $2 LIMIT 1`,
        [orgId, key],
    )).rows.length > 0;
}

export async function countProjectTickets(db: ProjectAccessRepositoryDb, projectId: number): Promise<number> {
    return Number((await db.query(
        "SELECT COUNT(*)::int AS count FROM tasks WHERE project_id = $1", [projectId],
    )).rows[0].count);
}

export async function rewriteProjectKey(
    db: ProjectAccessRepositoryDb,
    input: { projectId: number; orgId: number; actorId: number; oldKey: string; newKey: string; published: boolean },
) {
    const { projectId, orgId, actorId, oldKey, newKey, published } = input;
    // The unique reservation serializes competing renames and project creation.
    await db.query("INSERT INTO reserved_project_keys (org_id, key, reason) VALUES ($1, $2, 'rename')", [orgId, newKey]);
    await db.query(
        "INSERT INTO reserved_project_keys (org_id, key, reason) VALUES ($1, $2, 'rename') ON CONFLICT DO NOTHING",
        [orgId, oldKey],
    );
    await db.query("UPDATE projects SET key = $1, updated_at = NOW() WHERE id = $2", [newKey, projectId]);
    if (published) {
        await db.query(
            `INSERT INTO ticket_key_aliases (org_id, key, task_id, project_id, reason)
             SELECT org_id, ticket_key, id, project_id, 'rename' FROM tasks WHERE project_id = $1`,
            [projectId],
        );
    }
    const rewritten = await db.query(
        "UPDATE tasks SET ticket_key = $1 || '-' || task_number WHERE project_id = $2",
        [newKey, projectId],
    );
    await db.query(
        `INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'rename_key', 'project', $3, $4)`,
        [orgId, actorId, projectId, JSON.stringify({ old_key: oldKey, new_key: newKey })],
    );
    return Number(rewritten.rowCount);
}
