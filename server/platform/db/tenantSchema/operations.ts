import type { SchemaQuery } from "../schemaTypes";
import { runStatusMigration } from "../statusSchema";

async function initializeOperationsTenantSchema(q: SchemaQuery): Promise<void> {
    // ---- Polls ----
    await q(`
        CREATE TABLE IF NOT EXISTS polls (
            id              SERIAL PRIMARY KEY,
            conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            creator_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            question        TEXT NOT NULL,
            options         JSONB NOT NULL DEFAULT '[]',
            multi_select    BOOLEAN NOT NULL DEFAULT FALSE,
            closed_at       TIMESTAMPTZ,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        CREATE TABLE IF NOT EXISTS poll_votes (
            id         SERIAL PRIMARY KEY,
            poll_id    INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            option_idx INTEGER NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (poll_id, user_id, option_idx)
        )
    `);

    // ---- Call Logs ----
    await q(`
        CREATE TABLE IF NOT EXISTS call_logs (
            id              SERIAL PRIMARY KEY,
            conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            caller_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            call_type       VARCHAR(10) NOT NULL DEFAULT 'voice',
            status          VARCHAR(20) NOT NULL DEFAULT 'ringing',
            started_at      TIMESTAMPTZ,
            ended_at        TIMESTAMPTZ,
            duration        INTEGER,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_call_logs_conv ON call_logs(conversation_id, created_at DESC)`);

    // ---- Meetings ----
    await q(`
        CREATE TABLE IF NOT EXISTS meetings (
            id                  SERIAL PRIMARY KEY,
            org_id              INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
            title               TEXT NOT NULL,
            description         TEXT,
            meeting_code        VARCHAR(20) NOT NULL UNIQUE,
            created_by          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            conversation_id     INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
            calendar_event_id   INTEGER REFERENCES calendar_events(id) ON DELETE SET NULL,
            status              VARCHAR(20) NOT NULL DEFAULT 'scheduled',
            started_at          TIMESTAMPTZ,
            ended_at            TIMESTAMPTZ,
            max_participants    INTEGER NOT NULL DEFAULT 20,
            settings            JSONB NOT NULL DEFAULT '{"muteOnJoin":false,"allowScreenShare":true}',
            created_at          TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_meetings_org ON meetings(org_id, created_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_meetings_code ON meetings(meeting_code)`);
    // Huddle (ambient group call) flag on the meeting bound to a conversation.
    await q(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS is_huddle BOOLEAN NOT NULL DEFAULT FALSE`);

    await q(`
        CREATE TABLE IF NOT EXISTS meeting_participants (
            id          SERIAL PRIMARY KEY,
            meeting_id  INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role        VARCHAR(20) NOT NULL DEFAULT 'participant',
            status      VARCHAR(20) NOT NULL DEFAULT 'invited',
            joined_at   TIMESTAMPTZ,
            left_at     TIMESTAMPTZ,
            UNIQUE(meeting_id, user_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_meeting_participants ON meeting_participants(meeting_id, user_id)`);

    // ---- Extend calendar_events with meeting_id ----
    await q(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE meeting_participants ADD COLUMN IF NOT EXISTS participant_type VARCHAR(20) NOT NULL DEFAULT 'required'`);

    // ---- Delivery status on messages ----
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivered_to JSONB DEFAULT '[]'`);

    // ---- Message format_type for rich text / polls / code ----
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS format_type VARCHAR(20) DEFAULT 'text'`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB`);
    // ---- Full-text search index on tasks ----
    await q(`
        CREATE INDEX IF NOT EXISTS idx_tasks_fts ON tasks
        USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')))
    `);

    // ---- Pay periods (for payroll locking) ----
    await q(`
        CREATE TABLE IF NOT EXISTS pay_periods (
            id          SERIAL PRIMARY KEY,
            org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            label       TEXT NOT NULL,
            start_date  TEXT NOT NULL,
            end_date    TEXT NOT NULL,
            locked_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            locked_at   TIMESTAMPTZ DEFAULT NOW(),
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, start_date, end_date)
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_pay_periods_org ON pay_periods(org_id, start_date)
    `);

    // ---- Compensation templates (org-level salary structures) ----
    await q(`
        CREATE TABLE IF NOT EXISTS compensation_templates (
            id              SERIAL PRIMARY KEY,
            org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name            TEXT NOT NULL,
            description     TEXT,
            components      JSONB NOT NULL DEFAULT '[]',
            is_default      BOOLEAN NOT NULL DEFAULT FALSE,
            created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, name)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_compensation_templates_org ON compensation_templates(org_id)`);

    // ---- Employee compensation (per-employee salary assignment) ----
    await q(`
        CREATE TABLE IF NOT EXISTS employee_compensation (
            id                  SERIAL PRIMARY KEY,
            user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            org_id              INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            template_id         INTEGER REFERENCES compensation_templates(id) ON DELETE SET NULL,
            effective_from      TEXT NOT NULL,
            effective_to        TEXT,
            ctc_annual          NUMERIC(12,2) NOT NULL DEFAULT 0,
            base_salary         NUMERIC(12,2) NOT NULL DEFAULT 0,
            components          JSONB NOT NULL DEFAULT '{}',
            currency            TEXT NOT NULL DEFAULT 'INR',
            payment_frequency   TEXT NOT NULL DEFAULT 'monthly' CHECK(payment_frequency IN ('monthly','biweekly','weekly')),
            bank_account        TEXT,
            notes               TEXT,
            created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, effective_from)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_employee_compensation_user ON employee_compensation(user_id, effective_from DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_employee_compensation_org ON employee_compensation(org_id)`);

    // ---- Salary slips (generated payslip records) ----
    await q(`
        CREATE TABLE IF NOT EXISTS salary_slips (
            id                  SERIAL PRIMARY KEY,
            org_id              INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            pay_period_id       INTEGER NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
            compensation_id     INTEGER REFERENCES employee_compensation(id) ON DELETE SET NULL,
            slip_month          TEXT NOT NULL,
            earnings            JSONB NOT NULL DEFAULT '{}',
            deductions          JSONB NOT NULL DEFAULT '{}',
            gross_earnings      NUMERIC(12,2) NOT NULL DEFAULT 0,
            total_deductions    NUMERIC(12,2) NOT NULL DEFAULT 0,
            net_pay             NUMERIC(12,2) NOT NULL DEFAULT 0,
            days_worked         NUMERIC(5,2) DEFAULT 0,
            days_absent         NUMERIC(5,2) DEFAULT 0,
            leave_days          NUMERIC(5,2) DEFAULT 0,
            overtime_hours      NUMERIC(6,2) DEFAULT 0,
            status              TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','generated','published','revised')),
            generated_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
            published_at        TIMESTAMPTZ,
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, user_id, pay_period_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_salary_slips_user ON salary_slips(user_id, slip_month DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_salary_slips_period ON salary_slips(pay_period_id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_salary_slips_org_month ON salary_slips(org_id, slip_month)`);

    // ---- Payroll disbursements (bank transfer tracking) ----
    await q(`
        CREATE TABLE IF NOT EXISTS payroll_disbursements (
            id                          SERIAL PRIMARY KEY,
            org_id                      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            salary_slip_id              INTEGER NOT NULL REFERENCES salary_slips(id) ON DELETE CASCADE,
            user_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            amount                      NUMERIC(12,2) NOT NULL,
            currency                    TEXT NOT NULL DEFAULT 'INR',
            razorpay_payout_id          TEXT,
            razorpay_fund_account_id    TEXT,
            transfer_mode               TEXT NOT NULL DEFAULT 'NEFT',
            status                      TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','processing','processed','reversed','failed')),
            failure_reason              TEXT,
            utr                         TEXT,
            initiated_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
            initiated_at                TIMESTAMPTZ,
            processed_at                TIMESTAMPTZ,
            created_at                  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(salary_slip_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_org ON payroll_disbursements(org_id, status)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_payroll_disbursements_user ON payroll_disbursements(user_id)`);

    // ---- Organization payment config (Razorpay credentials) ----
    await q(`
        CREATE TABLE IF NOT EXISTS org_payment_config (
            id                      SERIAL PRIMARY KEY,
            org_id                  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            provider                TEXT NOT NULL DEFAULT 'razorpay',
            api_key_id              TEXT,
            api_key_secret          TEXT,
            account_number          TEXT,
            webhook_secret          TEXT,
            default_transfer_mode   TEXT NOT NULL DEFAULT 'NEFT',
            is_active               BOOLEAN NOT NULL DEFAULT FALSE,
            created_at              TIMESTAMPTZ DEFAULT NOW(),
            updated_at              TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id)
        )
    `);

    // ---- Employee bank details (for payouts) ----
    await q(`
        CREATE TABLE IF NOT EXISTS employee_bank_details (
            id                          SERIAL PRIMARY KEY,
            user_id                     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            org_id                      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            account_holder_name         TEXT NOT NULL,
            account_number              TEXT NOT NULL,
            ifsc_code                   TEXT NOT NULL,
            bank_name                   TEXT,
            account_type                TEXT NOT NULL DEFAULT 'savings',
            razorpay_contact_id         TEXT,
            razorpay_fund_account_id    TEXT,
            is_verified                 BOOLEAN NOT NULL DEFAULT FALSE,
            verified_at                 TIMESTAMPTZ,
            created_at                  TIMESTAMPTZ DEFAULT NOW(),
            updated_at                  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(user_id, org_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_employee_bank_details_org ON employee_bank_details(org_id)`);

    // ---- CTC breakdown config (org-level percentages for auto-calculation) ----
    await q(`
        CREATE TABLE IF NOT EXISTS org_ctc_config (
            org_id          INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
            basic_pct       NUMERIC(5,2) NOT NULL DEFAULT 40,
            hra_pct         NUMERIC(5,2) NOT NULL DEFAULT 50,
            conveyance_pct  NUMERIC(5,2) NOT NULL DEFAULT 5,
            pf_pct          NUMERIC(5,2) NOT NULL DEFAULT 12,
            pf_max          NUMERIC(10,2) NOT NULL DEFAULT 1800,
            pt_fixed        NUMERIC(10,2) NOT NULL DEFAULT 200,
            updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // ---- Announcements ----
    await q(`
        CREATE TABLE IF NOT EXISTS announcements (
            id           SERIAL PRIMARY KEY,
            org_id       INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
            created_by   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            message      TEXT NOT NULL,
            type         TEXT NOT NULL DEFAULT 'info',
            is_active    BOOLEAN NOT NULL DEFAULT TRUE,
            expires_at   TIMESTAMPTZ,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(org_id, is_active, created_at DESC)
    `);
    await q(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);

    // ─── Status state ──────────────────────────────────────────────────────
    // PR8 / ADR-0001 step 8: the legacy `users.user_status` and
    // `users.user_status_text` columns are no longer created on fresh DBs.
    // The platform status schema (platform/db/statusSchema.js) is the
    // single source of truth for v2 status state. Existing tenant DBs still
    // have the legacy columns; they're dropped by the
    // `2026_06_v5_drop_legacy_user_status_columns` migration in
    // server/utils/migrationRunner.js.

    // ─── Status service v2 schema (preferences + sessions + audit) ──────────
    // Owned by services/status. Single entry point keeps the new tables /
    // constraints discoverable in one place.
    await runStatusMigration(q);

    // Per-user notification & sound preferences (ringtones, message tones,
    // mute toggle, volumes). Stored as JSONB so we can evolve the schema
    // without a follow-up migration. See client/src/utils/sounds.js for the
    // canonical default shape (DEFAULT_PREFS).
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb`);

    // Tenant-level app settings (registration_mode, etc.)
    await q(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key        TEXT PRIMARY KEY,
            value      TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        INSERT INTO app_settings (key, value) VALUES ('registration_mode', 'open')
        ON CONFLICT (key) DO NOTHING
    `);

    // ─────────────────────────────────────────────────────────────────────
    // Tenant-customisable roles.
    //
    // Each tenant has its own set of roles, each pinned to one of four
    // *permission levels* that drive RBAC:
    //   1 = employee   (standard member)
    //   2 = team_lead
    //   3 = manager
    //   4 = hr_admin
    //
    // Tenants can rename, recolour, add, and remove rows freely.
    // The two top-level system roles — super_admin (level 5) and
    // platform_admin (level 6) — are NOT stored in this table; they're
    // hardcoded in middleware/rbac.js and apply across every organisation.
    //
    // Backwards-compat: every org is seeded with the four canonical keys
    // (employee/team_lead/manager/hr_admin), all flagged is_system=true so
    // the UI can warn before deleting them. Deletion still requires that
    // no active users hold the role.
    // ─────────────────────────────────────────────────────────────────────
}

export { initializeOperationsTenantSchema };
