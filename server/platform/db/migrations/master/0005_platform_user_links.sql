-- PR-C: one human may hold both a platform principal and one or more tenant
-- principals. Authority never crosses automatically; this table only records
-- the explicit relationship used by realm selection and step-up switching.
CREATE TABLE IF NOT EXISTS platform_user_links (
    platform_user_id INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_user_id   INTEGER NOT NULL,
    default_realm    TEXT NOT NULL DEFAULT 'tenant'
                     CHECK (default_realm IN ('tenant','platform')),
    linked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    linked_by        INTEGER REFERENCES platform_users(id) ON DELETE SET NULL,
    PRIMARY KEY (platform_user_id, tenant_id),
    UNIQUE (tenant_id, tenant_user_id)
);

CREATE INDEX IF NOT EXISTS idx_platform_user_links_tenant
    ON platform_user_links(tenant_id, tenant_user_id);

-- Durable, atomic, single-use record for cross-host handoff JWTs. The JWT
-- carries the claims; this row carries only its random jti and consumption
-- state. Using Postgres rather than process memory makes replay protection work
-- across Railway replicas and survive restarts.
CREATE TABLE IF NOT EXISTS realm_handoffs (
    jti              UUID PRIMARY KEY,
    source_realm     TEXT NOT NULL CHECK (source_realm IN ('tenant','platform','login')),
    target_realm     TEXT NOT NULL CHECK (target_realm IN ('tenant','platform')),
    platform_user_id INTEGER REFERENCES platform_users(id) ON DELETE CASCADE,
    tenant_id        INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_user_id   INTEGER,
    expires_at       TIMESTAMPTZ NOT NULL,
    consumed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realm_handoffs_expiry
    ON realm_handoffs(expires_at) WHERE consumed_at IS NULL;

-- Password-login chooser. Credentials are verified before this row is created;
-- the short-lived JWT only identifies this one-time choice. Persisting the jti
-- makes the ticket non-replayable across replicas.
CREATE TABLE IF NOT EXISTS realm_login_choices (
    jti              UUID PRIMARY KEY,
    platform_user_id INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tenant_user_id   INTEGER NOT NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    consumed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_realm_login_choices_expiry
    ON realm_login_choices(expires_at) WHERE consumed_at IS NULL;