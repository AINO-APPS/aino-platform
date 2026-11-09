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
export async function acquirePlacementLifecycleLock(db: PlacementDb, orgId: number | null): Promise<void> {
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

export async function findTeamInOrg(db: PlacementDb, teamId: number, orgId: number | null): Promise<{ id: number } | null> {
    return (await db.query(
        "SELECT id FROM teams WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2",
        [teamId, orgId],
    )).rows[0] ?? null;
}

export async function ensureTeamProject(
    db: PlacementDb,
    teamId: number,
    orgId: number | null,
): Promise<{ id: number; key: string } | null> {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`aino:team-project:${orgId ?? "null"}`]);
    const existing = (await db.query(
        `SELECT id, key FROM projects WHERE org_id IS NOT DISTINCT FROM $1 AND origin_team_id = $2`,
        [orgId, teamId],
    )).rows[0];
    if (existing) return existing;

    const team = (await db.query(
        `SELECT tm.name, tm.lead_id,
                EXISTS (SELECT 1 FROM sprints s WHERE s.team_id = tm.id) AS has_sprints
           FROM teams tm
          WHERE tm.id = $1 AND tm.org_id IS NOT DISTINCT FROM $2`,
        [teamId, orgId],
    )).rows[0];
    if (!team) return null;

    let baseKey = String(team.name || "TEAM").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!baseKey) baseKey = "TEAM";
    if (!/^[A-Z]/.test(baseKey)) baseKey = `T${baseKey}`;
    if (baseKey.length === 1) baseKey += "T";
    baseKey = baseKey.slice(0, 10);
    let key = baseKey;
    for (let suffix = 1; ; suffix++) {
        const collision = (await db.query(
            `SELECT 1 FROM projects WHERE org_id IS NOT DISTINCT FROM $1 AND key = $2
             UNION ALL
             SELECT 1 FROM reserved_project_keys WHERE org_id IS NOT DISTINCT FROM $1 AND key = $2
             LIMIT 1`,
            [orgId, key],
        )).rows[0];
        if (!collision) break;
        key = `${baseKey.slice(0, 10 - String(suffix).length)}${suffix}`;
    }

    const project = (await db.query(
        `INSERT INTO projects (org_id, key, name, type, lead_user_id, origin_team_id, key_published)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE)
         RETURNING id, key`,
        [orgId, key, team.name, team.has_sprints ? "scrum" : "task_list", team.lead_id, teamId],
    )).rows[0];
    await db.query(
        `INSERT INTO reserved_project_keys (org_id, key, reason) VALUES ($1, $2, 'generated')
         ON CONFLICT (org_id, key) DO NOTHING`,
        [orgId, key],
    );
    await db.query(
        `INSERT INTO project_members (project_id, team_id, role)
         VALUES ($1, $2, 'member') ON CONFLICT (project_id, team_id) DO NOTHING`,
        [project.id, teamId],
    );
    if (team.lead_id) {
        await db.query(
            `INSERT INTO project_members (project_id, user_id, role)
             VALUES ($1, $2, 'project_admin')
             ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'project_admin'`,
            [project.id, team.lead_id],
        );
    }
    return project;
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

export async function setTeamAndProject(
    db: PlacementDb,
    id: number,
    teamId: number,
    projectId: number,
    taskNumber: number,
    ticketKey: string,
    alsoLeaveSprint: boolean,
): Promise<any> {
    return (await db.query(
        `UPDATE tasks SET team_id = $1, project_id = $2, task_number = $3, ticket_key = $4
          ${alsoLeaveSprint ? `, ${LEAVE_SPRINT}` : ""} WHERE id = $5 RETURNING *`,
        [teamId, projectId, taskNumber, ticketKey, id],
    )).rows[0];
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
    stateId: number, clearSprint: boolean, teamId?: number,
): Promise<any> {
    return (await db.query(
        `UPDATE tasks SET project_id = $1, task_number = $2, ticket_key = $3, workflow_state_id = $4,
          team_id = CASE WHEN $6::int IS NULL THEN team_id ELSE $6 END
          ${clearSprint ? `, ${LEAVE_SPRINT}` : ""} WHERE id = $5 RETURNING *`,
        [projectId, taskNumber, ticketKey, stateId, id, teamId ?? null],
    )).rows[0];
}

// Leaving a sprint clears legacy bookkeeping only; ticket dates are independent.
const LEAVE_SPRINT = `
    sprint_id = NULL,
    pre_sprint_due_date = NULL`;

/** Join a sprint without changing the ticket's own due date. */
export async function joinSprint(
    db: PlacementDb,
    id: number,
    sprint: { id: number },
    teamId: number | null,
): Promise<any> {
    return (await db.query(
        `UPDATE tasks SET sprint_id = $1, team_id = $2
          WHERE id = $3 RETURNING *`,
        [sprint.id, teamId, id],
    )).rows[0];
}

/** Leave any sprint; legacy planned-date metadata is kept. */
export async function leaveSprint(db: PlacementDb, id: number): Promise<any> {
    return (await db.query(`UPDATE tasks SET ${LEAVE_SPRINT} WHERE id = $1 RETURNING *`, [id])).rows[0];
}

/** Back to the backlog: out of any sprint and clear legacy planned-date metadata. */
export async function returnToBacklog(db: PlacementDb, id: number): Promise<any> {
    return (await db.query(
        `UPDATE tasks SET ${LEAVE_SPRINT}, planned_date = NULL WHERE id = $1 RETURNING *`,
        [id],
    )).rows[0];
}

export async function setPlannedDay(db: PlacementDb, id: number, day: string): Promise<any> {
    return (await db.query("UPDATE tasks SET planned_date = $1 WHERE id = $2 RETURNING *", [day, id])).rows[0];
}

/** Change the owner team, leaving the sprint too when `leaveSprint` is set. */
export async function setTeam(db: PlacementDb, id: number, teamId: number, alsoLeaveSprint: boolean): Promise<any> {
    return (await db.query(
        `UPDATE tasks SET team_id = $1${alsoLeaveSprint ? `, ${LEAVE_SPRINT}` : ""} WHERE id = $2 RETURNING *`,
        [teamId, id],
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
