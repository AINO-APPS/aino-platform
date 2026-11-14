/**
 * SQL for ticket placement (`tasks.placement.ts`). The placement module owns
 * the rules; this file owns the statements.
 *
 * Every function runs on the caller's transaction client. Row locks are taken
 * in id order so two overlapping bulk moves cannot deadlock.
 */

export interface PlacementDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
}

/**
 * Serialize placement and sprint lifecycle work within an organization before
 * either path takes task or sprint row locks.
 */
export async function acquirePlacementLifecycleLock(
    db: { query(sql: string, params?: unknown[]): Promise<unknown> }, orgId: number | null,
): Promise<void> {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `aino:ticket-placement:${orgId == null ? "null" : String(orgId)}`,
    ]);
}

/** Lock and read tickets of one org. Missing or foreign ids are simply absent. */
export async function lockTickets(db: PlacementDb, ids: number[], orgId: number | null): Promise<any[]> {
    return (await db.query(
        `SELECT * FROM tasks
          WHERE id = ANY($1::int[]) AND org_id IS NOT DISTINCT FROM $2
          ORDER BY id
            FOR UPDATE`,
        [ids, orgId],
    )).rows;
}

/**
 * Read one org's sprints with a share lock, so sprint completion cannot flip a
 * sprint to completed between the freeze check and the ticket write.
 */
export async function lockSprints(db: PlacementDb, ids: number[], orgId: number | null, lock = true): Promise<any[]> {
    if (ids.length === 0) return [];
    return (await db.query(
        `SELECT s.* FROM sprints s JOIN projects t ON t.id = s.project_id
          WHERE s.id = ANY($1::int[]) AND t.org_id IS NOT DISTINCT FROM $2
          ORDER BY s.id
            ${lock ? "FOR SHARE OF s" : ""}`,
        [ids, orgId],
    )).rows;
}

export async function reserveProjectTicketNumber(db: PlacementDb, projectId: number): Promise<number> {
    const row = (await db.query(
        `UPDATE projects
            SET next_task_number = GREATEST(
                    next_task_number,
                    COALESCE((SELECT MAX(task_number) + 1 FROM tasks WHERE project_id = $1), 1)
                ) + 1,
                updated_at = NOW()
          WHERE id = $1
          RETURNING next_task_number - 1 AS task_number`,
        [projectId],
    )).rows[0];
    if (!row) throw new Error(`Project ${projectId} was not found`);
    return Number(row.task_number);
}

export async function insertTicketKeyAlias(
    db: PlacementDb,
    orgId: number,
    key: string,
    taskId: number,
    projectId: number | null,
    reason: "move" | "rename" | "migration",
): Promise<void> {
    await db.query(
        `INSERT INTO ticket_key_aliases (org_id, key, task_id, project_id, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (org_id, key) DO NOTHING`,
        [orgId, key, taskId, projectId, reason],
    );
}

export async function findMoveProjects(db: PlacementDb, ids: number[], orgId: number | null, lock = false): Promise<any[]> {
    return (await db.query(
        `SELECT id, key, is_archived FROM projects
          WHERE id = ANY($1::int[]) AND org_id IS NOT DISTINCT FROM $2
          ORDER BY id ${lock ? "FOR SHARE" : ""}`,
        [ids, orgId],
    )).rows;
}

export async function findMoveTicket(db: PlacementDb, id: number, orgId: number | null): Promise<any> {
    return (await db.query("SELECT * FROM tasks WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2", [id, orgId])).rows[0];
}

export async function findMoveActorTeams(db: PlacementDb, userId: number, orgId: number | null): Promise<number[]> {
    return (await db.query(
        `SELECT team_id FROM users WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2 AND team_id IS NOT NULL
         UNION
         SELECT m.team_id FROM user_team_memberships m JOIN teams t ON t.id = m.team_id
          WHERE m.user_id = $1 AND t.org_id IS NOT DISTINCT FROM $2`,
        [userId, orgId],
    )).rows.map((row) => Number(row.team_id));
}

export async function findMoveStates(db: PlacementDb, sourceStateId: number | null, projectId: number, orgId: number | null) {
    const source = (await db.query(
        "SELECT * FROM workflow_states WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2", [sourceStateId, orgId],
    )).rows[0];
    const states = (await db.query(
        `SELECT * FROM workflow_states WHERE project_id = $1 AND org_id IS NOT DISTINCT FROM $2
          AND is_active = TRUE ORDER BY sort_order, id`, [projectId, orgId],
    )).rows;
    return { source, states };
}

export async function setProject(
    db: PlacementDb, id: number, projectId: number, taskNumber: number, ticketKey: string,
    stateId: number, clearSprint: boolean, orgId: number | null,
): Promise<any> {
    return (await db.query(
        `UPDATE tasks SET project_id = $1, task_number = $2, ticket_key = $3, workflow_state_id = $4,
          ${clearSprint ? `sprint_id = NULL` : "sprint_id = sprint_id"}
          WHERE id = $5 AND org_id IS NOT DISTINCT FROM $6 RETURNING *`,
        [projectId, taskNumber, ticketKey, stateId, id, orgId],
    )).rows[0];
}

/** Join a sprint without changing the ticket's own due date. */
export async function joinSprint(
    db: PlacementDb,
    id: number,
    sprint: { id: number },
    orgId: number | null,
): Promise<any> {
    return (await db.query(
        `UPDATE tasks SET sprint_id = $1 WHERE id = $2 AND org_id IS NOT DISTINCT FROM $3 RETURNING *`,
        [sprint.id, id, orgId],
    )).rows[0];
}

/** Leave any sprint without changing ticket dates. */
export async function leaveSprint(db: PlacementDb, id: number, orgId: number | null): Promise<any> {
    return (await db.query(
        "UPDATE tasks SET sprint_id = NULL WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2 RETURNING *",
        [id, orgId],
    )).rows[0];
}

export interface HistoryRow {
    action: string;
    field: string;
    from: string | null;
    to: string | null;
}

export async function insertHistory(db: PlacementDb, taskId: number, userId: number, rows: HistoryRow[]): Promise<void> {
    for (const row of rows) {
        await db.query(
            "INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value) VALUES ($1, $2, $3, $4, $5, $6)",
            [taskId, userId, row.action, row.field, row.from, row.to],
        );
    }
}

export interface AuditRow {
    orgId: number | null;
    actorId: number;
    action: string;
    taskId: number;
    details: Record<string, unknown>;
    ip: string | null;
    userAgent: string | null;
}

/** Same row shape as `utils/audit.ts` `logAction`, but inside the caller's transaction. */
export async function insertAudit(db: PlacementDb, row: AuditRow): Promise<void> {
    await db.query(
        `INSERT INTO audit_logs (org_id, actor_id, action, entity_type, entity_id, details, ip_address, user_agent)
         VALUES ($1, $2, $3, 'task', $4, $5, $6, $7)`,
        [row.orgId, row.actorId, row.action, row.taskId, JSON.stringify(row.details), row.ip, row.userAgent],
    );
}
