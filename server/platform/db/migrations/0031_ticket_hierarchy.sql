-- Expand only: retain all legacy placement and project-type columns.
ALTER TABLE work_item_types ADD COLUMN IF NOT EXISTS is_subtask BOOLEAN NOT NULL DEFAULT FALSE;

INSERT INTO work_item_types (org_id, key, name, icon, color, is_default, is_epic, is_subtask, sort_order)
SELECT id, 'subtask', 'Subtask', 'ListTodo', '#64748b', FALSE, FALSE, TRUE, 5 FROM organizations
ON CONFLICT (org_id, key) DO UPDATE SET is_subtask = TRUE, is_epic = FALSE, is_active = TRUE, is_default = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_item_types_one_subtask ON work_item_types (org_id) WHERE is_subtask;

CREATE TABLE IF NOT EXISTS task_hierarchy_repairs (
    task_id INTEGER PRIMARY KEY,
    org_id INTEGER,
    reason TEXT NOT NULL,
    before_value JSONB NOT NULL,
    after_value JSONB NOT NULL,
    repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- An invalid legacy Subtask cannot simply lose its mandatory parent. Convert
-- it to an ordinary Task instead, preserving its project, key and placement.
INSERT INTO work_item_types (org_id, key, name, is_epic, sort_order)
SELECT o.id, 'hierarchy_repair_task', 'Task', FALSE, 6 FROM organizations o
WHERE NOT EXISTS (
    SELECT 1 FROM work_item_types w WHERE w.org_id = o.id
    AND NOT w.is_epic AND NOT w.is_subtask AND w.is_active
)
ON CONFLICT (org_id, key) DO NOTHING;

CREATE TABLE IF NOT EXISTS _data_backfills (name TEXT PRIMARY KEY);
DO $$
BEGIN
    INSERT INTO _data_backfills (name) VALUES ('0031_ticket_hierarchy')
    ON CONFLICT (name) DO NOTHING;
    IF FOUND THEN
        WITH legacy AS (
            SELECT t.*, to_jsonb(t) AS before_value,
                COALESCE(w.is_epic, FALSE) AS epic, COALESCE(w.is_subtask, FALSE) AS subtask,
                p.id AS parent_id, p.sprint_id AS parent_sprint,
                (p.id IS NOT NULL AND p.id <> t.id AND p.org_id IS NOT DISTINCT FROM t.org_id) AS valid_parent,
                COALESCE(pw.is_epic, FALSE) AS parent_epic,
                (p.id IS NOT NULL AND p.id <> t.id AND p.org_id IS NOT DISTINCT FROM t.org_id
                    AND t.project_id IS NOT NULL AND p.project_id = t.project_id
                    AND NOT COALESCE(pw.is_epic, FALSE) AND NOT COALESCE(pw.is_subtask, FALSE)) AS valid_subtask,
                (SELECT wt.id FROM work_item_types wt WHERE wt.org_id = t.org_id
                    AND NOT wt.is_epic AND NOT wt.is_subtask AND wt.is_active
                    ORDER BY (wt.key = 'task') DESC, wt.is_default DESC, wt.id LIMIT 1) AS ordinary_type
            FROM tasks t
            LEFT JOIN work_item_types w ON w.id = t.work_item_type_id
            LEFT JOIN tasks p ON p.id = t.parent_task_id
            LEFT JOIN work_item_types pw ON pw.id = p.work_item_type_id
        ), desired AS (
            SELECT *,
                CASE WHEN epic OR subtask AND NOT valid_subtask
                    OR NOT subtask AND NOT (valid_parent AND parent_epic)
                    THEN NULL ELSE parent_task_id END AS new_parent,
                CASE WHEN subtask AND NOT valid_subtask THEN ordinary_type ELSE work_item_type_id END AS new_type,
                CASE WHEN subtask AND valid_subtask THEN parent_sprint ELSE sprint_id END AS new_sprint,
                CASE WHEN epic THEN 'Epic cannot have a parent'
                    WHEN subtask AND NOT valid_subtask THEN 'Invalid Subtask converted to Task; parent cleared'
                    WHEN subtask THEN 'Subtask sprint aligned with parent'
                    ELSE 'Story/Task/Bug may only have an epic parent in the same organization' END AS reason
            FROM legacy
        ), repairs AS (
            INSERT INTO task_hierarchy_repairs (task_id, org_id, reason, before_value, after_value)
            SELECT id, org_id, reason, before_value,
                before_value || jsonb_build_object('parent_task_id', new_parent,
                    'work_item_type_id', new_type, 'sprint_id', new_sprint)
            FROM desired
            WHERE parent_task_id IS DISTINCT FROM new_parent OR work_item_type_id IS DISTINCT FROM new_type
                OR sprint_id IS DISTINCT FROM new_sprint
            ON CONFLICT (task_id) DO NOTHING
            RETURNING *
        ), updated AS (
            UPDATE tasks t SET parent_task_id = (r.after_value->>'parent_task_id')::INTEGER,
                work_item_type_id = (r.after_value->>'work_item_type_id')::INTEGER,
                sprint_id = (r.after_value->>'sprint_id')::INTEGER
            FROM repairs r WHERE t.id = r.task_id RETURNING t.id
        )
        INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value, actor_type)
        SELECT r.task_id, NULL, 'updated', changes.field, changes.old_value, changes.new_value, 'system'
        FROM repairs r
        CROSS JOIN LATERAL (VALUES
            ('parent', r.before_value->>'parent_task_id', r.after_value->>'parent_task_id'),
            ('work_item_type', r.before_value->>'work_item_type_id', r.after_value->>'work_item_type_id'),
            ('sprint', r.before_value->>'sprint_id', r.after_value->>'sprint_id')
        ) changes(field, old_value, new_value)
        WHERE changes.old_value IS DISTINCT FROM changes.new_value;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION seed_organization_subtask_type() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO work_item_types (org_id, key, name, icon, color, is_default, is_epic, is_subtask, sort_order)
    VALUES (NEW.id, 'subtask', 'Subtask', 'ListTodo', '#64748b', FALSE, FALSE, TRUE, 5)
    ON CONFLICT (org_id, key) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS organization_subtask_type ON organizations;
CREATE TRIGGER organization_subtask_type AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION seed_organization_subtask_type();

CREATE OR REPLACE FUNCTION protect_subtask_type() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_subtask AND EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
            RAISE EXCEPTION 'The seeded Subtask type cannot be deleted' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.is_subtask AND (NOT NEW.is_subtask OR NEW.key <> OLD.key OR NEW.org_id <> OLD.org_id
        OR NOT NEW.is_active OR NEW.is_epic OR NEW.is_default) THEN
        RAISE EXCEPTION 'The seeded Subtask type must stay active, non-default and a Subtask' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS protect_subtask_type ON work_item_types;
CREATE TRIGGER protect_subtask_type BEFORE UPDATE OR DELETE ON work_item_types
FOR EACH ROW EXECUTE FUNCTION protect_subtask_type();
