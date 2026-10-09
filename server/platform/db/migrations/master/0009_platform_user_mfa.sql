-- TOTP MFA for platform operators (P2.1, 2026-10-09). Tenant users already
-- have the same columns (tenant migration 0002_migration_catchup).
-- `mfa_secret` holds the AES-GCM encrypted base32 secret, never plain text;
-- `mfa_recovery_codes` holds bcrypt hashes of the one-time recovery codes.
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS mfa_pending_secret TEXT;
ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS mfa_recovery_codes JSONB;
