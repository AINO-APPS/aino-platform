-- One active session per client class (2026-10-09). A tenant user may be
-- signed in on one phone (`mobile`) and one browser / desktop app (`web`) at a
-- time: a new sign-in ends the user's other sessions of the same class and
-- signs those devices out right away (services/sessionSignOut.ts).
-- Supersedes the unlimited multi-device policy of 0004_device_sessions.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS client_class TEXT;

UPDATE user_sessions
   SET client_class = CASE WHEN device_id IS NOT NULL THEN 'mobile' ELSE 'web' END
 WHERE client_class IS NULL;

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_class ON user_sessions(user_id, client_class);

-- The install id (`X-AINO-Device-Id`) that registered each push token, so a
-- signed-out phone gets a "session revoked" push and stops receiving alerts.
ALTER TABLE device_tokens ADD COLUMN IF NOT EXISTS device_id TEXT;
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_device ON device_tokens(user_id, device_id);
-- Rotating refresh tokens for native apps (P2.7). Only a SHA-256 of the
-- secret is stored; the previous hash detects a replayed (stolen) token.
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_hash TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_prev_hash TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS refresh_rotated_at TIMESTAMPTZ;
