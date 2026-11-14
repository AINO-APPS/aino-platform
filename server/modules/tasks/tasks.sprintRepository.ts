/**
 * SQL ownership for the sprint lifecycle surfaces: baselines, completion
 * preview, burndown snapshots and the notification audience.
 *
 * Routes and helpers call these instead of holding SQL, so the sprint queries
 * live next to the rules they serve.
 */
import { SPRINT_POINT_TICKET_SQL } from "./tasks.points";

export interface SprintDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

/** One sprint, scoped to the requester's org. */
export async function findSprintInOrg(db: SprintDb, sprintId: unknown, orgId: number | null) {
    return (await db.query(
        "SELECT s.* FROM sprints s JOIN projects t ON t.id = s.project_id WHERE s.id = $1 AND t.org_id IS NOT DISTINCT FROM $2",
        [sprintId, orgId],
    )).rows[0] || null;
}

export async function findSprintStatusInOrg(db: SprintDb, sprintId: unknown, orgId: number | null) {
    return (await db.query(
        `SELECT s.status
           FROM sprints s
           JOIN projects tm ON tm.id = s.project_id
          WHERE s.id = $1 AND tm.org_id IS NOT DISTINCT FROM $2`,
        [sprintId, orgId],
    )).rows[0] ?? null;
}

/** Every sprint whose project the actor can access. */
export async function findSprintsForProjects(db: SprintDb, orgId: unknown, projectIds: number[]) {
    if (projectIds.length === 0) return [];
    return (await db.query(
        `SELECT s.* FROM sprints s
          JOIN projects p ON p.id = s.project_id
         WHERE p.org_id IS NOT DISTINCT FROM $1 AND p.id = ANY($2::int[])
         ORDER BY
             CASE s.status WHEN 'active' THEN 1 WHEN 'planned' THEN 2 WHEN 'completed' THEN 3 END,
             s.start_date DESC`,
        [orgId, projectIds],
    )).rows;
}

/** One sprint joined with its project's org, for access checks. */
export async function findSprintWithProject(db: SprintDb, sprintId: unknown) {
    return (await db.query(
        `SELECT s.*, p.org_id
           FROM sprints s JOIN projects p ON p.id = s.project_id
          WHERE s.id = $1`,
        [sprintId],
    )).rows[0] || null;
}

/** Organization-wide occupancy used by the workflow write guard for board columns. */
export async function findSprintBoardCounts(db: SprintDb, orgId: number | null) {
    return (await db.query(
        `SELECT t.workflow_state_id AS state_id, COUNT(*)::int AS count
           FROM tasks t
           JOIN workflow_states ws
             ON ws.id = t.workflow_state_id
            AND ws.org_id IS NOT DISTINCT FROM t.org_id
          WHERE t.org_id IS NOT DISTINCT FROM $1
            AND ws.is_active = TRUE
            AND ws.key <> 'cancelled'
          GROUP BY t.workflow_state_id`,
        [orgId],
    )).rows;
}

/** One task row by id. */
export async function findTask(db: SprintDb, taskId: unknown) {
    return (await db.query("SELECT * FROM tasks WHERE id = $1", [taskId])).rows[0] || null;
}

/** The latest recorded baseline for a sprint. */
export async function findLatestBaseline(db: SprintDb, sprintId: unknown) {
    return (await db.query(
        `SELECT committed_points, committed_task_ids, reason, captured_at
           FROM sprint_baselines
          WHERE sprint_id = $1
          ORDER BY captured_at DESC, id DESC
          LIMIT 1`,
        [sprintId],
    )).rows[0] ?? null;
}

export async function insertBaseline(
    db: SprintDb,
    sprintId: unknown,
    committedPoints: number,
    committedTaskIds: unknown[],
    reason: string,
): Promise<void> {
    await db.query(
        `INSERT INTO sprint_baselines (sprint_id, committed_points, committed_task_ids, reason)
         VALUES ($1, $2, $3::jsonb, $4)`,
        [sprintId, committedPoints, JSON.stringify(committedTaskIds), reason],
    );
}

/** The id and points of every task in a sprint, for scope deltas. */
export async function findSprintTaskPoints(db: SprintDb, sprintId: unknown) {
    return (await db.query(
        `SELECT t.id, t.story_points FROM tasks t WHERE t.sprint_id = $1 AND ${SPRINT_POINT_TICKET_SQL}`,
        [sprintId],
    )).rows;
}

export async function findSprintReportTasks(db: SprintDb, sprintId: number) {
    return (await db.query(
        `SELECT t.id, t.title, t.workflow_state_id, t.work_item_type_id,
                t.story_points, t.assigned_to, t.is_blocked, t.completed_at, t.priority
         FROM tasks t WHERE t.sprint_id = $1 AND ${SPRINT_POINT_TICKET_SQL}`, [sprintId],
    )).rows;
}

/** Sprint members with workflow terminality and hierarchy for carryover planning. */
export async function findSprintCarryoverTasks(db: SprintDb, sprintId: unknown, orgId: number | null) {
    return (await db.query(
        `SELECT t.id, t.title, CASE WHEN ${SPRINT_POINT_TICKET_SQL} THEN t.story_points ELSE NULL END AS story_points, t.parent_task_id,
                COALESCE(w.is_subtask, FALSE) AS is_subtask,
                COALESCE(ws.is_terminal, FALSE) AS is_terminal,
                COALESCE(ws.is_terminal, FALSE) AS completed
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id
           JOIN projects tm ON tm.id = s.project_id
           LEFT JOIN work_item_types w ON w.id = t.work_item_type_id
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1
            AND t.org_id IS NOT DISTINCT FROM $2
            AND tm.org_id IS NOT DISTINCT FROM $2
          ORDER BY t.id ASC`,
        [sprintId, orgId],
    )).rows;
}

/** The next planned sprint for a project, excluding the source. */
export async function findNextPlannedSprint(
    db: SprintDb,
    projectId: unknown,
    excludeSprintId: unknown,
    orgId: number | null,
) {
    return (await db.query(
        `SELECT s.id, s.name, s.start_date, s.end_date, s.status FROM sprints s
           JOIN projects tm ON tm.id = s.project_id
          WHERE s.project_id = $1
            AND s.status = 'planned'
            AND s.id <> $2
            AND tm.org_id IS NOT DISTINCT FROM $3
          ORDER BY s.start_date ASC, s.id ASC
          LIMIT 1`,
        [projectId, excludeSprintId, orgId],
    )).rows[0] || null;
}

export async function findCarryoverSprintDateRange(db: SprintDb, durationDays: number) {
    return (await db.query(
        `SELECT to_char(CURRENT_DATE + 1, 'YYYY-MM-DD') AS start_date,
                to_char(CURRENT_DATE + $1::int, 'YYYY-MM-DD') AS end_date`,
        [durationDays],
    )).rows[0];
}

export async function createCarryoverSprint(
    db: SprintDb,
    projectId: number,
    orgId: number | null,
    name: string,
    startDate: string,
    endDate: string,
) {
    return (await db.query(
        `INSERT INTO sprints (project_id, name, start_date, end_date, goal, status)
         SELECT p.id, $3, $4, $5, NULL, 'planned'
           FROM projects p
          WHERE p.id = $1 AND p.org_id IS NOT DISTINCT FROM $2
         RETURNING *`,
        [projectId, orgId, name, startDate, endDate],
    )).rows[0] ?? null;
}

/** Points and terminal flags for a sprint's burndown snapshot. */
export async function findSprintBurndownInputs(db: SprintDb, sprintId: number, orgId: number | null) {
    return (await db.query(
        `SELECT t.story_points, ws.is_terminal, t.is_blocked
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id
           JOIN projects tm ON tm.id = s.project_id
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1 AND ${SPRINT_POINT_TICKET_SQL}
            AND t.org_id IS NOT DISTINCT FROM $2
            AND tm.org_id IS NOT DISTINCT FROM $2`,
        [sprintId, orgId],
    )).rows;
}

/** Upsert one day's burndown row, so re-running the sweep is idempotent. */
export async function upsertBurndownSnapshot(
    db: SprintDb,
    sprintId: number,
    orgId: number | null,
    totals: { total: number; done: number; remaining: number; blocked: number; openTasks: number },
): Promise<void> {
    await db.query(
        `INSERT INTO sprint_burndown_snapshots (sprint_id, snapshot_date, total_points, done_points, remaining_points, blocked_points, open_tasks)
         SELECT s.id, CURRENT_DATE, $3, $4, $5, $6, $7
           FROM sprints s
           JOIN projects tm ON tm.id = s.project_id
          WHERE s.id = $1
            AND tm.org_id IS NOT DISTINCT FROM $2
         ON CONFLICT (sprint_id, snapshot_date)
         DO UPDATE SET total_points = EXCLUDED.total_points,
                       done_points = EXCLUDED.done_points,
                       remaining_points = EXCLUDED.remaining_points,
                       blocked_points = EXCLUDED.blocked_points,
                       open_tasks = EXCLUDED.open_tasks`,
        [sprintId, orgId, totals.total, totals.done, totals.remaining, totals.blocked, totals.openTasks],
    );
}

/** Snapshot one sprint using the same read/write transaction client. */
export async function snapshotBurndown(db: SprintDb, sprintId: number, orgId: number | null): Promise<void> {
    const tasks = await findSprintBurndownInputs(db, sprintId, orgId);
    let total = 0;
    let done = 0;
    let blocked = 0;
    let openTasks = 0;
    for (const task of tasks) {
        const points = task.story_points == null ? 0 : Number(task.story_points);
        total += points;
        if (task.is_terminal) done += points;
        else openTasks++;
        if (task.is_blocked) blocked += points;
    }
    await upsertBurndownSnapshot(db, sprintId, orgId, {
        total,
        done,
        remaining: total - done,
        blocked,
        openTasks,
    });
}

export async function claimSprintCompletion(db: SprintDb, sprintId: number, orgId: number | null): Promise<any | null> {
    return (await db.query(
        `UPDATE sprints s
            SET completed_at = COALESCE(completed_at, NOW())
          WHERE s.id = $1
            AND s.status <> 'completed'
            AND EXISTS (
                SELECT 1 FROM projects tm
                 WHERE tm.id = s.project_id
                   AND tm.org_id IS NOT DISTINCT FROM $2
            )
      RETURNING s.*`,
        [sprintId, orgId],
    )).rows[0] ?? null;
}

export async function findSprintCompletionActor(
    db: SprintDb,
    sprintId: number,
    orgId: number | null,
): Promise<any | null> {
    return (await db.query(
        `SELECT p.org_id,
                (SELECT t.user_id FROM tasks t
                  WHERE t.sprint_id = s.id AND t.org_id IS NOT DISTINCT FROM $2
                  ORDER BY t.id LIMIT 1) AS actor_id
           FROM sprints s JOIN projects p ON p.id = s.project_id
          WHERE s.id = $1 AND p.org_id IS NOT DISTINCT FROM $2`,
        [sprintId, orgId],
    )).rows[0] ?? null;
}

export async function findRolloverTarget(
    db: SprintDb,
    targetSprintId: number,
    projectId: number,
    orgId: number | null,
): Promise<any | null> {
    return (await db.query(
        `SELECT s.id, s.name, s.status, s.start_date, s.end_date, s.project_id
           FROM sprints s
           JOIN projects tm ON tm.id = s.project_id
          WHERE s.id = $1
            AND s.project_id = $2
            AND tm.org_id IS NOT DISTINCT FROM $3
          FOR SHARE OF s`,
        [targetSprintId, projectId, orgId],
    )).rows[0] ?? null;
}

export async function lockSprintCompletionMembers(db: SprintDb, sprintId: number, orgId: number | null): Promise<any[]> {
    return (await db.query(
        `SELECT t.id, t.title, CASE WHEN ${SPRINT_POINT_TICKET_SQL} THEN t.story_points ELSE NULL END AS story_points, t.parent_task_id,
                COALESCE(w.is_subtask, FALSE) AS is_subtask,
                COALESCE(ws.is_terminal, FALSE) AS is_terminal,
                COALESCE(ws.is_terminal, FALSE) AS completed
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id
           JOIN projects tm ON tm.id = s.project_id
           LEFT JOIN work_item_types w ON w.id = t.work_item_type_id
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1
            AND t.org_id IS NOT DISTINCT FROM $2
            AND tm.org_id IS NOT DISTINCT FROM $2
          ORDER BY t.id
            FOR UPDATE OF t`,
        [sprintId, orgId],
    )).rows;
}

export async function findSprintCompletionVelocity(db: SprintDb, sprintId: number, orgId: number | null): Promise<any> {
    return (await db.query(
        `SELECT COALESCE(SUM(t.story_points), 0)::float AS velocity,
                COUNT(*) FILTER (WHERE ws.is_terminal) AS done_tasks,
                COUNT(*) AS total_tasks
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id
           JOIN projects tm ON tm.id = s.project_id
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1 AND ${SPRINT_POINT_TICKET_SQL}
            AND t.org_id IS NOT DISTINCT FROM $2
            AND tm.org_id IS NOT DISTINCT FROM $2`,
        [sprintId, orgId],
    )).rows[0];
}

export async function stampTicketCarryover(
    db: SprintDb,
    sprintId: number,
    taskIds: number[],
    orgId: number | null,
): Promise<void> {
    await db.query(
        `UPDATE tasks
            SET carried_over_from_sprint_id = $1
          WHERE id = ANY($2::int[])
            AND org_id IS NOT DISTINCT FROM $3`,
        [sprintId, taskIds, orgId],
    );
}

export async function linkSprintCarryover(
    db: SprintDb,
    sprintId: number,
    targetSprintId: number,
    orgId: number | null,
): Promise<void> {
    await db.query(
        `UPDATE sprints target
            SET carried_from_sprint_id = $1
          FROM projects tm
          WHERE target.id = $2
            AND target.project_id = tm.id
            AND tm.org_id IS NOT DISTINCT FROM $3
            AND target.carried_from_sprint_id IS NULL
            AND EXISTS (
                SELECT 1 FROM sprints source
                 WHERE source.id = $1 AND source.project_id = target.project_id
            )`,
        [sprintId, targetSprintId, orgId],
    );
}

export async function finishSprint(db: SprintDb, sprintId: number, velocity: number, orgId: number | null): Promise<any> {
    return (await db.query(
        `UPDATE sprints s
            SET status = 'completed',
                completed_at = COALESCE(completed_at, NOW()),
                velocity_points = $1
          WHERE s.id = $2
            AND EXISTS (
                SELECT 1 FROM projects tm
                 WHERE tm.id = s.project_id
                   AND tm.org_id IS NOT DISTINCT FROM $3
            )
      RETURNING s.*`,
        [velocity, sprintId, orgId],
    )).rows[0];
}

export async function lockSprintForDeletion(
    db: SprintDb,
    sprintId: number | string,
    orgId: number | null,
): Promise<any | null> {
    return (await db.query(
        `SELECT s.id, s.status
           FROM sprints s
           JOIN projects tm ON tm.id = s.project_id
          WHERE s.id = $1
            AND tm.org_id IS NOT DISTINCT FROM $2
          ORDER BY s.id
          FOR UPDATE OF s`,
        [sprintId, orgId],
    )).rows[0] ?? null;
}

export async function pauseSprintForOrg(
    db: SprintDb,
    sprintId: number | string,
    orgId: number | null,
): Promise<boolean> {
    const updated = await db.query(
        `UPDATE sprints s
            SET status = 'paused', paused_at = NOW()
          WHERE s.id = $1 AND s.status = 'active'
            AND EXISTS (SELECT 1 FROM projects tm WHERE tm.id = s.project_id AND tm.org_id IS NOT DISTINCT FROM $2)
      RETURNING s.id`,
        [sprintId, orgId],
    );
    return !!updated.rowCount;
}

export async function findSprintMemberIds(db: SprintDb, sprintId: number | string, orgId: number | null): Promise<number[]> {
    return (await db.query(
        `SELECT t.id
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id
           JOIN projects tm ON tm.id = s.project_id
          WHERE t.sprint_id = $1
            AND t.org_id IS NOT DISTINCT FROM $2
            AND tm.org_id IS NOT DISTINCT FROM $2
          ORDER BY t.id
          FOR UPDATE OF t`,
        [sprintId, orgId],
    )).rows.map((task: { id: number }) => Number(task.id));
}

export async function deleteSprint(db: SprintDb, sprintId: number | string, orgId: number | null): Promise<void> {
    await db.query(
        `DELETE FROM sprints s
          USING projects tm
          WHERE s.project_id = tm.id
            AND s.id = $1
            AND tm.org_id IS NOT DISTINCT FROM $2`,
        [sprintId, orgId],
    );
}

/** Active members of a team, for a sprint-wide notification. */
export async function findTeamMemberIds(db: SprintDb, teamId: number, orgId: number | null): Promise<number[]> {
    return (await db.query(
        `SELECT u.id
           FROM users u
           JOIN teams tm ON tm.id = u.team_id
          WHERE u.team_id = $1
            AND u.org_id IS NOT DISTINCT FROM $2
            AND tm.org_id IS NOT DISTINCT FROM $2
            AND u.is_active = TRUE`,
        [teamId, orgId],
    )).rows.map((row: { id: number }) => Number(row.id));
}
