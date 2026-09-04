-- MIG-0301: forced password changes for tenantless platform administrators.
ALTER TABLE platform_users
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
