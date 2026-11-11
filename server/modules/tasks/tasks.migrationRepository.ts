import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";

export async function readMigrationReview(db: ProjectAccessRepositoryDb, orgId: number) {
    const org = (await db.query(
        `SELECT project_ownership, project_ownership_switched_at AS switched_at
         FROM organizations WHERE id = $1`, [orgId],
    )).rows[0];
    if (!org) return null;
    const projects = (await db.query(
        `SELECT p.id, p.name, p.key, p.key_published, p.type, p.origin_team_id, p.is_general,
                (SELECT COUNT(*)::int FROM tasks t WHERE t.project_id = p.id AND t.org_id = $1) AS ticket_count,
                COALESCE((SELECT json_agg(json_build_object(
                    'user_id', m.user_id, 'team_id', m.team_id, 'role', m.role,
                    'name', COALESCE(u.full_name, tm.name)) ORDER BY m.id)
                    FROM project_members m
                    LEFT JOIN users u ON u.id = m.user_id
                    LEFT JOIN teams tm ON tm.id = m.team_id
                    WHERE m.project_id = p.id), '[]'::json) AS grants
         FROM projects p WHERE p.org_id = $1 AND (p.origin_team_id IS NOT NULL OR p.is_general)
         ORDER BY p.id`, [orgId],
    )).rows;
    const moves = (await db.query(
        `SELECT m.task_id, m.old_key, t.ticket_key AS new_key, m.new_key AS migration_key,
                m.sprint_id, s.name AS sprint_name, m.from_project_id, m.to_project_id, m.moved_at
         FROM project_migration_moves m JOIN tasks t ON t.id = m.task_id
         LEFT JOIN sprints s ON s.id = m.sprint_id
         WHERE t.org_id = $1 ORDER BY m.task_id`, [orgId],
    )).rows;
    const hierarchy_repairs = (await db.query(
        `SELECT r.task_id, t.ticket_key, r.stage, r.reason, r.repaired_at,
            json_build_object('parent_task_id', r.before_value->'parent_task_id',
                'work_item_type_id', r.before_value->'work_item_type_id', 'project_id', r.before_value->'project_id',
                'sprint_id', r.before_value->'sprint_id', 'story_points', r.before_value->'story_points') AS before,
            json_build_object('parent_task_id', r.after_value->'parent_task_id',
                'work_item_type_id', r.after_value->'work_item_type_id', 'project_id', r.after_value->'project_id',
                'sprint_id', r.after_value->'sprint_id', 'story_points', r.after_value->'story_points') AS after
         FROM (
            SELECT *, 'original' AS stage FROM task_hierarchy_repairs WHERE org_id = $1
            UNION ALL
            SELECT *, 'correction' AS stage FROM task_hierarchy_repair_corrections WHERE org_id = $1
         ) r LEFT JOIN tasks t ON t.id = r.task_id AND t.org_id = $1
         ORDER BY r.repaired_at, CASE r.stage WHEN 'original' THEN 0 ELSE 1 END, r.task_id`, [orgId],
    )).rows;
    return { ...org, projects, moves, hierarchy_repairs };
}

export async function beginReviewSnapshot(db: ProjectAccessRepositoryDb) {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
}

export async function lockMigrationOrganization(db: ProjectAccessRepositoryDb, orgId: number) {
    return (await db.query(
        `SELECT project_ownership, project_ownership_switched_at FROM organizations
         WHERE id = $1 FOR UPDATE`, [orgId],
    )).rows[0];
}

export async function persistOwnershipSwitch(
    db: ProjectAccessRepositoryDb, orgId: number, actorId: number, enabled: boolean,
) {
    if (enabled) {
        await db.query("UPDATE projects SET key_published = TRUE WHERE org_id = $1", [orgId]);
    }
    const org = (await db.query(
        `UPDATE organizations SET project_ownership = $2,
            project_ownership_switched_at = CASE WHEN $2 THEN NOW() ELSE project_ownership_switched_at END
         WHERE id = $1 RETURNING project_ownership, project_ownership_switched_at AS switched_at`,
        [orgId, enabled],
    )).rows[0];
    await db.query(
        `INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, $3, 'organization', $1, $4)`,
        [orgId, actorId, enabled ? "project_ownership_enabled" : "project_ownership_disabled",
            JSON.stringify({ project_ownership: enabled, keys_published: true })],
    );
    return org;
}
