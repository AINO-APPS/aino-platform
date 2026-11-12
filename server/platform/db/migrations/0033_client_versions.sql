-- Observation fields are separate from mobile/web sign-in exclusivity.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS observed_client_class TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS client_version TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS client_version_seen_at TIMESTAMPTZ;
