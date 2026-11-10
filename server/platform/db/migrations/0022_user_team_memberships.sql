CREATE TABLE IF NOT EXISTS user_team_memberships (
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_user_team_memberships_team_id
    ON user_team_memberships(team_id);

INSERT INTO user_team_memberships (user_id, team_id)
SELECT u.id, u.team_id
FROM users u
JOIN teams t ON t.id = u.team_id AND t.org_id = u.org_id
ON CONFLICT (user_id, team_id) DO NOTHING;
