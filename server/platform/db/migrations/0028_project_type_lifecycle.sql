-- Project-type policy setting and lifecycle invariants for every sprint writer.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS kanban_backlog_enabled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION enforce_project_type_lifecycle() RETURNS trigger AS $$
BEGIN
    IF OLD.type = 'scrum' AND NEW.type <> 'scrum' AND EXISTS (
        SELECT 1 FROM sprints WHERE project_id = OLD.id AND status IN ('planned', 'active', 'paused')
    ) THEN
        RAISE EXCEPTION 'PROJECT_HAS_OPEN_SPRINTS' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_type_lifecycle ON projects;
CREATE TRIGGER project_type_lifecycle BEFORE UPDATE OF type ON projects
    FOR EACH ROW EXECUTE FUNCTION enforce_project_type_lifecycle();

CREATE OR REPLACE FUNCTION enforce_scrum_sprint_project() RETURNS trigger AS $$
DECLARE project_type TEXT;
BEGIN
    SELECT type INTO project_type FROM projects WHERE id = NEW.project_id FOR UPDATE;
    IF NEW.status IN ('planned', 'active', 'paused') AND project_type <> 'scrum' THEN
        RAISE EXCEPTION 'PROJECT_HAS_NO_SPRINTS' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS z_scrum_sprint_project ON sprints;
CREATE TRIGGER z_scrum_sprint_project BEFORE INSERT OR UPDATE OF project_id, status ON sprints
    FOR EACH ROW EXECUTE FUNCTION enforce_scrum_sprint_project();
