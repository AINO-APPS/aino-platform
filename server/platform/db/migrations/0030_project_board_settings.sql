-- Copy the old switch once. Replaying this expand migration must not undo a
-- project admin's later choice; new projects default to limits off.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'projects' AND column_name = 'enable_wip_limits'
    ) THEN
        ALTER TABLE projects ADD COLUMN enable_wip_limits BOOLEAN NOT NULL DEFAULT FALSE;
        UPDATE projects p SET enable_wip_limits = COALESCE(
            (SELECT s.enable_wip_limits FROM org_agile_settings s WHERE s.org_id = p.org_id), FALSE
        );
    END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_tasks_project_board
    ON tasks (project_id, workflow_state_id, completed_at);
