-- Concurrent sessions, one per device (2026-10-01). Signing in on web, desktop
-- or another phone no longer ends the mobile session (Slack / Teams model).
-- A device that sends `X-AINO-Device-Id` keeps exactly one row: signing in
-- again on that device replaces it. Browsers without an id get a new row;
-- authSessions.ts prunes each user to the most recent sessions.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS device_id TEXT;

DROP INDEX IF EXISTS uq_user_sessions_user;
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_user_device
    ON user_sessions(user_id, device_id) WHERE device_id IS NOT NULL;
