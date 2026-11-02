/**
 * SQL ownership for the sprint lifecycle surfaces: baselines, completion
 * preview, burndown snapshots and the notification audience.
 *
 * Routes and helpers call these instead of holding SQL, so the sprint queries
 * live next to the rules they serve.
 */

/**
 * Scheduled container: unsprinted tickets carrying a planned day.
 *
 * Completed history is trimmed to the window the client shows, so a finished
 * ticket stays visible for `SCHEDULED_HISTORY_DAYS` and then drops out.
 */
export async function listScheduledTasks(db: SprintDb, whereSql: string, params: unknown[]) {
    return (await db.query(
        `SELECT t.* FROM tasks t WHERE ${whereSql} ORDER BY COALESCE(t.planned_date, t.due_date) ASC LIMIT 1000`,
        params,
    )).rows;
}

export interface SprintDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

/** One sprint, scoped to the requester's org. */
export async function findSprintInOrg(db: SprintDb, sprintId: unknown, orgId: number | null) {
    return (await db.query(
        "SELECT s.* FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id IS NOT DISTINCT FROM $2",
        [sprintId, orgId],
    )).rows[0] || null;
}

export async function findSprintStatusInOrg(db: SprintDb, sprintId: unknown, orgId: number | null) {
    return (await db.query(
        `SELECT s.status
           FROM sprints s
           JOIN teams tm ON tm.id = s.team_id
          WHERE s.id = $1 AND tm.org_id IS NOT DISTINCT FROM $2`,
        [sprintId, orgId],
    )).rows[0] ?? null;
}

/** Every sprint in an org, optionally narrowed to one team (admin view). */
export async function findSprintsForOrg(db: SprintDb, orgId: unknown, teamId?: number | null) {
    return (await db.query(
        `SELECT s.* FROM sprints s
           JOIN teams t ON t.id = s.team_id
          WHERE t.org_id IS NOT DISTINCT FROM $1
            AND ($2::int IS NULL OR s.team_id = $2::int)
          ORDER BY
              CASE s.status WHEN 'active' THEN 1 WHEN 'planned' THEN 2 WHEN 'completed' THEN 3 END,
              s.start_date DESC`,
        [orgId, teamId ?? null],
    )).rows;
}

/** Every sprint belonging to one team (member view). */
export async function findSprintsForTeam(db: SprintDb, teamId: unknown) {
    return (await db.query(
        `SELECT * FROM sprints
          WHERE team_id = $1
          ORDER BY
              CASE status WHEN 'active' THEN 1 WHEN 'planned' THEN 2 WHEN 'completed' THEN 3 END,
              start_date DESC`,
        [teamId],
    )).rows;
}

/** One sprint joined with its team's org, for access checks. */
export async function findSprintWithTeam(db: SprintDb, sprintId: unknown) {
    return (await db.query(
        `SELECT s.*, t.org_id, t.name AS team_name
           FROM sprints s JOIN teams t ON t.id = s.team_id
          WHERE s.id = $1`,
        [sprintId],
    )).rows[0] || null;
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
        "SELECT id, story_points FROM tasks WHERE sprint_id = $1",
        [sprintId],
    )).rows;
}

/** Tasks in a sprint with the completion flag the carryover plan reads. */
export async function findSprintCarryoverTasks(db: SprintDb, sprintId: unknown, orgId: number | null) {
    return (await db.query(
        `SELECT t.id, t.title, t.story_points, (t.completed_at IS NOT NULL) AS completed
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id AND s.team_id = t.team_id
           JOIN teams tm ON tm.id = s.team_id
          WHERE t.sprint_id = $1
            AND t.org_id IS NOT DISTINCT FROM $2
            AND tm.org_id IS NOT DISTINCT FROM $2
          ORDER BY t.created_at ASC`,
        [sprintId, orgId],
    )).rows;
}

/** The next planned sprint for a team, excluding the one being completed. */
export async function findNextPlannedSprint(
    db: SprintDb,
    teamId: unknown,
    excludeSprintId: unknown,
    orgId: number | null,
) {
    return (await db.query(
        `SELECT s.id FROM sprints s
           JOIN teams tm ON tm.id = s.team_id
          WHERE s.team_id = $1
            AND s.status = 'planned'
            AND s.id <> $2
            AND tm.org_id IS NOT DISTINCT FROM $3
          ORDER BY s.start_date ASC
          LIMIT 1`,
        [teamId, excludeSprintId, orgId],
    )).rows[0] || null;
}

/**
 * The start date of the team's most recently completed sprint.
 *
 * The completed section shows the last 30 days or the last closed sprint,
 * whichever reaches further back (D17), so this is the floor that keeps a
 * long-running sprint's finished work visible.
 */
export async function findLastCompletedSprintStart(
    db: SprintDb,
    teamId: unknown,
): Promise<string | null> {
    const row = (await db.query(
        `SELECT start_date FROM sprints
          WHERE team_id = $1 AND status = 'completed' AND start_date IS NOT NULL
          ORDER BY completed_at DESC NULLS LAST, end_date DESC
          LIMIT 1`,
        [teamId],
    )).rows[0];
    return row?.start_date ?? null;
}

/**
 * SET fragment that saves the ticket's own due date on its first sprint entry.
 * Moving sprint → sprint keeps the original value. Evaluated against the
 * pre-update row, so it must precede the `sprint_id`/`due_date` assignments
 * only for readability — Postgres reads old values for every SET expression.
 */
export const REMEMBER_DUE_DATE =
    "pre_sprint_due_date = CASE WHEN sprint_id IS NULL THEN due_date ELSE pre_sprint_due_date END";

/** SET fragment that takes a ticket out of its sprint and restores its date. */
export const LEAVE_SPRINT = "sprint_id = NULL, due_date = pre_sprint_due_date, pre_sprint_due_date = NULL";

/** Points and terminal flags for a sprint's burndown snapshot. */
export async function findSprintBurndownInputs(db: SprintDb, sprintId: number, orgId: number | null) {
    return (await db.query(
        `SELECT t.story_points, ws.is_terminal, t.is_blocked
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id AND s.team_id = t.team_id
           JOIN teams tm ON tm.id = s.team_id
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1
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
           JOIN teams tm ON tm.id = s.team_id
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
                SELECT 1 FROM teams tm
                 WHERE tm.id = s.team_id
                   AND tm.org_id IS NOT DISTINCT FROM $2
            )
      RETURNING s.*`,
        [sprintId, orgId],
    )).rows[0] ?? null;
}

export async function findSprintCompletionActor(
    db: SprintDb,
    sprintId: number,
    teamId: number,
    orgId: number | null,
): Promise<any | null> {
    return (await db.query(
        `SELECT tm.org_id,
                COALESCE(
                    (SELECT u.id FROM users u
                      WHERE u.id = tm.lead_id AND u.team_id = tm.id
                        AND u.org_id IS NOT DISTINCT FROM $3
                      LIMIT 1),
                    (SELECT u.id FROM users u
                      WHERE u.team_id = tm.id AND u.org_id IS NOT DISTINCT FROM $3
                        AND u.is_active = TRUE ORDER BY u.id LIMIT 1),
                    (SELECT t.user_id FROM tasks t
                      WHERE t.sprint_id = $1 AND t.team_id = tm.id
                        AND t.org_id IS NOT DISTINCT FROM $3
                      ORDER BY t.id LIMIT 1)
                ) AS actor_id
           FROM teams tm
           JOIN sprints s ON s.team_id = tm.id
          WHERE s.id = $1
            AND tm.id = $2
            AND tm.org_id IS NOT DISTINCT FROM $3`,
        [sprintId, teamId, orgId],
    )).rows[0] ?? null;
}

export async function findRolloverTarget(
    db: SprintDb,
    targetSprintId: number,
    teamId: number,
    orgId: number | null,
): Promise<any | null> {
    return (await db.query(
        `SELECT s.id, s.name, s.status, s.end_date
           FROM sprints s
           JOIN teams tm ON tm.id = s.team_id
          WHERE s.id = $1
            AND s.team_id = $2
            AND tm.org_id IS NOT DISTINCT FROM $3
          FOR SHARE OF s`,
        [targetSprintId, teamId, orgId],
    )).rows[0] ?? null;
}

export async function lockSprintCompletionMembers(db: SprintDb, sprintId: number, orgId: number | null): Promise<any[]> {
    return (await db.query(
        `SELECT t.id, COALESCE(ws.is_terminal, FALSE) AS is_terminal
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id AND s.team_id = t.team_id
           JOIN teams tm ON tm.id = s.team_id
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
           JOIN sprints s ON s.id = t.sprint_id AND s.team_id = t.team_id
           JOIN teams tm ON tm.id = s.team_id
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1
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
          FROM teams tm
          WHERE target.id = $2
            AND target.team_id = tm.id
            AND tm.org_id IS NOT DISTINCT FROM $3
            AND target.carried_from_sprint_id IS NULL
            AND EXISTS (
                SELECT 1 FROM sprints source
                 WHERE source.id = $1 AND source.team_id = target.team_id
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
                SELECT 1 FROM teams tm
                 WHERE tm.id = s.team_id
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
           JOIN teams tm ON tm.id = s.team_id
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
    teamId: number | string,
    orgId: number | null,
): Promise<boolean> {
    const updated = await db.query(
        `UPDATE sprints s
            SET status = 'paused', paused_at = NOW()
          WHERE s.id = $1 AND s.status = 'active'
            AND EXISTS (SELECT 1 FROM teams tm WHERE tm.id = s.team_id AND tm.org_id IS NOT DISTINCT FROM $2)
      RETURNING s.id`,
        [sprintId, orgId],
    );
    if (!updated.rowCount) return false;
    await db.query(
        "UPDATE teams SET sprint_paused = TRUE WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2",
        [teamId, orgId],
    );
    return true;
}

export async function findSprintMemberIds(db: SprintDb, sprintId: number | string, orgId: number | null): Promise<number[]> {
    return (await db.query(
        `SELECT t.id
           FROM tasks t
           JOIN sprints s ON s.id = t.sprint_id AND s.team_id = t.team_id
           JOIN teams tm ON tm.id = s.team_id
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
          USING teams tm
          WHERE s.team_id = tm.id
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
