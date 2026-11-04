ALTER TABLE organizations ADD COLUMN IF NOT EXISTS service_desk_project_id INTEGER
    REFERENCES projects(id) ON DELETE SET NULL;

-- System syncs must not impersonate a customer or a platform administrator.
ALTER TABLE task_history ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE task_history ADD COLUMN IF NOT EXISTS actor_type TEXT NOT NULL DEFAULT 'user'
    CHECK (actor_type IN ('user', 'system'));
