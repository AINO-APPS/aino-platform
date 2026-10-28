/**
 * SQL ownership for the sprint lifecycle surfaces: baselines, completion
 * preview, burndown snapshots and the notification audience.
 *
 * Routes and helpers call these instead of holding SQL, so the sprint queries
 * live next to the rules they serve.
 */

/**
 * Scheduled container: unsprinted tickets carrying a planned or due date.
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

/** Clear the planned day, and the due date unless the caller keeps it. */
export async function clearScheduledDates(db: SprintDb, taskId: unknown, keepDue: boolean): Promise<void> {
    await db.query(
        keepDue
            ? "UPDATE tasks SET planned_date = NULL WHERE id = $1"
            : "UPDATE tasks SET planned_date = NULL, due_date = NULL WHERE id = $1",
        [taskId],
    );
}

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
 * SET fragment that saves the ticket's own due date on its first sprint entry.
 * Moving sprint → sprint keeps the original value. Evaluated against the
 * pre-update row, so it must precede the `sprint_id`/`due_date` assignments
 * only for readability — Postgres reads old values for every SET expression.
 */
export const REMEMBER_DUE_DATE =
    "pre_sprint_due_date = CASE WHEN sprint_id IS NULL THEN due_date ELSE pre_sprint_due_date END";

/** SET fragment that takes a ticket out of its sprint and restores its date. */
export const LEAVE_SPRINT = "sprint_id = NULL, due_date = pre_sprint_due_date, pre_sprint_due_date = NULL";

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
            `UPDATE tasks SET ${REMEMBER_DUE_DATE}, sprint_id = $1, due_date = $2, team_id = $3 WHERE id = $4`,
            [sprintId, dueDate, teamId, taskId],
        );
        return;
    }
    await db.query(
        `UPDATE tasks SET ${REMEMBER_DUE_DATE}, sprint_id = $1, due_date = $2 WHERE id = $3`,
        [sprintId, dueDate, taskId],
    );
}

/**
 * Take a task out of its sprint and give it back its own due date, so it lands
 * in Scheduled if it had one and the Backlog otherwise.
 */
export async function clearSprint(db: SprintDb, taskId: unknown): Promise<void> {
    await db.query(`UPDATE tasks SET ${LEAVE_SPRINT} WHERE id = $1`, [taskId]);
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

/**
 * Due-date bookkeeping when a ticket enters or leaves a sprint, as one pure
 * step so the PATCH path cannot drift from `setSprintAndDueDate`/`clearSprint`.
 *
 * Entering remembers the ticket's own date (first entry only) and adopts the
 * sprint's end date. Leaving restores the remembered date, unless the same
 * request sets one explicitly.
 */
export function nextSprintDates(input: {
    currentSprintId: unknown;
    currentDueDate: string | null;
    currentPreSprintDueDate: string | null;
    /** The requested due date, or undefined when the request does not set one. */
    requestedDueDate?: string | null;
    /** The sprint being joined, or null when the ticket leaves its sprint. */
    join: { endDate: string } | null;
}): { dueDate: string | null; preSprintDueDate: string | null; leftSprint: boolean } {
    const wasSprinted = input.currentSprintId != null;
    if (!input.join) {
        if (!wasSprinted) {
            return { dueDate: input.currentDueDate, preSprintDueDate: input.currentPreSprintDueDate, leftSprint: false };
        }
        return {
            dueDate: input.requestedDueDate !== undefined ? input.requestedDueDate : input.currentPreSprintDueDate,
            preSprintDueDate: null,
            leftSprint: true,
        };
    }
    return {
        dueDate: input.join.endDate,
        preSprintDueDate: wasSprinted ? input.currentPreSprintDueDate : input.currentDueDate,
        leftSprint: false,
    };
}
