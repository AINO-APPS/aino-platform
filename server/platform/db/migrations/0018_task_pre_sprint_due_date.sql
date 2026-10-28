-- Remember a ticket's own due date while it sits in a sprint.
--
-- Joining a sprint overwrites `due_date` with the sprint's end date. Dated,
-- unsprinted tickets live in Scheduled, so without this column every ticket
-- that ever left a sprint would land in Scheduled at the old sprint's end
-- instead of returning to where it came from. Leaving a sprint restores the
-- remembered value (NULL sends the ticket back to the Backlog).
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS pre_sprint_due_date DATE;
