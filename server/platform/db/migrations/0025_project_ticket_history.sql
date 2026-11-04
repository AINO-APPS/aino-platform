ALTER TABLE projects ADD COLUMN IF NOT EXISTS has_had_tickets BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE projects p SET has_had_tickets = TRUE
WHERE next_task_number > 1
   OR EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = p.id)
   OR EXISTS (SELECT 1 FROM ticket_key_aliases a WHERE a.project_id = p.id);

CREATE OR REPLACE FUNCTION remember_project_ticket_history() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.project_id IS NOT NULL THEN
        UPDATE projects SET has_had_tickets = TRUE WHERE id = NEW.project_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_remember_project_history ON tasks;
CREATE TRIGGER tasks_remember_project_history
BEFORE INSERT OR UPDATE OF project_id ON tasks
FOR EACH ROW EXECUTE FUNCTION remember_project_ticket_history();
