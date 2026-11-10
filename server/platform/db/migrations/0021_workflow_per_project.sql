-- Move workflow editing and transition enforcement to each project while
-- retaining the org rows as the read-only template.
ALTER TABLE workflow_states ADD COLUMN IF NOT EXISTS project_id INTEGER;
ALTER TABLE workflow_transitions ADD COLUMN IF NOT EXISTS project_id INTEGER;
DO $do$ BEGIN
    ALTER TABLE workflow_states ADD CONSTRAINT workflow_states_project_fk
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
DO $do$ BEGIN
    ALTER TABLE workflow_transitions ADD CONSTRAINT workflow_transitions_project_fk
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

DO $do$
DECLARE constraint_name TEXT;
BEGIN
    FOR constraint_name IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class rel ON rel.oid = con.conrelid
          JOIN pg_attribute org_col ON org_col.attrelid = rel.oid
                                   AND org_col.attname = 'org_id'
                                   AND org_col.attnum = ANY(con.conkey)
          JOIN pg_attribute key_col ON key_col.attrelid = rel.oid
                                   AND key_col.attname = 'key'
                                   AND key_col.attnum = ANY(con.conkey)
         WHERE rel.relname = 'workflow_states'
           AND con.contype = 'u'
           AND cardinality(con.conkey) = 2
    LOOP
        EXECUTE format('ALTER TABLE workflow_states DROP CONSTRAINT %I', constraint_name);
    END LOOP;
END $do$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_states_template_key
    ON workflow_states (org_id, key) WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_states_project_key
    ON workflow_states (project_id, key) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workflow_states_project
    ON workflow_states (project_id, is_active, sort_order);
CREATE INDEX IF NOT EXISTS idx_workflow_transitions_project
    ON workflow_transitions (project_id);

-- A fresh tenant may have the Cancelled seed from migration 0017 but not have
-- run the post-migration Agile defaults seeder yet.
INSERT INTO workflow_states (org_id, key, name, category, color, sort_order, is_initial, is_terminal)
SELECT o.id, defaults.key, defaults.name, defaults.category, defaults.color,
       defaults.sort_order, defaults.is_initial, defaults.is_terminal
  FROM organizations o
 CROSS JOIN (VALUES
       ('pending', 'New', 'open', '#6b7280', 1, TRUE, FALSE),
       ('in_progress', 'In Progress', 'in_progress', '#f59e0b', 2, FALSE, FALSE),
       ('in_review', 'In Review', 'in_review', '#3b82f6', 3, FALSE, FALSE),
       ('done', 'Done', 'done', '#10b981', 4, FALSE, TRUE)
  ) AS defaults(key, name, category, color, sort_order, is_initial, is_terminal)
 WHERE NOT EXISTS (
       SELECT 1 FROM workflow_states existing
        WHERE existing.org_id = o.id AND existing.key <> 'cancelled'
  )
ON CONFLICT (org_id, key) WHERE project_id IS NULL DO NOTHING;

-- Copy state attributes exactly. The source rows remain in place as templates.
INSERT INTO workflow_states (
    org_id, project_id, key, name, category, color, icon, wip_limit,
    is_initial, is_terminal, is_active, sort_order, created_at
)
SELECT template.org_id, project.id, template.key, template.name, template.category, template.color, template.icon,
       template.wip_limit, template.is_initial, template.is_terminal, template.is_active, template.sort_order,
       template.created_at
  FROM projects project
  JOIN workflow_states template ON template.org_id = project.org_id AND template.project_id IS NULL
ON CONFLICT (project_id, key) WHERE project_id IS NOT NULL DO NOTHING;

-- Clone every explicit template edge using the project's copied state ids.
INSERT INTO workflow_transitions (org_id, project_id, from_state_id, to_state_id, required_role)
SELECT edge.org_id, project.id, from_copy.id, to_copy.id, edge.required_role
  FROM projects project
  JOIN workflow_transitions edge ON edge.org_id = project.org_id AND edge.project_id IS NULL
  JOIN workflow_states from_template ON from_template.id = edge.from_state_id AND from_template.project_id IS NULL
  JOIN workflow_states to_template ON to_template.id = edge.to_state_id AND to_template.project_id IS NULL
  JOIN workflow_states from_copy ON from_copy.project_id = project.id AND from_copy.key = from_template.key
  JOIN workflow_states to_copy ON to_copy.project_id = project.id AND to_copy.key = to_template.key
ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

-- Tickets retain their state name while changing the foreign key to the copy
-- owned by their project.
UPDATE tasks ticket
   SET workflow_state_id = project_state.id
  FROM workflow_states template
  JOIN workflow_states project_state
    ON project_state.project_id IS NOT NULL
   AND project_state.org_id = template.org_id
   AND project_state.key = template.key
 WHERE template.id = ticket.workflow_state_id
   AND template.project_id IS NULL
   AND project_state.project_id = ticket.project_id;

CREATE OR REPLACE FUNCTION copy_project_workflow_template() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO workflow_states (
        org_id, project_id, key, name, category, color, icon, wip_limit,
        is_initial, is_terminal, is_active, sort_order, created_at
    )
    SELECT template.org_id, NEW.id, template.key, template.name, template.category, template.color,
           template.icon, template.wip_limit, template.is_initial, template.is_terminal, template.is_active,
           template.sort_order, template.created_at
      FROM workflow_states template
     WHERE template.org_id = NEW.org_id AND template.project_id IS NULL
    ON CONFLICT (project_id, key) WHERE project_id IS NOT NULL DO NOTHING;

    INSERT INTO workflow_transitions (org_id, project_id, from_state_id, to_state_id, required_role)
    SELECT NEW.org_id, NEW.id, from_copy.id, to_copy.id, edge.required_role
      FROM workflow_transitions edge
      JOIN workflow_states from_template ON from_template.id = edge.from_state_id AND from_template.project_id IS NULL
      JOIN workflow_states to_template ON to_template.id = edge.to_state_id AND to_template.project_id IS NULL
      JOIN workflow_states from_copy ON from_copy.project_id = NEW.id AND from_copy.key = from_template.key
      JOIN workflow_states to_copy ON to_copy.project_id = NEW.id AND to_copy.key = to_template.key
     WHERE edge.org_id = NEW.org_id AND edge.project_id IS NULL
    ON CONFLICT (from_state_id, to_state_id) DO NOTHING;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_copy_workflow_template ON projects;
CREATE TRIGGER projects_copy_workflow_template
    AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION copy_project_workflow_template();
