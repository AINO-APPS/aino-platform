-- Expand only: the legacy placement columns and routes remain until Contract.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_date DATE;

-- A one-time data marker, separate from the migration runner's ledger, also
-- protects a direct SQL replay after somebody deliberately clears a date.
CREATE TABLE IF NOT EXISTS _data_backfills (name TEXT PRIMARY KEY);
DO $$
BEGIN
    INSERT INTO _data_backfills (name) VALUES ('0029_tasks_start_date')
    ON CONFLICT (name) DO NOTHING;
    IF FOUND THEN
        UPDATE tasks SET start_date = planned_date
        WHERE start_date IS NULL AND planned_date IS NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_user_start ON tasks(user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_start ON tasks(assigned_to, start_date);
CREATE INDEX IF NOT EXISTS idx_tasks_start ON tasks(start_date) WHERE start_date IS NOT NULL;
