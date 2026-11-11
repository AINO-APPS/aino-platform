-- 0031 cleared ordinary leaf links instead of converting them to Subtasks.
-- Recover only links proven by its immutable snapshots. Keep the original
-- review rows and history; ambiguous or subsequently edited work stays intact.
CREATE TABLE IF NOT EXISTS task_hierarchy_repair_corrections (
    task_id INTEGER PRIMARY KEY,
    org_id INTEGER,
    reason TEXT NOT NULL,
    before_value JSONB NOT NULL,
    after_value JSONB NOT NULL,
    repaired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS _data_backfills (name TEXT PRIMARY KEY);
DO $$
DECLARE recovery_org INTEGER;
BEGIN
    INSERT INTO _data_backfills (name) VALUES ('0034_recover_hierarchy_leaves')
    ON CONFLICT (name) DO NOTHING;
    IF FOUND THEN
        FOR recovery_org IN SELECT DISTINCT org_id FROM task_hierarchy_repairs
            WHERE org_id IS NOT NULL ORDER BY org_id
        LOOP
            PERFORM pg_advisory_xact_lock(hashtext('aino:ticket-placement:' || recovery_org::TEXT));
        END LOOP;
        WITH original AS (
            SELECT t.id, COALESCE(r.before_value, to_jsonb(t)) AS value
            FROM tasks t LEFT JOIN task_hierarchy_repairs r ON r.task_id = t.id
        ), eligible AS (
            SELECT t.id, t.org_id, to_jsonb(t) AS before_value,
                p.id AS parent_id, p.sprint_id AS parent_sprint, st.id AS subtask_type
            FROM task_hierarchy_repairs r
            JOIN tasks t ON t.id = r.task_id
            JOIN original old_parent ON old_parent.id = (r.before_value->>'parent_task_id')::INTEGER
            JOIN tasks p ON p.id = old_parent.id
            LEFT JOIN work_item_types old_type ON old_type.id = (r.before_value->>'work_item_type_id')::INTEGER
            LEFT JOIN work_item_types old_parent_type ON old_parent_type.id = (old_parent.value->>'work_item_type_id')::INTEGER
            LEFT JOIN work_item_types parent_type ON parent_type.id = p.work_item_type_id
            JOIN work_item_types st ON st.org_id = t.org_id AND st.is_subtask
            WHERE NOT COALESCE(old_type.is_epic, FALSE) AND NOT COALESCE(old_type.is_subtask, FALSE)
                AND NOT COALESCE(old_parent_type.is_epic, FALSE) AND NOT COALESCE(old_parent_type.is_subtask, FALSE)
                AND NOT COALESCE(parent_type.is_epic, FALSE) AND NOT COALESCE(parent_type.is_subtask, FALSE)
                AND p.id <> t.id AND p.org_id = t.org_id AND p.project_id = t.project_id
                AND r.before_value->>'org_id' = old_parent.value->>'org_id'
                AND r.before_value->>'project_id' = old_parent.value->>'project_id'
                AND NOT EXISTS (SELECT 1 FROM original child WHERE (child.value->>'parent_task_id')::INTEGER = t.id)
                AND NOT EXISTS (SELECT 1 FROM task_hierarchy_repairs child WHERE (child.before_value->>'parent_task_id')::INTEGER = t.id)
                AND t.parent_task_id IS NULL AND r.after_value->>'parent_task_id' IS NULL
                AND t.org_id = (r.after_value->>'org_id')::INTEGER
                AND t.project_id = (r.after_value->>'project_id')::INTEGER
                AND t.work_item_type_id IS NOT DISTINCT FROM (r.after_value->>'work_item_type_id')::INTEGER
                AND NOT EXISTS (
                    SELECT 1 FROM task_history h WHERE h.task_id = t.id AND h.created_at >= r.repaired_at
                    AND h.actor_type <> 'system' AND h.field IN ('parent', 'work_item_type', 'project', 'sprint', 'story_points')
                    -- 0032 used the default user actor for automatic sprint
                    -- retirement. A shared migration transaction timestamp
                    -- proves these are migration rows, not later human moves.
                    AND NOT (h.field = 'sprint' AND h.new_value = 'none' AND h.created_at = r.repaired_at
                        AND EXISTS (SELECT 1 FROM _migrations m
                            WHERE m.name = '0032_project_types_scrum_planning' AND m.applied_at = h.created_at))
                )
        ), repairs AS (
            INSERT INTO task_hierarchy_repair_corrections (task_id, org_id, reason, before_value, after_value)
            SELECT id, org_id, 'Recover eligible legacy leaf as Subtask; inherit parent sprint', before_value,
                before_value || jsonb_build_object('parent_task_id', parent_id,
                    'work_item_type_id', subtask_type, 'sprint_id', parent_sprint, 'story_points', NULL)
            FROM eligible
            ON CONFLICT (task_id) DO NOTHING RETURNING *
        ), updated AS (
            UPDATE tasks t SET parent_task_id = (r.after_value->>'parent_task_id')::INTEGER,
                work_item_type_id = (r.after_value->>'work_item_type_id')::INTEGER,
                sprint_id = (r.after_value->>'sprint_id')::INTEGER, story_points = NULL
            FROM repairs r WHERE t.id = r.task_id RETURNING t.id
        )
        INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value, actor_type)
        SELECT r.task_id, NULL, 'updated', changes.field, changes.old_value, changes.new_value, 'system'
        FROM repairs r CROSS JOIN LATERAL (VALUES
            ('parent', r.before_value->>'parent_task_id', r.after_value->>'parent_task_id'),
            ('work_item_type', r.before_value->>'work_item_type_id', r.after_value->>'work_item_type_id'),
            ('sprint', r.before_value->>'sprint_id', r.after_value->>'sprint_id'),
            ('story_points', r.before_value->>'story_points', r.after_value->>'story_points')
        ) changes(field, old_value, new_value)
        WHERE changes.old_value IS DISTINCT FROM changes.new_value;
    END IF;
END $$;
