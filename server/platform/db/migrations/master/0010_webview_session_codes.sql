-- Single-use session exchange for the iOS Tasks webview.
--
-- The native client presents its bearer token and receives a short-lived code;
-- the webview redeems that code for a normal cookie session. The bearer token
-- itself never enters the web page, and a code can only be redeemed once.
CREATE TABLE IF NOT EXISTS webview_session_codes (
    jti             UUID PRIMARY KEY,
    user_id         INTEGER NOT NULL,
    tenant_id       INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    -- The realm the code may be redeemed in. A tenant code cannot mint a
    -- platform session.
    realm           TEXT NOT NULL CHECK(realm IN ('tenant','platform')),
    -- The surface that asked for the code, so a native client cannot redeem.
    issued_to       TEXT NOT NULL CHECK(issued_to IN ('ios','android','desktop')),
    expires_at      TIMESTAMPTZ NOT NULL,
    consumed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webview_session_codes_expiry
    ON webview_session_codes(expires_at)
    WHERE consumed_at IS NULL;
