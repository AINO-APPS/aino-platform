/** SQL ownership for the task domain. */
import type { GitRefInput, TasksDb } from "./tasks.types";

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
    `SELECT t.id, t.title, t.status, t.workflow_state_id, t.is_blocked,
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
    `SELECT t.id, t.title, t.status, t.workflow_state_id, t.is_blocked, t.story_points,
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