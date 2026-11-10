export interface ServiceDeskTaskDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

export async function findServiceDeskProject(db: ServiceDeskTaskDb, orgId: number | null) {
    return (await db.query(
        `SELECT p.id, s.id AS workflow_state_id
           FROM organizations o
           JOIN projects p ON p.org_id = o.id AND p.is_archived = FALSE
             AND p.id = COALESCE(
               (SELECT id FROM projects WHERE id = o.service_desk_project_id AND org_id = o.id AND is_archived = FALSE),
               (SELECT id FROM projects WHERE org_id = o.id AND is_general AND is_archived = FALSE ORDER BY id LIMIT 1))
           JOIN workflow_states s ON s.project_id = p.id AND s.org_id = o.id
             AND s.is_initial AND s.is_active
          WHERE o.id = $1 ORDER BY s.sort_order, s.id LIMIT 1`,
        [orgId],
    )).rows[0];
}

export async function syncServiceDeskStatus(db: ServiceDeskTaskDb, ticketId: number, status: string) {
    const category = status === "in_progress" ? "in_progress"
        : status === "resolved" || status === "closed" ? "done" : "initial";
    await db.query(
        `WITH locked AS MATERIALIZED (
            SELECT t.id, t.org_id, t.project_id, w.key AS old_key
              FROM tasks t JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
              JOIN workflow_states w ON w.id = t.workflow_state_id
               AND w.org_id = p.org_id AND w.project_id = p.id
             WHERE t.service_desk_ticket_id = $1 ORDER BY t.id FOR UPDATE OF t
         ), targets AS (
            SELECT l.*, s.id AS state_id, s.key AS new_key
              FROM locked l JOIN LATERAL (
                SELECT id, key FROM workflow_states
                 WHERE org_id = l.org_id AND project_id = l.project_id AND is_active
                   AND key != 'cancelled'
                   AND (($2 = 'initial' AND is_initial) OR category = $2)
                 ORDER BY sort_order, id LIMIT 1
              ) s ON TRUE WHERE l.old_key != 'cancelled'
         ), changed AS (
            UPDATE tasks t SET workflow_state_id = s.state_id
              FROM targets s WHERE t.id = s.id
              RETURNING t.id, s.old_key, s.new_key
         )
         INSERT INTO task_history (task_id, user_id, actor_type, action, field, old_value, new_value)
         SELECT id, NULL, 'system', 'service_desk_sync', 'workflow_state', old_key, new_key FROM changed`,
        [ticketId, category],
    );
}

export async function cancelServiceDeskCopy(db: ServiceDeskTaskDb, ticketId: number) {
    await db.query(
        `WITH locked AS MATERIALIZED (
            SELECT t.id, t.org_id, t.project_id, t.workflow_state_id, w.key, w.category
              FROM tasks t JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
              JOIN workflow_states w ON w.id = t.workflow_state_id
               AND w.org_id = p.org_id AND w.project_id = p.id
             WHERE t.service_desk_ticket_id = $1 ORDER BY t.id FOR UPDATE OF t
         ), changed AS (
            UPDATE tasks t SET workflow_state_id =
                CASE WHEN l.category = 'done' THEN l.workflow_state_id ELSE cancelled.id END
              FROM locked l LEFT JOIN workflow_states cancelled
                ON cancelled.org_id = l.org_id AND cancelled.project_id = l.project_id
               AND cancelled.key = 'cancelled' AND cancelled.is_active
             WHERE t.id = l.id
             RETURNING t.id, l.key
         )
         INSERT INTO task_history (task_id, user_id, actor_type, action, field, old_value, new_value)
         SELECT id, NULL, 'system', 'service_desk_deleted', 'service_desk_ticket', key,
                'Service Desk ticket #' || $1::text || ' deleted; platform copy retained'
           FROM changed`,
        [ticketId],
    );
}
