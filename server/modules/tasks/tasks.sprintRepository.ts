/**
 * SQL ownership for the sprint lifecycle surfaces: baselines, completion
 * preview, burndown snapshots and the notification audience.
 *
 * Routes and helpers call these instead of holding SQL, so the sprint queries
 * live next to the rules they serve.
 */

export interface SprintDb {
    query(sql: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number }>;
}

/** One sprint, scoped to the requester's org. */
export async function findSprintInOrg(db: SprintDb, sprintId: unknown, orgId: number | null) {
    return (await db.query(
        "SELECT s.* FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id = $2",
        [sprintId, orgId],
    )).rows[0] || null;
}

/** Every sprint in an org, optionally narrowed to one team (admin view). */
export async function findSprintsForOrg(db: SprintDb, orgId: unknown, teamId?: number | null) {
    return (await db.query(
        `SELECT s.* FROM sprints s
           JOIN teams t ON t.id = s.team_id
          WHERE t.org_id = $1
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
export async function findSprintCarryoverTasks(db: SprintDb, sprintId: unknown) {
    return (await db.query(
        `SELECT t.id, t.title, t.story_points, (t.completed_at IS NOT NULL) AS completed
           FROM tasks t
          WHERE t.sprint_id = $1
          ORDER BY t.created_at ASC`,
        [sprintId],
    )).rows;
}

/** The next planned sprint for a team, excluding the one being completed. */
export async function findNextPlannedSprint(db: SprintDb, teamId: unknown, excludeSprintId: unknown) {
    return (await db.query(
        `SELECT id FROM sprints
          WHERE team_id = $1 AND status = 'planned' AND id <> $2
          ORDER BY start_date ASC
          LIMIT 1`,
        [teamId, excludeSprintId],
    )).rows[0] || null;
}

/** A sprint's display name, for history lines. */
export async function findSprintName(db: SprintDb, sprintId: unknown) {
    return (await db.query("SELECT name FROM sprints WHERE id = $1", [sprintId])).rows[0] || null;
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
 * Move a task into a sprint and adopt the sprint's end date as its due date.
 *
 * `teamId` is passed for a legacy ticket with no owner: entering a sprint is
 * the moment it adopts that sprint's team. A ticket that already has a team
 * keeps it (the caller has already checked the same-team rule).
 */
export async function setSprintAndDueDate(
    db: SprintDb,
    taskId: unknown,
    sprintId: unknown,
    dueDate: unknown,
    teamId?: number | null,
): Promise<void> {
    if (teamId !== undefined && teamId !== null) {
        await db.query(
            "UPDATE tasks SET sprint_id = $1, due_date = $2, team_id = $3 WHERE id = $4",
            [sprintId, dueDate, teamId, taskId],
        );
        return;
    }
    await db.query("UPDATE tasks SET sprint_id = $1, due_date = $2 WHERE id = $3", [sprintId, dueDate, taskId]);
}

/** Move a task back to the backlog. */
export async function clearSprint(db: SprintDb, taskId: unknown): Promise<void> {
    await db.query("UPDATE tasks SET sprint_id = NULL WHERE id = $1", [taskId]);
}

/** Points and terminal flags for a sprint's burndown snapshot. */
export async function findSprintBurndownInputs(db: SprintDb, sprintId: number) {
    return (await db.query(
        `SELECT t.story_points, ws.is_terminal, t.is_blocked
           FROM tasks t
           LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
          WHERE t.sprint_id = $1`,
        [sprintId],
    )).rows;
}

/** Upsert one day's burndown row, so re-running the sweep is idempotent. */
export async function upsertBurndownSnapshot(
    db: SprintDb,
    sprintId: number,
    totals: { total: number; done: number; remaining: number; blocked: number; openTasks: number },
): Promise<void> {
    await db.query(
        `INSERT INTO sprint_burndown_snapshots (sprint_id, snapshot_date, total_points, done_points, remaining_points, blocked_points, open_tasks)
         VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6)
         ON CONFLICT (sprint_id, snapshot_date)
         DO UPDATE SET total_points = EXCLUDED.total_points,
                       done_points = EXCLUDED.done_points,
                       remaining_points = EXCLUDED.remaining_points,
                       blocked_points = EXCLUDED.blocked_points,
                       open_tasks = EXCLUDED.open_tasks`,
        [sprintId, totals.total, totals.done, totals.remaining, totals.blocked, totals.openTasks],
    );
}

/** Active members of a team, for a sprint-wide notification. */
export async function findTeamMemberIds(db: SprintDb, teamId: number): Promise<number[]> {
    return (await db.query(
        "SELECT id FROM users WHERE team_id = $1 AND is_active = TRUE",
        [teamId],
    )).rows.map((row: { id: number }) => Number(row.id));
}
