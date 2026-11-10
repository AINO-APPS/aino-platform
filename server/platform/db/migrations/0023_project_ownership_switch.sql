-- Retained after an emergency rollback: the initial publication is one-time.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS project_ownership_switched_at TIMESTAMPTZ;

UPDATE organizations SET project_ownership_switched_at = NOW()
WHERE project_ownership = TRUE AND project_ownership_switched_at IS NULL;
