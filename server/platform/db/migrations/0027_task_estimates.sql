-- Rename the legacy plan once. Retry must not overwrite a re-forecast or a cleared estimate.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
        AND table_name = 'tasks' AND column_name = 'estimated_minutes') THEN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
            AND table_name = 'tasks' AND column_name = 'original_estimate_minutes') THEN
            UPDATE tasks SET original_estimate_minutes = COALESCE(original_estimate_minutes, estimated_minutes);
            ALTER TABLE tasks DROP COLUMN estimated_minutes;
        ELSE
            ALTER TABLE tasks RENAME COLUMN estimated_minutes TO original_estimate_minutes;
        END IF;
        ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remaining_estimate_minutes INTEGER;
        UPDATE tasks t SET remaining_estimate_minutes = GREATEST(original_estimate_minutes -
            COALESCE((SELECT SUM(w.minutes) FROM task_worklogs w WHERE w.task_id = t.id AND w.deleted_at IS NULL), 0), 0)
            WHERE original_estimate_minutes IS NOT NULL;
    END IF;
END $$;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS original_estimate_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS remaining_estimate_minutes INTEGER;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_original_estimate_nonnegative') THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_original_estimate_nonnegative CHECK (original_estimate_minutes >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'tasks'::regclass AND conname = 'tasks_remaining_estimate_nonnegative') THEN
        ALTER TABLE tasks ADD CONSTRAINT tasks_remaining_estimate_nonnegative CHECK (remaining_estimate_minutes >= 0);
    END IF;
END $$;
