CREATE TABLE IF NOT EXISTS platform_announcements (
    id           SERIAL PRIMARY KEY,
    created_by   INTEGER REFERENCES platform_users(id) ON DELETE SET NULL,
    message      TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'info'
                     CHECK (type IN ('info', 'warning', 'success', 'urgent', 'quote')),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_announcements_active
    ON platform_announcements(is_active, created_at DESC);