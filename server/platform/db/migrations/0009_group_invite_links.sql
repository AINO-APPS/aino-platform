-- Group invite links (2026-10-08). A group admin can publish a link that lets
-- any active user of the same tenant join (or ask to join) the group.
-- invite_token is NULL until the link is first enabled; resetting the link
-- issues a new token so previously shared links stop working.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS invite_token TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS invite_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS invite_requires_approval BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_invite_token_idx
    ON conversations (invite_token) WHERE invite_token IS NOT NULL;

-- Pending "request to join" entries for links that require admin approval.
CREATE TABLE IF NOT EXISTS conversation_join_requests (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);
