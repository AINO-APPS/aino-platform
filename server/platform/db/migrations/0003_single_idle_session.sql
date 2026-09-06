-- One authentication session per tenant user, expiring after two days idle.
ALTER TABLE user_sessions
    ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY user_id ORDER BY last_activity_at DESC, created_at DESC, id DESC
    ) AS position
    FROM user_sessions
)
DELETE FROM user_sessions
WHERE id IN (SELECT id FROM ranked WHERE position > 1);

DROP INDEX IF EXISTS idx_user_sessions_user;
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_activity ON user_sessions(last_activity_at);