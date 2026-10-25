-- Expand the task schema before clients move off the legacy columns.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS planned_date DATE;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rank TEXT;

DO $do$
DECLARE
    invalid_value RECORD;
BEGIN
    FOR invalid_value IN
        SELECT id, date AS value, 'date' AS column_name
          FROM tasks
         WHERE date IS NOT NULL AND date <> ''
        UNION ALL
        SELECT id, due_date::TEXT AS value, 'due_date' AS column_name
          FROM tasks
         WHERE due_date IS NOT NULL AND due_date::TEXT <> ''
    LOOP
        BEGIN
            PERFORM invalid_value.value::DATE;
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Task % has invalid legacy % value "%"', invalid_value.id, invalid_value.column_name, invalid_value.value;
        END;
    END LOOP;
END
$do$;

UPDATE tasks
   SET planned_date = NULLIF(date, '')::DATE
 WHERE planned_date IS NULL
   AND date IS NOT NULL
   AND date <> '';

DO $do$
DECLARE
    due_date_type TEXT;
BEGIN
    SELECT data_type
      INTO due_date_type
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = 'tasks'
       AND column_name = 'due_date';

    IF due_date_type <> 'date' THEN
        ALTER TABLE tasks
            ALTER COLUMN due_date TYPE DATE
            USING NULLIF(due_date, '')::DATE;
    END IF;
END
$do$;

UPDATE tasks t
   SET team_id = COALESCE(
       (SELECT s.team_id FROM sprints s WHERE s.id = t.sprint_id),
       (SELECT creator.team_id FROM users creator WHERE creator.id = t.user_id),
       (SELECT assignee.team_id FROM users assignee WHERE assignee.id = t.assigned_to)
   )
 WHERE t.team_id IS NULL
   AND COALESCE(
       (SELECT s.team_id FROM sprints s WHERE s.id = t.sprint_id),
       (SELECT creator.team_id FROM users creator WHERE creator.id = t.user_id),
       (SELECT assignee.team_id FROM users assignee WHERE assignee.id = t.assigned_to)
   ) IS NOT NULL;

DO $do$
DECLARE
    unmapped RECORD;
BEGIN
    SELECT t.id, t.status, COALESCE(t.org_id, creator.org_id) AS org_id
      INTO unmapped
      FROM tasks t
      JOIN users creator ON creator.id = t.user_id
      LEFT JOIN workflow_states ws
        ON ws.org_id = COALESCE(t.org_id, creator.org_id)
       AND ws.key = t.status
     WHERE ws.id IS NULL
        OR CASE t.status
               WHEN 'pending' THEN ws.category <> 'open'
               WHEN 'in_progress' THEN ws.category <> 'in_progress'
               WHEN 'in_review' THEN ws.category <> 'in_review'
               WHEN 'done' THEN ws.category <> 'done'
               ELSE FALSE
           END
     ORDER BY t.id
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Cannot map task % legacy status "%" to a matching workflow state for organization %',
            unmapped.id, unmapped.status, unmapped.org_id;
    END IF;
END
$do$;

UPDATE tasks t
   SET workflow_state_id = ws.id
  FROM users creator, workflow_states ws
 WHERE creator.id = t.user_id
   AND ws.org_id = COALESCE(t.org_id, creator.org_id)
   AND ws.key = t.status;

UPDATE tasks t
   SET completed_at = CASE
       WHEN ws.category = 'done' THEN COALESCE(t.completed_at, NOW())
       ELSE NULL
   END
  FROM workflow_states ws
 WHERE ws.id = t.workflow_state_id;

WITH ranked_tasks AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY COALESCE(org_id, 0), COALESCE(team_id, 0)
               ORDER BY created_at ASC NULLS FIRST, id ASC
           ) AS position
      FROM tasks
     WHERE rank IS NULL
)
UPDATE tasks t
   SET rank = '0|' || LPAD(TO_HEX(ranked_tasks.position), 16, '0') || ':'
  FROM ranked_tasks
 WHERE ranked_tasks.id = t.id;

DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'tasks_workflow_state_id_fkey'
           AND conrelid = 'tasks'::regclass
    ) THEN
        ALTER TABLE tasks
            ADD CONSTRAINT tasks_workflow_state_id_fkey
            FOREIGN KEY (workflow_state_id) REFERENCES workflow_states(id) ON DELETE SET NULL;
    END IF;
END
$do$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_org_team_rank
    ON tasks (COALESCE(org_id, 0), COALESCE(team_id, 0), rank)
    WHERE rank IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_team_rank
    ON tasks (team_id, rank)
    WHERE team_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sprint_baselines (
    id                  SERIAL PRIMARY KEY,
    sprint_id           INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    committed_points    NUMERIC(8,2) NOT NULL DEFAULT 0,
    committed_task_ids  JSONB NOT NULL DEFAULT '[]'::JSONB,
    captured_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reason              TEXT NOT NULL DEFAULT 'start'
                            CHECK (reason IN ('start', 'scope_add', 'scope_remove'))
);
CREATE INDEX IF NOT EXISTS idx_sprint_baselines_sprint_captured
    ON sprint_baselines (sprint_id, captured_at DESC, id DESC);

CREATE OR REPLACE FUNCTION set_task_completed_at_from_workflow_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    new_category TEXT;
    old_category TEXT;
BEGIN
    SELECT category
      INTO new_category
      FROM workflow_states
     WHERE id = NEW.workflow_state_id;

    IF TG_OP = 'UPDATE' THEN
        SELECT category
          INTO old_category
          FROM workflow_states
         WHERE id = OLD.workflow_state_id;
    END IF;

    IF new_category = 'done' THEN
        IF TG_OP = 'UPDATE' AND old_category = 'done' THEN
            NEW.completed_at := COALESCE(OLD.completed_at, NOW());
        ELSE
            NEW.completed_at := NOW();
        END IF;
    ELSE
        NEW.completed_at := NULL;
    END IF;

    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_tasks_completed_at_from_workflow_state ON tasks;
CREATE TRIGGER trg_tasks_completed_at_from_workflow_state
    BEFORE INSERT OR UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION set_task_completed_at_from_workflow_state();
