-- Scrum dates are independent fields: remove the old sprint-end due-date
-- coupling, retire auto-managed sprint windows and convert all-auto projects.
CREATE TABLE IF NOT EXISTS _data_backfills (name TEXT PRIMARY KEY);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM _data_backfills WHERE name = '0032_project_types_scrum_planning'
    ) THEN
        INSERT INTO _data_backfills (name) VALUES ('0032_project_types_scrum_planning');

        CREATE TEMP TABLE project_types_0032_auto_only_projects ON COMMIT DROP AS
        SELECT p.id
          FROM projects p
         WHERE p.type = 'scrum'
           AND EXISTS (
               SELECT 1 FROM sprints s
                WHERE s.project_id = p.id AND s.auto_managed = TRUE
           )
           AND NOT EXISTS (
               SELECT 1 FROM sprints s
                WHERE s.project_id = p.id AND s.auto_managed = FALSE
           );

        INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        SELECT t.id, t.user_id, 'updated', 'due_date', t.due_date::text, t.pre_sprint_due_date::text
          FROM tasks t
          JOIN sprints s ON s.id = t.sprint_id
         WHERE t.due_date = s.end_date::date;

        UPDATE tasks t
           SET due_date = t.pre_sprint_due_date,
               pre_sprint_due_date = NULL
          FROM sprints s
         WHERE s.id = t.sprint_id
           AND t.due_date = s.end_date::date;

        UPDATE tasks
           SET pre_sprint_due_date = NULL
         WHERE pre_sprint_due_date IS NOT NULL;

        CREATE TEMP TABLE project_types_0032_auto_sprint_moves ON COMMIT DROP AS
        WITH active_auto_sprint_tasks AS (
            SELECT t.id, t.parent_task_id, t.sprint_id, s.name AS sprint_name,
                   COALESCE(ws.category, '') AS category,
                   COALESCE(w.key = 'subtask', FALSE) AS is_subtask
              FROM tasks t
              JOIN sprints s ON s.id = t.sprint_id
              LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
              LEFT JOIN work_item_types w ON w.id = t.work_item_type_id
             WHERE s.auto_managed = TRUE
               AND s.status IN ('active', 'paused')
        ), roots_to_backlog AS (
            SELECT t.*
              FROM active_auto_sprint_tasks t
             WHERE t.category <> 'done'
                OR (
                    NOT t.is_subtask
                    AND EXISTS (
                        SELECT 1
                          FROM active_auto_sprint_tasks child
                         WHERE child.parent_task_id = t.id
                           AND child.sprint_id = t.sprint_id
                           AND child.is_subtask
                           AND child.category <> 'done'
                    )
                )
        ), move_set AS (
            SELECT id, sprint_id, sprint_name FROM roots_to_backlog
            UNION
            SELECT child.id, child.sprint_id, child.sprint_name
              FROM active_auto_sprint_tasks child
              JOIN roots_to_backlog parent
                ON child.parent_task_id = parent.id
               AND child.sprint_id = parent.sprint_id
             WHERE child.is_subtask
        )
        SELECT DISTINCT id, sprint_id, sprint_name FROM move_set;

        INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        SELECT t.id, t.user_id, 'updated', 'sprint', m.sprint_name, 'none'
          FROM tasks t
          JOIN project_types_0032_auto_sprint_moves m ON m.id = t.id;

        UPDATE tasks t
           SET sprint_id = NULL
          FROM project_types_0032_auto_sprint_moves m
         WHERE m.id = t.id;

        INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        SELECT t.id, t.user_id, 'updated', 'sprint', s.name, 'none'
          FROM tasks t
          JOIN sprints s ON s.id = t.sprint_id
         WHERE s.auto_managed = TRUE
           AND s.status = 'planned';

        UPDATE tasks t
           SET sprint_id = NULL
          FROM sprints s
         WHERE s.id = t.sprint_id
           AND s.auto_managed = TRUE
           AND s.status = 'planned';

        UPDATE sprints
           SET status = 'completed',
               completed_at = COALESCE(completed_at, NOW()),
               paused_at = NULL
         WHERE auto_managed = TRUE
           AND status IN ('active', 'paused');

        DELETE FROM sprints
         WHERE auto_managed = TRUE
           AND status = 'planned';

        UPDATE projects p
           SET type = 'kanban',
               kanban_backlog_enabled = FALSE,
               updated_at = NOW()
          FROM project_types_0032_auto_only_projects a
         WHERE p.id = a.id;

        UPDATE teams
           SET sprint_mode = 'manual',
               sprint_paused = FALSE
         WHERE sprint_mode = 'auto' OR sprint_paused = TRUE;
    END IF;
END $$;
