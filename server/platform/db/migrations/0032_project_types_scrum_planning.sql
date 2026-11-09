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

        INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
        SELECT t.id, t.user_id, 'updated', 'sprint', s.name, 'none'
          FROM tasks t
          JOIN sprints s ON s.id = t.sprint_id
         WHERE s.auto_managed = TRUE
           AND s.status IN ('active', 'paused')
           AND NOT EXISTS (
               SELECT 1 FROM workflow_states ws
                WHERE ws.id = t.workflow_state_id AND ws.category = 'done'
           );

        UPDATE tasks t
           SET sprint_id = NULL
          FROM sprints s
         WHERE s.id = t.sprint_id
           AND s.auto_managed = TRUE
           AND s.status IN ('active', 'paused')
           AND NOT EXISTS (
               SELECT 1 FROM workflow_states ws
                WHERE ws.id = t.workflow_state_id AND ws.category = 'done'
           );

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
