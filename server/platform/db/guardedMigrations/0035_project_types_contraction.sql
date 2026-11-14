DO $$
BEGIN
    IF current_setting('aino.project_types_contraction', TRUE) IS DISTINCT FROM 'ready' THEN
        RAISE EXCEPTION 'Project-types contraction requires the guarded runner';
    END IF;
    IF to_regclass('public.organizations') IS NULL THEN
        RAISE EXCEPTION 'Project ownership inventory is unavailable';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM organizations) THEN
        RAISE EXCEPTION 'Project ownership inventory is empty';
    END IF;
    IF EXISTS (
        SELECT 1 FROM organizations
        WHERE project_ownership IS NOT TRUE OR project_ownership_switched_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Every organization must be switched to project ownership';
    END IF;
    IF EXISTS (
        SELECT 1 FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        WHERE p.id IS NULL OR p.org_id IS DISTINCT FROM t.org_id
    ) OR EXISTS (
        SELECT 1 FROM sprints s LEFT JOIN projects p ON p.id = s.project_id
        WHERE p.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Project-owned data is incomplete';
    END IF;
    IF EXISTS (
        SELECT 1 FROM task_timers t
        LEFT JOIN task_worklogs w ON w.source_timer_id = t.id
        WHERE w.id IS NULL
    ) THEN
        RAISE EXCEPTION 'Timer history has not been migrated to worklogs';
    END IF;
END $$;

CREATE OR REPLACE FUNCTION fill_task_project_and_key()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    resolved_project_id INTEGER;
    resolved_key TEXT;
    allocated_number INTEGER;
BEGIN
    SELECT COALESCE(NEW.org_id, u.org_id) INTO NEW.org_id FROM users u WHERE u.id = NEW.user_id;
    resolved_project_id := NEW.project_id;
    IF resolved_project_id IS NULL AND NEW.sprint_id IS NOT NULL THEN
        SELECT project_id INTO resolved_project_id FROM sprints WHERE id = NEW.sprint_id;
    END IF;
    IF resolved_project_id IS NULL THEN
        SELECT id INTO resolved_project_id FROM projects
         WHERE org_id = NEW.org_id AND is_general ORDER BY id LIMIT 1;
    END IF;
    IF resolved_project_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM projects WHERE id = resolved_project_id AND org_id = NEW.org_id
    ) THEN
        RAISE EXCEPTION 'A project in the ticket organization is required';
    END IF;
    NEW.project_id := resolved_project_id;
    IF NEW.task_number IS NULL THEN
        UPDATE projects SET next_task_number = next_task_number + 1, updated_at = NOW()
         WHERE id = resolved_project_id RETURNING next_task_number - 1 INTO allocated_number;
        NEW.task_number := allocated_number;
    END IF;
    IF NEW.ticket_key IS NULL THEN
        SELECT key INTO resolved_key FROM projects WHERE id = resolved_project_id;
        NEW.ticket_key := resolved_key || '-' || NEW.task_number;
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS sprints_fill_project ON sprints;
DROP FUNCTION IF EXISTS fill_sprint_project();

ALTER TABLE tasks ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE sprints ALTER COLUMN project_id SET NOT NULL;
DROP TABLE IF EXISTS task_timers;
ALTER TABLE tasks
    DROP COLUMN IF EXISTS planned_date,
    DROP COLUMN IF EXISTS pre_sprint_due_date,
    DROP COLUMN IF EXISTS team_id,
    DROP COLUMN IF EXISTS logged_minutes,
    DROP COLUMN IF EXISTS estimated_minutes;
ALTER TABLE sprints
    DROP COLUMN IF EXISTS team_id,
    DROP COLUMN IF EXISTS auto_managed,
    DROP COLUMN IF EXISTS sprint_number,
    DROP COLUMN IF EXISTS is_auto;
ALTER TABLE teams
    DROP COLUMN IF EXISTS sprint_duration_weeks,
    DROP COLUMN IF EXISTS sprint_start_date,
    DROP COLUMN IF EXISTS sprint_mode,
    DROP COLUMN IF EXISTS sprint_paused;
ALTER TABLE organizations
    DROP COLUMN IF EXISTS project_ownership_switched_at,
    DROP COLUMN IF EXISTS project_ownership;
