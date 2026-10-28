/** SQL ownership for the task domain. */
import type { GitRefInput, TasksDb } from "./tasks.types";
import { LEAVE_SPRINT, REMEMBER_DUE_DATE } from "./tasks.sprintRepository";

export const findTask = async (db: TasksDb, id: number | string) =>
    (await db.query("SELECT * FROM tasks WHERE id = $1", [id])).rows[0];

export const findComments = async (db: TasksDb, taskId: number) => (await db.query(
    `SELECT tc.*, u.username, u.full_name, u.avatar
       FROM task_comments tc JOIN users u ON u.id = tc.user_id
      WHERE tc.task_id = $1 ORDER BY tc.created_at ASC`, [taskId],
)).rows;

export const findHistory = async (db: TasksDb, taskId: number | string) => (await db.query(
    `SELECT th.*, u.username, u.full_name, u.avatar
       FROM task_history th JOIN users u ON u.id = th.user_id
      WHERE th.task_id = $1 ORDER BY th.created_at DESC LIMIT 200`, [taskId],
)).rows;

export const setBlocked = async (db: TasksDb, id: number, blocked: boolean, reason: string | null) =>
    db.query("UPDATE tasks SET is_blocked = $1, blocked_reason = $2 WHERE id = $3", [blocked, reason, id]);

export const setCriteria = async (db: TasksDb, id: number, criteria: unknown[]) =>
    db.query("UPDATE tasks SET acceptance_criteria = $1::jsonb WHERE id = $2", [JSON.stringify(criteria), id]);

export const addHistory = async (
    db: TasksDb, taskId: number, action: string, field: string, value: unknown, userId: number,
) => db.query(
    "INSERT INTO task_history (task_id, action, field, new_value, user_id) VALUES ($1, $2, $3, $4, $5)",
    [taskId, action, field, value, userId],
);

export const findAssignableUsers = async (db: TasksDb, orgId: number | null, userId: number) => orgId
    ? (await db.query(
        "SELECT id, username, full_name, avatar FROM users WHERE org_id = $1 AND is_active = TRUE AND hidden_from_directory = FALSE ORDER BY full_name ASC",
        [orgId],
    )).rows
    : (await db.query("SELECT id, username, full_name, avatar FROM users WHERE id = $1", [userId])).rows;

export const findLabels = async (db: TasksDb, orgId: number) => (await db.query(
    "SELECT id, name, color FROM task_labels WHERE org_id = $1 ORDER BY name ASC", [orgId],
)).rows;

export const findGitRefs = async (db: TasksDb, taskId: number) => (await db.query(
    `SELECT id, ref_type, status, external_id, title, url, repository, ref_name,
            author_login, commit_sha, event_at, created_at, updated_at
       FROM task_git_refs WHERE task_id = $1 ORDER BY event_at DESC`, [taskId],
)).rows;

export const saveGitRef = async (db: TasksDb, taskId: number, input: GitRefInput, status: string) => (await db.query(
    `INSERT INTO task_git_refs
        (task_id, ref_type, status, external_id, title, url, repository, ref_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (task_id, ref_type, external_id, repository)
     DO UPDATE SET status = EXCLUDED.status, title = EXCLUDED.title, url = EXCLUDED.url,
                   ref_name = EXCLUDED.ref_name, updated_at = NOW()
     RETURNING *`,
    [taskId, input.ref_type, status, input.external_id || null, input.title || null,
        input.url || null, input.repository || null, input.ref_name || null],
)).rows[0];

export const deleteGitRef = async (db: TasksDb, taskId: number, refId: number) =>
    (await db.query("DELETE FROM task_git_refs WHERE id = $1 AND task_id = $2 RETURNING id", [refId, taskId])).rowCount;

export const findChildren = async (db: TasksDb, taskId: number) => (await db.query(
    `SELECT t.id, t.title, t.workflow_state_id, t.is_blocked,
            t.story_points, t.work_item_type_id, t.priority, t.assigned_to,
            u.full_name AS assignee_name, u.username AS assignee_username,
            ws.name AS state_name, ws.color AS state_color, ws.is_terminal,
            wit.name AS type_name, wit.color AS type_color
       FROM tasks t
  LEFT JOIN users u ON u.id = t.assigned_to
  LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
  LEFT JOIN work_item_types wit ON wit.id = t.work_item_type_id
      WHERE t.parent_task_id = $1
      ORDER BY CASE t.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
               t.created_at ASC`, [taskId],
)).rows;

export const findParent = async (db: TasksDb, taskId: number) => (await db.query(
    `SELECT t.id, t.title, t.workflow_state_id, t.is_blocked, t.story_points,
            t.work_item_type_id, ws.name AS state_name, ws.color AS state_color,
            wit.name AS type_name, wit.color AS type_color, wit.is_epic
       FROM tasks t
  LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
  LEFT JOIN work_item_types wit ON wit.id = t.work_item_type_id
      WHERE t.id = $1`, [taskId],
)).rows[0];

export const findTaskOrg = async (db: TasksDb, id: number) =>
    (await db.query("SELECT id, org_id FROM tasks WHERE id = $1", [id])).rows[0];
export const findParentId = async (db: TasksDb, id: number) =>
    (await db.query("SELECT parent_task_id FROM tasks WHERE id = $1", [id])).rows[0]?.parent_task_id || null;
export const setParent = async (db: TasksDb, id: number, parentId: number | null) =>
    db.query("UPDATE tasks SET parent_task_id = $1 WHERE id = $2", [parentId, id]);

/** Resolve a canonical issue key (PROJ-123) inside one org. */
export const findByIssueKey = async (db: TasksDb, orgId: number | null, projectKey: string, taskNumber: number) =>
    (await db.query(
        `SELECT t.* FROM tasks t
           JOIN projects p ON p.id = t.project_id
          WHERE p.org_id = $1 AND p.key = $2 AND t.task_number = $3`,
        [orgId, projectKey, taskNumber],
    )).rows[0];

/** The stored LexoRank of one task, scoped to the org. */
export const findRank = async (db: TasksDb, id: number, orgId: number | null): Promise<string | null> =>
    (await db.query("SELECT rank FROM tasks WHERE id = $1 AND org_id = $2", [id, orgId])).rows[0]?.rank ?? null;

export const setRank = async (db: TasksDb, id: number | string, rank: string) =>
    db.query("UPDATE tasks SET rank = $1 WHERE id = $2", [rank, id]);

/** Tasks in one org, for a bulk action. */
export const findManyInOrg = async (db: TasksDb, ids: number[], orgId: number | null) =>
    (await db.query("SELECT * FROM tasks WHERE id = ANY($1::int[]) AND org_id = $2", [ids, orgId])).rows;

export const setSprint = async (db: TasksDb, id: number, sprintId: number | null, teamId?: number | null) => {
    if (sprintId === null) return db.query(`UPDATE tasks SET ${LEAVE_SPRINT} WHERE id = $1`, [id]);
    return teamId !== undefined && teamId !== null
        ? db.query(`UPDATE tasks SET ${REMEMBER_DUE_DATE}, sprint_id = $1, team_id = $3 WHERE id = $2`, [sprintId, id, teamId])
        : db.query(`UPDATE tasks SET ${REMEMBER_DUE_DATE}, sprint_id = $1 WHERE id = $2`, [sprintId, id]);
};

export const setWorkflowState = async (db: TasksDb, id: number, workflowStateId: number | null) =>
    db.query("UPDATE tasks SET workflow_state_id = $1 WHERE id = $2", [workflowStateId, id]);

/** The display name of a user, falling back to the username. */
export const findActorName = async (db: TasksDb, userId: number | null | undefined): Promise<string | null> => {
    if (!userId) return null;
    const row = (await db.query("SELECT full_name, username FROM users WHERE id = $1", [userId])).rows[0];
    return row?.full_name || row?.username || null;
};

/**
 * The active members of a ticket's owning team.
 *
 * Status changes are broadcast to them, not only to the assignee and reporter:
 * the team shares the board, so a card that moves should move for everyone
 * looking at it without a refetch. An unowned ticket has no team to notify.
 */
export const findTeamMemberIds = async (
    db: TasksDb,
    teamId: number | null | undefined,
    orgId: number | null | undefined,
): Promise<number[]> => {
    if (!teamId || !orgId) return [];
    return (await db.query(
        "SELECT id FROM users WHERE team_id = $1 AND org_id = $2 AND is_active = TRUE",
        [teamId, orgId],
    )).rows.map((row: any) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
};

export const setAssignee = async (db: TasksDb, id: number, assignee: number | null) =>
    db.query("UPDATE tasks SET assigned_to = $1 WHERE id = $2", [assignee, id]);

export const deleteTask = async (db: TasksDb, id: number) =>
    db.query("DELETE FROM tasks WHERE id = $1", [id]);

/**
 * The org's "cancelled" workflow state, creating it on first use.
 *
 * Jira's model: a ticket is completed or cancelled, never deleted. Cancelling
 * keeps the record (and its comments, history and time) while taking it out of
 * the open work. The state is terminal, so the `completed_at` trigger stamps it
 * and the ticket leaves the backlog and the board's open columns.
 *
 * Tenants that already define a state with key `cancelled` (or a terminal state
 * named "Cancelled") get theirs; otherwise one is inserted after the others.
 */
export const findOrCreateCancelledState = async (db: TasksDb, orgId: number | null | undefined) => {
    if (!orgId) return null;
    const existing = (await db.query(
        `SELECT * FROM workflow_states
          WHERE org_id = $1 AND is_active = TRUE
            AND (key = 'cancelled' OR (is_terminal = TRUE AND LOWER(name) = 'cancelled'))
          -- The seeded key wins over a look-alike terminal state, so the
          -- transition rows and the lazy lookup always agree.
          ORDER BY (key = 'cancelled') DESC, sort_order ASC, id ASC
          LIMIT 1`,
        [orgId],
    )).rows[0];
    if (existing) return existing;

    const nextOrder = (await db.query(
        "SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM workflow_states WHERE org_id = $1",
        [orgId],
    )).rows[0]?.next ?? 1;

    return (await db.query(
        `INSERT INTO workflow_states (org_id, key, name, category, color, sort_order, is_initial, is_terminal)
         VALUES ($1, 'cancelled', 'Cancelled', 'done', '#6b7280', $2, FALSE, TRUE)
         ON CONFLICT (org_id, key) DO UPDATE SET is_active = TRUE
         RETURNING *`,
        [orgId, nextOrder],
    )).rows[0] || null;
};

/**
 * Every epic in the org, with its work-item type for the badge colour.
 *
 * `issue_key` is not a column: it is the project key plus the per-project task
 * number, so it is derived here the same way the task enrich step derives it.
 */
export const findEpics = async (db: TasksDb, orgId: number | null) => (await db.query(
    `SELECT t.id, t.title, t.workflow_state_id, t.story_points, t.project_id,
            CASE WHEN p.key IS NOT NULL AND t.task_number IS NOT NULL
                 THEN p.key || '-' || t.task_number END AS issue_key,
            wit.name AS type_name, wit.color AS type_color
       FROM tasks t
       JOIN work_item_types wit ON wit.id = t.work_item_type_id
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.org_id = $1 AND wit.is_epic = TRUE
      ORDER BY t.created_at ASC`, [orgId],
)).rows;

/** Completed-versus-total rollup for the given epic ids, in count and points. */
export const findEpicRollups = async (db: TasksDb, orgId: number | null, epicIds: number[]) => (await db.query(
    `SELECT t.parent_task_id,
            COUNT(*)::int AS total_children,
            COUNT(*) FILTER (WHERE t.completed_at IS NOT NULL)::int AS done_children,
            COALESCE(SUM(t.story_points), 0)::float AS total_points,
            COALESCE(SUM(t.story_points) FILTER (WHERE t.completed_at IS NOT NULL), 0)::float AS done_points
       FROM tasks t
      WHERE t.org_id = $1 AND t.parent_task_id = ANY($2::int[])
      GROUP BY t.parent_task_id`, [orgId, epicIds],
)).rows;

/**
 * Resolve (projectKey, taskNumber) pairs to task ids in one query.
 *
 * A single array-based lookup rather than one query per key, so resolving a
 * commit message that references several tickets stays one round trip.
 */
export const findTaskIdsByIssueKeys = async (
    db: TasksDb,
    orgId: number | null,
    projectKeys: string[],
    taskNumbers: number[],
) => (await db.query(
    `SELECT p.key AS project_key, t.task_number, t.id
       FROM tasks t
       JOIN projects p ON p.id = t.project_id
      WHERE p.org_id = $1
        AND (p.key, t.task_number) IN (
            SELECT UNNEST($2::text[]), UNNEST($3::int[])
        )`, [orgId, projectKeys, taskNumbers],
)).rows;
/** An active project in the caller's org, or none. */
export const findActiveProject = async (db: TasksDb, projectId: number, orgId: number | null) =>
    (await db.query(
        "SELECT id FROM projects WHERE id = $1 AND org_id = $2 AND is_archived = FALSE",
        [projectId, orgId],
    )).rows[0] ?? null;
