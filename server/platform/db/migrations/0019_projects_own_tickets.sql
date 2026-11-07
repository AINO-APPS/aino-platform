-- Expand tenant storage for project-owned tickets. Team ownership remains the
-- active policy; the flag is intentionally default-off.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS project_ownership BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS service_desk_project_id INTEGER;
ALTER TABLE organizations ALTER COLUMN project_ownership SET DEFAULT FALSE;

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'task_list',
    ADD COLUMN IF NOT EXISTS origin_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS key_published BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS is_general BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ticket_key TEXT;
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT;

CREATE TABLE IF NOT EXISTS project_members (
    id          SERIAL PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
    team_id     INTEGER REFERENCES teams(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('project_admin', 'member', 'viewer')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((user_id IS NULL) <> (team_id IS NULL)),
    UNIQUE (project_id, user_id),
    UNIQUE (project_id, team_id)
);

CREATE TABLE IF NOT EXISTS ticket_key_aliases (
    id                SERIAL PRIMARY KEY,
    org_id            INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key               TEXT NOT NULL,
    task_id           INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    project_id        INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    reason            TEXT NOT NULL CHECK (reason IN ('migration', 'move', 'rename')),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, key)
);

CREATE TABLE IF NOT EXISTS reserved_project_keys (
    org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key          TEXT NOT NULL,
    reason       TEXT NOT NULL DEFAULT 'project',
    reserved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, key)
);

CREATE TABLE IF NOT EXISTS project_migration_moves (
    task_id           INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    sprint_id         INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
    from_project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    to_project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    old_key           TEXT,
    new_key           TEXT NOT NULL,
    moved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $do$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'projects_type_check' AND conrelid = 'projects'::regclass
    ) THEN
        ALTER TABLE projects
            ADD CONSTRAINT projects_type_check CHECK (type IN ('scrum', 'kanban', 'task_list'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'organizations_service_desk_project_id_fkey'
           AND conrelid = 'organizations'::regclass
    ) THEN
        ALTER TABLE organizations
            ADD CONSTRAINT organizations_service_desk_project_id_fkey
            FOREIGN KEY (service_desk_project_id) REFERENCES projects(id) ON DELETE SET NULL;
    END IF;
END
$do$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_org_origin_team
    ON projects (org_id, origin_team_id) WHERE origin_team_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_org_general
    ON projects (org_id) WHERE is_general = TRUE;
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_members_team ON project_members (team_id) WHERE team_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ticket_key_alias_task ON ticket_key_aliases (task_id) WHERE task_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_org_ticket_key
    ON tasks (org_id, ticket_key) WHERE ticket_key IS NOT NULL;

-- Existing project keys are already public. Reserve them before generating
-- any new project keys so a team-derived key cannot take a live key.
INSERT INTO reserved_project_keys (org_id, key, reason)
SELECT org_id, key, 'project'
  FROM projects
ON CONFLICT (org_id, key) DO NOTHING;

-- One unpublished project per team. Normalize names to a Jira-safe key and
-- append the first free numeric suffix when a key collides.
DO $do$
DECLARE
    team_row RECORD;
    base_key TEXT;
    candidate TEXT;
    suffix INTEGER;
BEGIN
    FOR team_row IN
        SELECT id, org_id, name, lead_id
          FROM teams
         ORDER BY org_id, id
    LOOP
        IF EXISTS (
            SELECT 1 FROM projects
             WHERE org_id = team_row.org_id AND origin_team_id = team_row.id
        ) THEN
            CONTINUE;
        END IF;

        base_key := regexp_replace(upper(COALESCE(team_row.name, 'TEAM')), '[^A-Z0-9]', '', 'g');
        IF base_key = '' THEN base_key := 'TEAM'; END IF;
        IF base_key !~ '^[A-Z]' THEN base_key := 'T' || base_key; END IF;
        IF length(base_key) = 1 THEN base_key := base_key || 'T'; END IF;
        base_key := left(base_key, 10);
        candidate := base_key;
        suffix := 0;
        LOOP
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM projects
                 WHERE org_id = team_row.org_id AND key = candidate
                UNION ALL
                SELECT 1 FROM reserved_project_keys
                 WHERE org_id = team_row.org_id AND key = candidate
            );
            suffix := suffix + 1;
            candidate := left(base_key, 10 - length(suffix::TEXT)) || suffix::TEXT;
        END LOOP;

        INSERT INTO projects
            (org_id, key, name, type, lead_user_id, origin_team_id, key_published, is_general)
        VALUES
            (team_row.org_id, candidate, team_row.name, 'task_list', team_row.lead_id,
             team_row.id, FALSE, FALSE);
        INSERT INTO reserved_project_keys (org_id, key, reason)
        VALUES (team_row.org_id, candidate, 'generated')
        ON CONFLICT (org_id, key) DO NOTHING;
    END LOOP;
END
$do$;

-- Every org has a General project. It is also created for orgs added after
-- this migration by the organization trigger below.
DO $do$
DECLARE
    org_row RECORD;
    candidate TEXT;
    suffix INTEGER;
BEGIN
    FOR org_row IN SELECT id FROM organizations ORDER BY id LOOP
        IF EXISTS (SELECT 1 FROM projects WHERE org_id = org_row.id AND is_general) THEN
            CONTINUE;
        END IF;
        candidate := 'GEN';
        suffix := 0;
        LOOP
            EXIT WHEN NOT EXISTS (
                SELECT 1 FROM projects
                 WHERE org_id = org_row.id AND key = candidate
                UNION ALL
                SELECT 1 FROM reserved_project_keys
                 WHERE org_id = org_row.id AND key = candidate
            );
            suffix := suffix + 1;
            candidate := 'GEN' || suffix::TEXT;
        END LOOP;
        INSERT INTO projects (org_id, key, name, type, key_published, is_general)
        VALUES (org_row.id, candidate, 'General', 'task_list', FALSE, TRUE);
        INSERT INTO reserved_project_keys (org_id, key, reason)
        VALUES (org_row.id, candidate, 'generated')
        ON CONFLICT (org_id, key) DO NOTHING;
    END LOOP;
END
$do$;

-- Projects that predate the generated team projects keep their keys and are
-- marked published. A project with any sprint-owned ticket is Scrum.
UPDATE projects p
   SET type = CASE WHEN p.type = 'task_list' AND EXISTS (
           SELECT 1 FROM tasks t WHERE t.project_id = p.id AND t.sprint_id IS NOT NULL
       ) THEN 'scrum' ELSE p.type END
 WHERE p.origin_team_id IS NULL AND p.is_general = FALSE;

UPDATE projects p
   SET type = CASE WHEN p.type = 'task_list' AND EXISTS (
           SELECT 1 FROM sprints s WHERE s.team_id = p.origin_team_id
       ) THEN 'scrum' ELSE p.type END
 WHERE p.origin_team_id IS NOT NULL;

-- Resolve a tenant for legacy rows whose org_id was not populated.
UPDATE tasks t
   SET org_id = u.org_id
  FROM users u
 WHERE t.user_id = u.id AND t.org_id IS NULL AND u.org_id IS NOT NULL;
UPDATE tasks t
   SET org_id = tm.org_id
  FROM teams tm
 WHERE t.team_id = tm.id AND t.org_id IS NULL;
UPDATE tasks t
   SET org_id = (SELECT id FROM organizations ORDER BY id LIMIT 1)
 WHERE t.org_id IS NULL
   AND EXISTS (SELECT 1 FROM organizations);

-- First assign unprojected tickets to their team project or General, so sprint
-- destination can be chosen from the complete existing project distribution.
UPDATE tasks t
   SET project_id = COALESCE(
       (SELECT p.id FROM projects p
         WHERE p.org_id = t.org_id AND p.origin_team_id = t.team_id),
       (SELECT p.id FROM projects p
         WHERE p.org_id = t.org_id AND p.is_general),
       (SELECT p.id FROM projects p WHERE p.is_general ORDER BY p.id LIMIT 1)
   )
 WHERE t.project_id IS NULL;

-- Initialize missing ticket numbers without changing existing numbers.
UPDATE projects p
   SET next_task_number = GREATEST(
       p.next_task_number,
       COALESCE((SELECT MAX(t.task_number) + 1 FROM tasks t WHERE t.project_id = p.id), 1)
   );

DO $do$
DECLARE
    task_row RECORD;
    next_number INTEGER;
BEGIN
    FOR task_row IN
        SELECT id, project_id
          FROM tasks
         WHERE task_number IS NULL
         ORDER BY created_at NULLS FIRST, id
    LOOP
        UPDATE projects
           SET next_task_number = next_task_number + 1, updated_at = NOW()
         WHERE id = task_row.project_id
         RETURNING next_task_number - 1 INTO next_number;
        UPDATE tasks SET task_number = next_number WHERE id = task_row.id;
    END LOOP;
END
$do$;

UPDATE tasks t
   SET ticket_key = p.key || '-' || t.task_number
  FROM projects p
 WHERE p.id = t.project_id AND t.ticket_key IS NULL;

-- Sprint project is the project holding the most sprint tickets. Ties and
-- empty sprints fall back to their team's generated project, then General.
UPDATE sprints s
   SET project_id = COALESCE(
       (WITH project_counts AS (
            SELECT t.project_id, COUNT(*) AS ticket_count
              FROM tasks t
             WHERE t.sprint_id = s.id AND t.project_id IS NOT NULL
             GROUP BY t.project_id
        ), ranked_projects AS (
            SELECT project_id,
                   RANK() OVER (ORDER BY ticket_count DESC) AS position,
                   COUNT(*) OVER (PARTITION BY ticket_count) AS tie_count
              FROM project_counts
        )
        SELECT project_id FROM ranked_projects
         WHERE position = 1 AND tie_count = 1
         LIMIT 1),
       (SELECT p.id
          FROM projects p
         WHERE p.origin_team_id = s.team_id
         ORDER BY p.id
         LIMIT 1),
       (SELECT p.id
          FROM projects p
          JOIN teams tm ON tm.org_id = p.org_id
         WHERE tm.id = s.team_id AND p.is_general
         LIMIT 1),
       (SELECT p.id FROM projects p WHERE p.is_general ORDER BY p.id LIMIT 1)
   )
 WHERE s.project_id IS NULL;

-- Tickets that disagree with the sprint's majority move into the sprint
-- project. Their previous keys remain resolvable as migration aliases.
DO $do$
DECLARE
    move_row RECORD;
    next_number INTEGER;
    new_key TEXT;
BEGIN
    FOR move_row IN
        SELECT t.id, t.org_id, t.project_id AS old_project_id, s.project_id AS new_project_id,
               t.sprint_id, t.ticket_key AS old_key, p.key AS new_project_key
          FROM tasks t
          JOIN sprints s ON s.id = t.sprint_id
          JOIN projects p ON p.id = s.project_id
         WHERE t.project_id IS DISTINCT FROM s.project_id
         ORDER BY t.created_at NULLS FIRST, t.id
    LOOP
        UPDATE projects
           SET next_task_number = GREATEST(
                   next_task_number,
                   COALESCE((SELECT MAX(task_number) + 1 FROM tasks WHERE project_id = move_row.new_project_id), 1)
               ) + 1,
               updated_at = NOW()
         WHERE id = move_row.new_project_id
         RETURNING next_task_number - 1 INTO next_number;
        new_key := move_row.new_project_key || '-' || next_number;

        INSERT INTO ticket_key_aliases (org_id, key, task_id, project_id, reason)
        VALUES (move_row.org_id, move_row.old_key, move_row.id, move_row.old_project_id, 'migration')
        ON CONFLICT (org_id, key) DO NOTHING;

        UPDATE tasks
           SET project_id = move_row.new_project_id,
               task_number = next_number,
               ticket_key = new_key
         WHERE id = move_row.id;

        INSERT INTO project_migration_moves
            (task_id, sprint_id, from_project_id, to_project_id, old_key, new_key)
        VALUES
            (move_row.id, move_row.sprint_id, move_row.old_project_id, move_row.new_project_id,
             move_row.old_key, new_key)
        ON CONFLICT (task_id) DO NOTHING;
    END LOOP;
END
$do$;

-- Counters must always point past every number in their project.
UPDATE projects p
   SET next_task_number = GREATEST(
       p.next_task_number,
       COALESCE((SELECT MAX(t.task_number) + 1 FROM tasks t WHERE t.project_id = p.id), 1)
   );

-- Grant each team access to its generated project, project leads admin access,
-- and teams that owned tickets member access to their existing projects.
INSERT INTO project_members (project_id, team_id, role)
SELECT p.id, p.origin_team_id, 'member'
  FROM projects p
 WHERE p.origin_team_id IS NOT NULL
ON CONFLICT (project_id, team_id) DO NOTHING;

INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, p.lead_user_id, 'project_admin'
  FROM projects p
 WHERE p.lead_user_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'project_admin';

INSERT INTO project_members (project_id, team_id, role)
SELECT DISTINCT t.project_id, t.team_id, 'member'
  FROM tasks t
 WHERE t.project_id IS NOT NULL AND t.team_id IS NOT NULL
ON CONFLICT (project_id, team_id) DO NOTHING;

INSERT INTO project_members (project_id, user_id, role)
SELECT p.id, tm.lead_id, 'project_admin'
  FROM projects p
  JOIN teams tm ON tm.id = p.origin_team_id
 WHERE tm.lead_id IS NOT NULL
ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'project_admin';

-- Enforce exact-one-project and stored-key invariants after the backfill.
DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM tasks WHERE project_id IS NULL OR ticket_key IS NULL) THEN
        RAISE EXCEPTION 'projects own tickets migration left a ticket without project_id or ticket_key';
    END IF;
    IF EXISTS (SELECT 1 FROM sprints WHERE project_id IS NULL) THEN
        RAISE EXCEPTION 'projects own tickets migration left a sprint without project_id';
    END IF;
END
$do$;

ALTER TABLE tasks ALTER COLUMN project_id SET NOT NULL;
ALTER TABLE tasks ALTER COLUMN ticket_key SET NOT NULL;
ALTER TABLE sprints ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_project_id_fkey;
ALTER TABLE tasks
    ADD CONSTRAINT tasks_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE sprints DROP CONSTRAINT IF EXISTS sprints_project_id_fkey;
ALTER TABLE sprints
    ADD CONSTRAINT sprints_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS uq_tasks_org_ticket_key;
CREATE UNIQUE INDEX uq_tasks_org_ticket_key
    ON tasks (org_id, ticket_key);

-- Keep newly-created orgs consistent on tenants that were provisioned before
-- this migration ran, as well as fresh tenant databases.
CREATE OR REPLACE FUNCTION create_general_project_for_org()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    candidate TEXT := 'GEN';
    suffix INTEGER := 0;
BEGIN
    LOOP
        EXIT WHEN NOT EXISTS (
            SELECT 1 FROM projects WHERE org_id = NEW.id AND key = candidate
            UNION ALL
            SELECT 1 FROM reserved_project_keys WHERE org_id = NEW.id AND key = candidate
        );
        suffix := suffix + 1;
        candidate := 'GEN' || suffix::TEXT;
    END LOOP;
    INSERT INTO projects (org_id, key, name, type, key_published, is_general)
    VALUES (NEW.id, candidate, 'General', 'task_list', FALSE, TRUE)
    ON CONFLICT DO NOTHING;
    INSERT INTO reserved_project_keys (org_id, key, reason)
    VALUES (NEW.id, candidate, 'generated')
    ON CONFLICT (org_id, key) DO NOTHING;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS organizations_create_general_project ON organizations;
CREATE TRIGGER organizations_create_general_project
    AFTER INSERT ON organizations
    FOR EACH ROW EXECUTE FUNCTION create_general_project_for_org();

-- Compatibility writer for every legacy task insert path. Explicit project
-- wins, then sprint, team, and finally General; ownership checks remain in the
-- existing team policy while project_ownership is off.
CREATE OR REPLACE FUNCTION fill_task_project_and_key()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    resolved_org_id INTEGER;
    resolved_project_id INTEGER;
    resolved_key TEXT;
    allocated_number INTEGER;
BEGIN
    SELECT COALESCE(NEW.org_id, u.org_id)
      INTO resolved_org_id
      FROM users u
     WHERE u.id = NEW.user_id;
    NEW.org_id := COALESCE(NEW.org_id, resolved_org_id);

    resolved_project_id := NEW.project_id;
    IF resolved_project_id IS NULL AND NEW.sprint_id IS NOT NULL THEN
        SELECT project_id INTO resolved_project_id FROM sprints WHERE id = NEW.sprint_id;
    END IF;
    IF resolved_project_id IS NULL AND NEW.team_id IS NOT NULL THEN
        SELECT id INTO resolved_project_id
          FROM projects
         WHERE org_id = NEW.org_id AND origin_team_id = NEW.team_id;
    END IF;
    IF resolved_project_id IS NULL THEN
        SELECT id INTO resolved_project_id
          FROM projects
         WHERE org_id = NEW.org_id AND is_general
         ORDER BY id LIMIT 1;
    END IF;
    IF resolved_project_id IS NULL THEN
        RAISE EXCEPTION 'No project or General project exists for organization %', NEW.org_id;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM projects WHERE id = resolved_project_id AND org_id = NEW.org_id
    ) THEN
        RAISE EXCEPTION 'Project % does not belong to organization %', resolved_project_id, NEW.org_id;
    END IF;
    NEW.project_id := resolved_project_id;

    IF NEW.task_number IS NULL THEN
        UPDATE projects
           SET next_task_number = next_task_number + 1, updated_at = NOW()
         WHERE id = resolved_project_id
         RETURNING next_task_number - 1 INTO allocated_number;
        NEW.task_number := allocated_number;
    END IF;
    IF NEW.ticket_key IS NULL THEN
        SELECT key INTO resolved_key FROM projects WHERE id = resolved_project_id;
        NEW.ticket_key := resolved_key || '-' || NEW.task_number;
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tasks_fill_project_and_key ON tasks;
CREATE TRIGGER tasks_fill_project_and_key
    BEFORE INSERT ON tasks
    FOR EACH ROW EXECUTE FUNCTION fill_task_project_and_key();

CREATE OR REPLACE FUNCTION fill_sprint_project()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
DECLARE
    resolved_org_id INTEGER;
BEGIN
    IF NEW.project_id IS NOT NULL THEN RETURN NEW; END IF;
    SELECT org_id INTO resolved_org_id FROM teams WHERE id = NEW.team_id;
    SELECT id INTO NEW.project_id
      FROM projects
     WHERE org_id = resolved_org_id AND origin_team_id = NEW.team_id;
    IF NEW.project_id IS NULL THEN
        SELECT id INTO NEW.project_id
          FROM projects
         WHERE org_id = resolved_org_id AND is_general
         ORDER BY id LIMIT 1;
    END IF;
    IF NEW.project_id IS NULL THEN
        SELECT id INTO NEW.project_id
          FROM projects WHERE is_general ORDER BY id LIMIT 1;
    END IF;
    IF NEW.project_id IS NULL THEN
        RAISE EXCEPTION 'No project or General project exists for sprint';
    END IF;
    RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS sprints_fill_project ON sprints;
CREATE TRIGGER sprints_fill_project
    BEFORE INSERT ON sprints
    FOR EACH ROW EXECUTE FUNCTION fill_sprint_project();
