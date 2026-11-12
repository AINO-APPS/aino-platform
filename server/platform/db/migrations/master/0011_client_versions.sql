ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS observed_client_class TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS client_version TEXT;
ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS client_version_seen_at TIMESTAMPTZ;

-- Retained independently of sessions: logout/replacement must not erase adoption.
CREATE TABLE IF NOT EXISTS client_version_observations (
    identity_key TEXT NOT NULL,
    client TEXT NOT NULL CHECK (client IN ('android', 'desktop', 'web')),
    version TEXT NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (identity_key, client, version)
);
CREATE INDEX IF NOT EXISTS idx_client_version_observations_seen
    ON client_version_observations(last_seen_at);
