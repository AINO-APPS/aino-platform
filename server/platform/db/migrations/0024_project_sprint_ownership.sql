-- Sprint team_id is a compatibility hint; deleting a team must not delete work.
ALTER TABLE sprints ALTER COLUMN team_id DROP NOT NULL;
ALTER TABLE sprints DROP CONSTRAINT IF EXISTS sprints_team_id_fkey;
ALTER TABLE sprints ADD CONSTRAINT sprints_team_id_fkey
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_sprints_project_status ON sprints (project_id, status);
