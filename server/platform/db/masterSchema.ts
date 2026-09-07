import { masterQuery } from "./pool";
import { logger } from "../../utils/logger";

// Master-only schema (tenants catalog, platform users, app settings)
// ────────────────────────────────────────────────────────────────────────────

async function initMasterDB(): Promise<void> {
    // Migration tracking
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS _migrations (
            name       TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ---- Tenant catalog ----
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS tenants (
            id               SERIAL PRIMARY KEY,
            org_name         TEXT NOT NULL,
            slug             TEXT UNIQUE NOT NULL,
            db_name          TEXT UNIQUE NOT NULL,
            db_host          TEXT,
            custom_domain    TEXT UNIQUE,
            status           TEXT NOT NULL DEFAULT 'active'
                                 CHECK(status IN ('active','suspended','migrating','deleted')),
            max_users        INTEGER,
            max_storage_mb   INTEGER,
            features         JSONB NOT NULL DEFAULT '{}',
            is_default       BOOLEAN NOT NULL DEFAULT FALSE,
            suspended_at     TIMESTAMPTZ,
            suspended_reason TEXT,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await masterQuery(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE`);
    await masterQuery(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'standard'`);
    await masterQuery(`DO $$ BEGIN ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check CHECK(plan IN ('standard', 'pro', 'enterprise')); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(custom_domain)`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status)`);

    // Migration: ensure exactly one tenant is flagged as the default (platform)
    // tenant. If none is flagged, promote the tenant whose slug is 'default',
    // or fall back to the oldest active tenant. The default tenant's backlog
    // receives all service-desk tickets from every tenant.
    await masterQuery(`
        DO $do$
        DECLARE
            target_id INTEGER;
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM tenants WHERE is_default = TRUE) THEN
                SELECT id INTO target_id FROM tenants
                 WHERE status != 'deleted' AND slug = 'default'
                 ORDER BY id ASC LIMIT 1;
                IF target_id IS NULL THEN
                    SELECT id INTO target_id FROM tenants
                     WHERE status != 'deleted'
                     ORDER BY id ASC LIMIT 1;
                END IF;
                IF target_id IS NOT NULL THEN
                    UPDATE tenants SET is_default = TRUE WHERE id = target_id;
                END IF;
            END IF;
        END $do$;
    `);

    // ---- Service Desk Tickets (cross-tenant, managed by default tenant) ----
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS service_desk_tickets (
            id               SERIAL PRIMARY KEY,
            tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            submitted_by_user_id INTEGER NOT NULL,
            submitted_by_name    TEXT NOT NULL,
            submitted_by_email   TEXT,
            ticket_type      TEXT NOT NULL CHECK(ticket_type IN ('bug','feature_request','access_issue','other')),
            title            TEXT NOT NULL,
            description      TEXT,
            priority         TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
            status           TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','in_progress','resolved','closed')),
            assigned_to      TEXT,
            admin_notes      TEXT,
            resolved_at      TIMESTAMPTZ,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_service_desk_tenant ON service_desk_tickets(tenant_id, status)`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_service_desk_status ON service_desk_tickets(status, created_at)`);

    // ---- User directory for cross-tenant login resolution ----
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS user_directory (
            id         SERIAL PRIMARY KEY,
            email      TEXT UNIQUE NOT NULL,
            username   TEXT UNIQUE NOT NULL,
            tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_user_directory_tenant ON user_directory(tenant_id)`);

    // ---- Platform users (platform_admin accounts — no org) ----
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS platform_users (
            id                   SERIAL PRIMARY KEY,
            username             TEXT UNIQUE NOT NULL,
            password             TEXT NOT NULL,
            full_name            TEXT NOT NULL,
            email                TEXT UNIQUE,
            role                 TEXT NOT NULL DEFAULT 'platform_admin'
                                     CHECK(role IN ('platform_admin')),
            is_active            BOOLEAN NOT NULL DEFAULT TRUE,
            token_version        INTEGER NOT NULL DEFAULT 0,
            failed_login_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until         TIMESTAMPTZ,
            theme                TEXT NOT NULL DEFAULT 'dark',
            avatar               TEXT,
            must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
            created_at           TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await masterQuery(`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    await masterQuery(`ALTER TABLE platform_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`);

    // ---- App settings (platform-wide) ----
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ---- Sessions for platform_users ----
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS user_sessions (
            id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
            user_id    INTEGER NOT NULL,
            device     TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)`);

    // ---- Note Share Tokens (cross-tenant lookup for public read-only links) ----
    //
    // Notes live in the per-tenant DB (notebooks table). To serve a public
    // share link without forcing the visitor through tenant resolution, we
    // store an unguessable token in the MASTER DB that maps token →
    // (tenant_id, user_id, page_id). The public route reads this row, then
    // hits the tenant pool to fetch the actual page content.
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS note_share_tokens (
            token         TEXT PRIMARY KEY,
            tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id       INTEGER NOT NULL,
            page_id       TEXT    NOT NULL,
            page_title    TEXT,
            created_by    INTEGER NOT NULL,
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (tenant_id, user_id, page_id)
        )
    `);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_note_share_lookup ON note_share_tokens(tenant_id, user_id, page_id)`);

    // ---- Platform audit logs (master-level admin actions) ----
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS platform_audit_logs (
            id          SERIAL PRIMARY KEY,
            actor_id    INTEGER REFERENCES platform_users(id) ON DELETE SET NULL,
            action      TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id   INTEGER,
            tenant_id   INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
            details     JSONB,
            ip_address  TEXT,
            user_agent  TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            ended_at    TIMESTAMPTZ
        )
    `);
    // Add ended_at if table already exists without it
    await masterQuery(`ALTER TABLE platform_audit_logs ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_platform_audit_actor ON platform_audit_logs(actor_id, created_at)`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_platform_audit_tenant ON platform_audit_logs(tenant_id, created_at)`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_platform_audit_action ON platform_audit_logs(action, created_at)`);

    // ---- Tenant access requests (impersonation approval workflow) ----
    //
    // The legacy "Enter Tenant" flow let any platform_admin silently drop
    // into a tenant as super_admin with no consent, no re-authentication,
    // and no bounded duration — failing SOC2 / ISO 27001 / HIPAA support-
    // access controls. This table backs the new "Just-In-Time Access with
    // Tenant Consent" flow:
    //   1. Platform admin POSTs a request (reason, scope, duration).
    //   2. A tenant super_admin sees it in their inbox and either:
    //        a. Approves → server generates a one-time 6-digit code,
    //           hashes it, returns the plaintext to the approver ONCE.
    //        b. Denies → request is dead.
    //   3. Platform admin enters the code + their own password on
    //      POST /:id/impersonate. Both must match. JWT TTL is bounded
    //      to the request's remaining duration.
    //   4. Active sessions can be revoked by any tenant super_admin at
    //      any time.
    //
    // Every state transition is mirrored into platform_audit_logs.
    await masterQuery(`
        CREATE TABLE IF NOT EXISTS tenant_access_requests (
            id                  BIGSERIAL PRIMARY KEY,
            tenant_id           INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            requested_by        INTEGER NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
            requested_by_name   TEXT,
            requested_by_email  TEXT,
            requested_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reason              TEXT NOT NULL,
            scope               TEXT NOT NULL DEFAULT 'write'
                                    CHECK(scope IN ('read','write')),
            duration_minutes    INTEGER NOT NULL DEFAULT 30
                                    CHECK(duration_minutes BETWEEN 5 AND 240),
            status              TEXT NOT NULL DEFAULT 'pending'
                                    CHECK(status IN ('pending','approved','denied',
                                                     'consumed','expired','revoked','cancelled')),

            approved_by         INTEGER,
            approved_by_name    TEXT,
            approved_at         TIMESTAMPTZ,
            denied_reason       TEXT,

            approval_code_hash  TEXT,
            code_expires_at     TIMESTAMPTZ,

            consumed_at         TIMESTAMPTZ,
            session_ends_at     TIMESTAMPTZ,
            session_audit_log_id BIGINT,

            revoked_at          TIMESTAMPTZ,
            revoked_by          INTEGER,
            revoked_by_name     TEXT,
            revoked_reason      TEXT,

            cancelled_at        TIMESTAMPTZ,

            created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_tenant_access_req_tenant_status ON tenant_access_requests(tenant_id, status)`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_tenant_access_req_requester ON tenant_access_requests(requested_by, requested_at DESC)`);
    await masterQuery(`CREATE INDEX IF NOT EXISTS idx_tenant_access_req_active ON tenant_access_requests(tenant_id) WHERE status = 'consumed' AND revoked_at IS NULL`);

    // Seed defaults
    await masterQuery(`
        INSERT INTO app_settings (key, value) VALUES ('registration_mode', 'open')
        ON CONFLICT (key) DO NOTHING
    `);

    // ── Impersonation policy defaults ──
    // `impersonation_requires_consent` — when 'true', platform admins must
    //   request access and have it approved by a tenant super_admin before
    //   the impersonate endpoint will mint a session token.
    // `impersonation_break_glass_allowed` — when 'true', platform admins may
    //   bypass consent for emergencies; every bypass is heavily audited and
    //   notifies all tenant super_admins post-hoc. Off by default.
    // `impersonation_max_session_minutes` — hard cap on requested duration.
    // `impersonation_code_ttl_minutes` — how long a generated approval code
    //   is valid before the platform admin must request a fresh approval.
    await masterQuery(`
        INSERT INTO app_settings (key, value) VALUES
            ('impersonation_requires_consent',  'true'),
            ('impersonation_break_glass_allowed','false'),
            ('impersonation_max_session_minutes','60'),
            ('impersonation_code_ttl_minutes',  '15')
        ON CONFLICT (key) DO NOTHING
    `);

    // ── Platform configuration defaults ──
    //
    // NOTE: SMTP + branding keys (`smtp_*`, `brand_*`) used to be seeded
    // here so the platform admin panel could surface them as editable
    // fields. That feature was removed — outbound email transport now
    // lives in `process.env.SMTP_*` / `GMAIL_*` (consumed by
    // `utils/mailer.js`) and white-labeling is tenant-scoped via
    // `org_branding` + `org_email_templates`. See `utils/platformConfig.js`
    // for the canonical list of platform-wide keys.
    await masterQuery(`
        INSERT INTO app_settings (key, value) VALUES
            ('maintenance_mode',             'false'),
            ('maintenance_message',          ''),
            ('session_timeout_minutes',      '480'),
            ('password_min_length',          '8'),
            ('password_require_uppercase',   'true'),
            ('password_require_number',      'true'),
            ('password_require_special',     'false'),
            ('allowed_email_domains',        ''),
            ('audit_log_retention_days',     '365'),
            ('deleted_tenant_cleanup_days',  '90'),
            ('session_log_retention_days',   '90')
        ON CONFLICT (key) DO NOTHING
    `);

    // ── Cleanup: drop deprecated platform-level SMTP + branding rows.
    // Idempotent on every startup so any tenant that upgraded across this
    // change is automatically scrubbed without a manual migration step.
    await masterQuery(`
        DELETE FROM app_settings WHERE key IN (
            'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass',
            'smtp_from_address', 'smtp_from_name', 'smtp_secure',
            'brand_name', 'brand_primary_color',
            'brand_logo_url', 'brand_favicon_url'
        )
    `);

    logger.info('Master DB schema initialised');
}

export { initMasterDB };
