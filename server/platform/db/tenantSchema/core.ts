import type { SchemaQuery } from "../schemaTypes";

async function initializeCoreTenantSchema(q: SchemaQuery): Promise<void> {

    await q(`
        CREATE TABLE IF NOT EXISTS organizations (
            id                  SERIAL PRIMARY KEY,
            name                TEXT NOT NULL,
            slug                TEXT UNIQUE NOT NULL,
            logo                TEXT,
            work_hours_per_day  INTEGER NOT NULL DEFAULT 8,
            work_days           TEXT NOT NULL DEFAULT '1,2,3,4,5',
            timezone            TEXT NOT NULL DEFAULT 'UTC',
            fiscal_year_start   INTEGER NOT NULL DEFAULT 1,
            created_by          INTEGER,
            created_at          TIMESTAMPTZ DEFAULT NOW(),
            updated_at          TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Migration: minimum hours an employee must log on a working day to be
    // counted as "Present" by attendance reports/calendar. NULL = use
    // work_hours_per_day / 2 as a sensible default at query time.
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS min_hours_present NUMERIC(4,2)`);

    // Migration: regular office start time (HH:MM, 24h). Used as the default
    // clock-in time on manual time-entry forms and as the reference point for
    // attendance/presence calculations (instead of midnight). NULL = no
    // configured office hours, fall back to '09:00' on the client.
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS office_start_time TEXT`);

    // Migration: attendance verification (face + location) for clock-in.
    // When enabled, office mode requires a geofence pass AND a face match,
    // and remote mode requires a face match. Default OFF so existing tenants
    // are unaffected until an admin opts in.
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS attendance_verification_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS office_latitude DOUBLE PRECISION`);
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS office_longitude DOUBLE PRECISION`);
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS office_radius_m INTEGER NOT NULL DEFAULT 150`);
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS office_address TEXT`);

    // Wi-Fi-first attendance verification. When `office_wifi_verification_enabled`
    // is on and the client sends a `wifi_bssid` that matches one of the
    // BSSIDs in `office_wifi_bssids`, the geofence check is skipped — the
    // user is treated as "at the office" regardless of GPS accuracy. This
    // makes office clock-in reliable on laptops where Chromium's geolocation
    // falls back to IP-based lookup and reports the user kilometres away.
    // The geofence check stays in place as a fallback for Ethernet-only
    // machines, browser users (BSSID isn't readable from a browser), and
    // employees clocking in over LTE.
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS office_wifi_bssids JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await q(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS office_wifi_verification_enabled BOOLEAN NOT NULL DEFAULT FALSE`);

    await q(`
        CREATE TABLE IF NOT EXISTS users (
            id                   SERIAL PRIMARY KEY,
            username             TEXT UNIQUE NOT NULL,
            password             TEXT NOT NULL,
            full_name            TEXT NOT NULL,
            theme                TEXT NOT NULL DEFAULT 'dark',
            role                 TEXT NOT NULL DEFAULT 'employee'
                                     CHECK(role IN ('employee','team_lead','manager','hr_admin','super_admin','platform_admin')),
            is_active            BOOLEAN NOT NULL DEFAULT TRUE,
            org_id               INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
            team_id              INTEGER,
            department_id        INTEGER,
            manager_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
            timezone_offset      INTEGER NOT NULL DEFAULT 0,
            avatar               TEXT,
            email                TEXT UNIQUE,
            failed_login_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until         TIMESTAMPTZ,
            token_version        INTEGER NOT NULL DEFAULT 0,
            must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
            created_at           TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id)`);

    // Add lockout columns to existing databases
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`);

    // Migration: face recognition enrollment for attendance verification.
    // Stores a 128-float face embedding extracted client-side (face-api.js).
    // The raw image never leaves the browser — only the descriptor.
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS face_descriptor JSONB`);
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ`);

    // Synthetic Platform Inspector users carry hidden_from_directory=TRUE so
    // they never surface in People / Chat / @mention lists. See the matching
    // migration in utils/migrationRunner.js for the rollout to legacy tenants.
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_from_directory BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`CREATE INDEX IF NOT EXISTS idx_users_directory_visible ON users (org_id) WHERE hidden_from_directory = FALSE`);

    await q(`
        CREATE TABLE IF NOT EXISTS departments (
            id         SERIAL PRIMARY KEY,
            org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            head_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, name)
        )
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS teams (
            id                    SERIAL PRIMARY KEY,
            org_id                INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            department_id         INTEGER REFERENCES departments(id) ON DELETE SET NULL,
            name                  TEXT NOT NULL,
            lead_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at            TIMESTAMPTZ DEFAULT NOW(),
            sprint_duration_weeks INTEGER NOT NULL DEFAULT 2,
            sprint_start_date     TEXT,
            sprint_mode           TEXT NOT NULL DEFAULT 'manual' CHECK(sprint_mode IN ('manual','auto')),
            sprint_paused         BOOLEAN NOT NULL DEFAULT FALSE,
            UNIQUE(org_id, name)
        )
    `);
    // Migration: sprint automation mode + pause flag for existing tenants.
    await q(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS sprint_mode TEXT NOT NULL DEFAULT 'manual'`);
    await q(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS sprint_paused BOOLEAN NOT NULL DEFAULT FALSE`);

    // Add deferred FK from users -> teams and users -> departments
    await q(`
        DO $do$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                           WHERE constraint_name = 'users_team_id_fkey') THEN
                ALTER TABLE users ADD CONSTRAINT users_team_id_fkey
                    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
            END IF;
        END $do$
    `);
    await q(`
        DO $do$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                           WHERE constraint_name = 'users_department_id_fkey') THEN
                ALTER TABLE users ADD CONSTRAINT users_department_id_fkey
                    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
            END IF;
        END $do$
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS time_entries (
            id              SERIAL PRIMARY KEY,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            entry_type      TEXT NOT NULL CHECK(entry_type IN ('clock_in','break_start','break_end','clock_out')),
            timestamp       TIMESTAMPTZ DEFAULT NOW(),
            work_mode       TEXT CHECK(work_mode IN ('office','remote','hybrid')),
            is_manual       BOOLEAN NOT NULL DEFAULT FALSE,
            approval_status TEXT NOT NULL DEFAULT 'approved'
                                CHECK(approval_status IN ('pending','approved','rejected')),
            approved_by     INTEGER REFERENCES users(id) ON DELETE SET NULL
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_time_entries_user   ON time_entries(user_id);
        CREATE INDEX IF NOT EXISTS idx_time_entries_ts     ON time_entries(user_id, timestamp);
        CREATE INDEX IF NOT EXISTS idx_time_entries_manual ON time_entries(user_id, is_manual, approval_status);
    `);

    // Migration: attendance-verification capture fields on the clock-in entry.
    // Recorded on the clock_in row only; break/clock_out rows leave these NULL.
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_lat DOUBLE PRECISION`);
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_lng DOUBLE PRECISION`);
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_accuracy_m REAL`);
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_distance_m INTEGER`);
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS face_verified BOOLEAN`);
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS face_match_score REAL`);
    // Wi-Fi-first verification audit columns (Stage 7).
    // `verified_via` is 'wifi' | 'geofence' | 'none' (NULL for pre-feature rows).
    // `clock_in_wifi_bssid` records the BSSID that was matched (when wifi).
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS verified_via TEXT`);
    await q(`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS clock_in_wifi_bssid TEXT`);

    await q(`
        CREATE TABLE IF NOT EXISTS leaves (
            id            SERIAL PRIMARY KEY,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date          TEXT NOT NULL,
            leave_type    TEXT NOT NULL CHECK(leave_type IN ('sick','holiday','planned','personal','other')),
            reason        TEXT,
            status        TEXT NOT NULL DEFAULT 'pending'
                              CHECK(status IN ('pending','approved','rejected','withdraw_pending','revoked')),
            duration      TEXT NOT NULL DEFAULT 'full' CHECK(duration IN ('full','half','quarter')),
            approved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at   TIMESTAMPTZ,
            reject_reason TEXT,
            created_at    TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Migration: add created_at to existing leaves tables
    await q(`ALTER TABLE leaves ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
    // Migration: update leaves status constraint to include 'revoked'
    await q(`
        DO $do$ BEGIN
            ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_status_check;
            ALTER TABLE leaves ADD CONSTRAINT leaves_status_check
                CHECK(status IN ('pending','approved','rejected','withdraw_pending','revoked'));
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);
    // Migration: drop the hard-coded leave_type CHECK so organisations can define
    // their own custom leave types via leave_policies. Allowed types are now
    // governed at the application layer (must exist in leave_policies for the org).
    //
    // We do this in two ways for safety:
    //   1. The well-known default constraint name `leaves_leave_type_check`.
    //   2. ANY remaining CHECK constraint on the `leave_type` column —
    //      handles tenants whose DB was bootstrapped under a different
    //      constraint name (custom ALTER TABLE ADD CONSTRAINT ... etc).
    await q(`
        DO $do$ BEGIN
            ALTER TABLE leaves DROP CONSTRAINT IF EXISTS leaves_leave_type_check;
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);
    await q(`
        DO $do$
        DECLARE r record;
        BEGIN
            FOR r IN
                SELECT con.conname
                FROM   pg_constraint con
                JOIN   pg_class       rel ON rel.oid = con.conrelid
                JOIN   pg_attribute   att ON att.attrelid = rel.oid
                                         AND att.attnum   = ANY(con.conkey)
                WHERE  rel.relname = 'leaves'
                  AND  con.contype = 'c'
                  AND  att.attname = 'leave_type'
            LOOP
                EXECUTE 'ALTER TABLE leaves DROP CONSTRAINT ' || quote_ident(r.conname);
            END LOOP;
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_leaves_status ON leaves(user_id, status, date)`);

    await q(`
        CREATE TABLE IF NOT EXISTS tasks (
            id           SERIAL PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            date         TEXT,
            title        TEXT NOT NULL,
            description  TEXT,
            priority     TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')),
            status       TEXT NOT NULL DEFAULT 'pending'
                             CHECK(status IN ('pending','in_progress','in_review','done')),
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            assigned_to  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            due_date     TEXT,
            sprint_id    INTEGER
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_tasks_user_date   ON tasks(user_id, date);
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to, date);
    `);
    // Migration: add org_id to tasks for tenant isolation
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_tasks_org ON tasks(org_id)`);
    // Backfill org_id from the task owner's org
    await q(`UPDATE tasks t SET org_id = u.org_id FROM users u WHERE u.id = t.user_id AND t.org_id IS NULL AND u.org_id IS NOT NULL`);
    // Migration: add service_desk_ticket_id to tasks for linking service desk tickets to backlog
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS service_desk_ticket_id INTEGER`);
    await q(`CREATE INDEX IF NOT EXISTS idx_tasks_service_desk ON tasks(service_desk_ticket_id) WHERE service_desk_ticket_id IS NOT NULL`);
    // Migration: update role CHECK to include platform_admin on existing databases
    await q(`
        DO $do$ BEGIN
            ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
            ALTER TABLE users ADD CONSTRAINT users_role_check
                CHECK(role IN ('employee','team_lead','manager','hr_admin','super_admin','platform_admin'));
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);

    // Migration: drop the hard-coded tasks.status CHECK so tenants can introduce
    // custom workflow state keys via workflow_states. Status is now a mirror of
    // the workflow state key; integrity is enforced at the application layer
    // (the value must match an existing workflow_states.key for the org).
    await q(`
        DO $do$
        DECLARE r record;
        BEGIN
            FOR r IN
                SELECT con.conname
                FROM   pg_constraint con
                JOIN   pg_class       rel ON rel.oid = con.conrelid
                JOIN   pg_attribute   att ON att.attrelid = rel.oid
                                         AND att.attnum   = ANY(con.conkey)
                WHERE  rel.relname = 'tasks'
                  AND  con.contype = 'c'
                  AND  att.attname = 'status'
            LOOP
                EXECUTE 'ALTER TABLE tasks DROP CONSTRAINT ' || quote_ident(r.conname);
            END LOOP;
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token      TEXT UNIQUE NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used       BOOLEAN NOT NULL DEFAULT FALSE
        )
    `);

    // Active sessions – max 2 per user
    await q(`
        CREATE TABLE IF NOT EXISTS user_sessions (
            id         TEXT PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            device     TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id)`);

    await q(`
        CREATE TABLE IF NOT EXISTS sprints (
            id         SERIAL PRIMARY KEY,
            team_id    INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            start_date TEXT NOT NULL,
            end_date   TEXT NOT NULL,
            status     TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','paused','completed')),
            goal       TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(team_id, name)
        )
    `);
    // Migration: lifecycle + auto-management columns for the sprint scheduler.
    //   - started_at / completed_at / velocity_points pre-date this change but
    //     are recreated here defensively for older tenants.
    //   - paused_at        — when an active sprint was paused (NULL otherwise).
    //   - auto_managed      — TRUE for sprints created/rotated by the scheduler.
    //   - sprint_number     — running index within a team for auto sprints.
    //   - carried_from_sprint_id — origin link when a sprint inherits rolled-
    //     over (incomplete) tickets from the previous sprint, surfaced in the
    //     Sprint Insights "Carried Forward" panel.
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ`);
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS velocity_points NUMERIC(8,2)`);
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ`);
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS auto_managed BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS sprint_number INTEGER`);
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS carried_from_sprint_id INTEGER`);
    // Migration: relax the status CHECK to include 'paused' on existing tenants.
    await q(`
        DO $do$ BEGIN
            ALTER TABLE sprints DROP CONSTRAINT IF EXISTS sprints_status_check;
            ALTER TABLE sprints ADD CONSTRAINT sprints_status_check
                CHECK(status IN ('planned','active','paused','completed'));
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);
    // Self-referential FK for the rollover origin link (deferred — added once
    // the table exists so re-runs are safe).
    await q(`
        DO $do$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                           WHERE constraint_name = 'sprints_carried_from_fkey') THEN
                ALTER TABLE sprints ADD CONSTRAINT sprints_carried_from_fkey
                    FOREIGN KEY (carried_from_sprint_id) REFERENCES sprints(id) ON DELETE SET NULL;
            END IF;
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);
    // Unique running number per team for auto-managed sprints (lets the
    // scheduler upsert the current window without creating duplicates).
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_sprints_team_number ON sprints(team_id, sprint_number) WHERE sprint_number IS NOT NULL`);

    // Deferred FK from tasks -> sprints
    await q(`
        DO $do$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints
                           WHERE constraint_name = 'tasks_sprint_id_fkey') THEN
                ALTER TABLE tasks ADD CONSTRAINT tasks_sprint_id_fkey
                    FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL;
            END IF;
        END $do$
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS leave_policies (
            id                   SERIAL PRIMARY KEY,
            org_id               INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            leave_type           TEXT NOT NULL,
            name                 TEXT,
            color                TEXT DEFAULT '#6366f1',
            annual_quota         NUMERIC NOT NULL DEFAULT 0,
            accrual_type         TEXT NOT NULL DEFAULT 'annual',
            carry_forward_limit  NUMERIC NOT NULL DEFAULT 0,
            half_day_allowed     BOOLEAN NOT NULL DEFAULT FALSE,
            quarter_day_allowed  BOOLEAN NOT NULL DEFAULT FALSE
        )
    `);
    // Migration: add name/color to existing leave_policies tables
    await q(`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS name TEXT`);
    await q(`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS color TEXT DEFAULT '#6366f1'`);

    // Migration: collapse any duplicate (org_id, leave_type) rows down to a
    // single canonical row before installing the UNIQUE constraint below.
    // The oldest id wins; duplicates are deleted. This is idempotent — once
    // there are no duplicates left it's a NO-OP.
    await q(`
        DELETE FROM leave_policies a
         USING leave_policies b
         WHERE a.org_id     = b.org_id
           AND a.leave_type = b.leave_type
           AND a.id         > b.id
    `);
    // Migration: enforce one policy per (org_id, leave_type). Wrapped in a DO
    // block so re-running on databases that already have the constraint is a
    // safe NO-OP.
    await q(`
        DO $do$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                 WHERE conname = 'leave_policies_org_leave_type_key'
            ) THEN
                ALTER TABLE leave_policies
                    ADD CONSTRAINT leave_policies_org_leave_type_key
                    UNIQUE (org_id, leave_type);
            END IF;
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS leave_balances (
            id              SERIAL PRIMARY KEY,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            leave_type      TEXT NOT NULL,
            year            INTEGER NOT NULL,
            quota           NUMERIC NOT NULL DEFAULT 0,
            used            NUMERIC NOT NULL DEFAULT 0,
            carried_forward NUMERIC NOT NULL DEFAULT 0,
            UNIQUE(user_id, leave_type, year)
        )
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS holidays (
            id          SERIAL PRIMARY KEY,
            org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            date        TEXT NOT NULL,
            name        TEXT NOT NULL,
            is_optional BOOLEAN NOT NULL DEFAULT FALSE,
            UNIQUE(org_id, date)
        )
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS approval_requests (
            id            SERIAL PRIMARY KEY,
            org_id        INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
            requester_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            approver_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            type          TEXT NOT NULL CHECK(type IN ('leave','manual_entry','overtime','leave_withdraw')),
            reference_id  INTEGER,
            status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
            reason        TEXT,
            reject_reason TEXT,
            metadata      TEXT,
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            reviewed_at   TIMESTAMPTZ
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_approval_requester   ON approval_requests(requester_id, status);
        CREATE INDEX IF NOT EXISTS idx_approval_approver    ON approval_requests(approver_id, status);
        CREATE INDEX IF NOT EXISTS idx_approval_type_status ON approval_requests(type, status);
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS role_change_requests (
            id              SERIAL PRIMARY KEY,
            org_id          INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
            target_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            requested_by    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            from_role       TEXT NOT NULL,
            to_role         TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','cancelled')),
            reason          TEXT,
            reject_reason   TEXT,
            rejected_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
            approvals       JSONB NOT NULL DEFAULT '{}',
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            resolved_at     TIMESTAMPTZ
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_role_change_org_status ON role_change_requests(org_id, status);
        CREATE INDEX IF NOT EXISTS idx_role_change_target     ON role_change_requests(target_user_id, status);
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id          SERIAL PRIMARY KEY,
            org_id      INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
            actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            action      TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id   INTEGER,
            details     TEXT,
            ip_address  TEXT,
            user_agent  TEXT,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Migration: add org_id to existing audit_logs tables that pre-date tenant isolation
    await q(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL`);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_org    ON audit_logs(org_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS invite_codes (
            id          SERIAL PRIMARY KEY,
            code        TEXT UNIQUE NOT NULL,
            created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            org_id      INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
            role        TEXT NOT NULL DEFAULT 'employee',
            max_uses    INTEGER NOT NULL DEFAULT 1,
            used_count  INTEGER NOT NULL DEFAULT 0,
            expires_at  TIMESTAMPTZ,
            is_active   BOOLEAN NOT NULL DEFAULT TRUE,
            created_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS task_labels (
            id         SERIAL PRIMARY KEY,
            org_id     INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
            name       TEXT NOT NULL,
            color      TEXT NOT NULL DEFAULT '#6366f1',
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, name)
        )
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS task_label_map (
            task_id  INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            label_id INTEGER NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
            PRIMARY KEY (task_id, label_id)
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_task_label_map_task  ON task_label_map(task_id);
        CREATE INDEX IF NOT EXISTS idx_task_label_map_label ON task_label_map(label_id);
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS task_comments (
            id         SERIAL PRIMARY KEY,
            task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content    TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id, created_at)`);
    // File attachments on comments (image/doc). Either content or a file may
    // be present, so content is no longer required at the DB level.
    await q(`ALTER TABLE task_comments ALTER COLUMN content DROP NOT NULL`);
    await q(`ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_url   TEXT`);
    await q(`ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_name  VARCHAR(255)`);
    await q(`ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_type  VARCHAR(100)`);
    await q(`ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS file_size  INTEGER`);

}

export { initializeCoreTenantSchema };
