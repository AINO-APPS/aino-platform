-- Platform operators must not invalidate another console session merely by
-- signing in from a second trusted browser. Tenant databases retain the unique
-- user_id index and therefore retain their single-session policy.
DROP INDEX IF EXISTS uq_user_sessions_user;
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);