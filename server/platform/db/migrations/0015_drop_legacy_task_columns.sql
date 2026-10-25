-- Contract step of the task-schema refactor (ticket 28).
--
-- After 0011 every task has a `workflow_state_id` and a `planned_date`, and no
-- client or server query reads the legacy columns any more. Drop them so there
-- is exactly one status (the workflow state, D4) and one planned date (D2).
--
-- `rank_value` was the parallel numeric order column; `rank` (LexoRank) replaced
-- it in 0011 and nothing ever read `rank_value`.
--
-- Every statement is guarded so the migration is safe on a tenant that was
-- created after the base schema stopped declaring these columns.

DO $do$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'tasks' AND column_name = 'date'
    ) THEN
        -- Belt and braces: 0011 already backfilled planned_date, but a tenant
        -- that skipped it (or wrote `date` directly afterwards) must not lose
        -- its planner day.
        EXECUTE $sql$
            UPDATE tasks
               SET planned_date = NULLIF(date, '')::DATE
             WHERE planned_date IS NULL
               AND date IS NOT NULL
               AND date <> ''
        $sql$;
        ALTER TABLE tasks DROP COLUMN date;
    END IF;
END
$do$;

DO $do$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'tasks' AND column_name = 'status'
    ) THEN
        -- Any task still without a workflow state is mapped from its legacy
        -- status key before the column disappears, so no task loses its
        -- category.
        EXECUTE $sql$
            UPDATE tasks t
               SET workflow_state_id = ws.id
              FROM workflow_states ws
             WHERE t.workflow_state_id IS NULL
               AND ws.org_id = t.org_id
               AND ws.key = t.status
        $sql$;
        ALTER TABLE tasks DROP COLUMN status;
    END IF;
END
$do$;

ALTER TABLE tasks DROP COLUMN IF EXISTS rank_value;

-- The planner-day indexes used to be keyed on the legacy `date` column.
CREATE INDEX IF NOT EXISTS idx_tasks_user_planned ON tasks(user_id, planned_date);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_planned ON tasks(assigned_to, planned_date);
CREATE INDEX IF NOT EXISTS idx_tasks_planned ON tasks(planned_date) WHERE planned_date IS NOT NULL;
