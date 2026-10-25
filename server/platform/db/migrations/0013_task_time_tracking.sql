-- Time tracking on tasks.
--
-- `estimated_minutes` is the plan; `logged_minutes` is the running total the
-- timer writes. Both are minutes so the existing timesheet can roll them up
-- without a unit conversion.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS logged_minutes INTEGER NOT NULL DEFAULT 0;
