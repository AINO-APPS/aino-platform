import type { SchemaQuery } from "../schemaTypes";

async function initializeConfigurationTenantSchema(q: SchemaQuery): Promise<void> {
    await q(`
        CREATE TABLE IF NOT EXISTS tenant_roles (
            org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            role_key         TEXT    NOT NULL,
            label            TEXT    NOT NULL,
            description      TEXT,
            color            TEXT    NOT NULL DEFAULT '#6366f1',
            permission_level INTEGER NOT NULL CHECK(permission_level BETWEEN 1 AND 4),
            is_system        BOOLEAN NOT NULL DEFAULT FALSE,
            sort_order       INTEGER NOT NULL DEFAULT 0,
            created_at       TIMESTAMPTZ DEFAULT NOW(),
            updated_at       TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (org_id, role_key)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_tenant_roles_org ON tenant_roles(org_id, permission_level)`);

    // Migration: drop the old tenant_role_labels table from the previous
    // iteration (it stored only labels, no permission_level). Idempotent.
    await q(`DROP TABLE IF EXISTS tenant_role_labels CASCADE`);

    // Seed canonical system roles for every org that doesn't yet have any.
    await q(`
        DO $do$
        DECLARE rec RECORD;
        BEGIN
            FOR rec IN SELECT id FROM organizations LOOP
                IF NOT EXISTS (SELECT 1 FROM tenant_roles WHERE org_id = rec.id) THEN
                    INSERT INTO tenant_roles (org_id, role_key, label, description, color, permission_level, is_system, sort_order)
                    VALUES
                        (rec.id, 'employee',  'Employee',  'Standard team member.',                                              '#6b7280', 1, TRUE, 1),
                        (rec.id, 'team_lead', 'Team Lead', 'Leads a single team, can review their team''s work.',                '#0ea5e9', 2, TRUE, 2),
                        (rec.id, 'manager',   'Manager',   'Manages a department; approves leaves and tasks.',                   '#8b5cf6', 3, TRUE, 3),
                        (rec.id, 'hr_admin',  'HR Admin',  'People-ops: invites, removes, manages org members.',                 '#f59e0b', 4, TRUE, 4)
                    ON CONFLICT (org_id, role_key) DO NOTHING;
                END IF;
            END LOOP;
        END $do$;
    `);

    // Migration: drop the hardcoded users.role CHECK so tenants can use
    // custom role keys. Integrity is now enforced at the application layer
    // (the role must exist in tenant_roles for the org, OR be one of the
    // two system roles super_admin / platform_admin).
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
                WHERE  rel.relname = 'users'
                  AND  con.contype = 'c'
                  AND  att.attname = 'role'
            LOOP
                EXECUTE 'ALTER TABLE users DROP CONSTRAINT ' || quote_ident(r.conname);
            END LOOP;
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);

    // ---- Collaborative Notes (Yjs CRDT state per page) ----
    await q(`
        CREATE TABLE IF NOT EXISTS notebook_pages (
            page_id    TEXT PRIMARY KEY,
            tenant_id  INTEGER NOT NULL DEFAULT 0,
            yjs_state  BYTEA,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_nb_pages_tenant ON notebook_pages(tenant_id)
    `);

    // ---- Note ↔ Entity links (Tier 6 integrations) ----
    await q(`
        CREATE TABLE IF NOT EXISTS note_links (
            id           SERIAL PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            page_id      TEXT NOT NULL,
            entity_type  TEXT NOT NULL CHECK(entity_type IN ('task','calendar_event','meeting')),
            entity_id    INTEGER NOT NULL,
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(page_id, entity_type, entity_id)
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_note_links_page   ON note_links(page_id);
        CREATE INDEX IF NOT EXISTS idx_note_links_entity ON note_links(entity_type, entity_id);
    `);

    // ─────────────────────────────────────────────────────────────────────
    // AGILE: tenant-customisable Work Item Types, Workflow States,
    // Story Points scale, Epics, Acceptance Criteria, Dependencies,
    // Sprint Retrospectives, plus a request/grant access-control model
    // for who can edit Agile settings.
    // ─────────────────────────────────────────────────────────────────────

    // Org-wide agile settings (singleton row per org)
    await q(`
        CREATE TABLE IF NOT EXISTS org_agile_settings (
            org_id                      INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
            estimation_type             TEXT NOT NULL DEFAULT 'fibonacci'
                CHECK(estimation_type IN ('fibonacci','linear','tshirt','hours','none','custom')),
            estimation_values           JSONB NOT NULL DEFAULT '[0.5,1,2,3,5,8,13,21,34]'::jsonb,
            estimation_unit_label       TEXT NOT NULL DEFAULT 'SP',
            priority_scheme             JSONB NOT NULL DEFAULT '[{"key":"low","label":"Low","color":"#10b981"},{"key":"medium","label":"Medium","color":"#f59e0b"},{"key":"high","label":"High","color":"#ef4444"}]'::jsonb,
            enable_story_points         BOOLEAN NOT NULL DEFAULT TRUE,
            enable_epics                BOOLEAN NOT NULL DEFAULT TRUE,
            enable_dependencies         BOOLEAN NOT NULL DEFAULT TRUE,
            enable_acceptance_criteria  BOOLEAN NOT NULL DEFAULT TRUE,
            enable_wip_limits           BOOLEAN NOT NULL DEFAULT FALSE,
            enable_blockers             BOOLEAN NOT NULL DEFAULT TRUE,
            enable_retrospectives       BOOLEAN NOT NULL DEFAULT TRUE,
            require_estimate_for_sprint BOOLEAN NOT NULL DEFAULT FALSE,
            default_dod                 TEXT,
            updated_at                  TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Customisable Work Item Types (Story / Bug / Task / Epic / Spike / ...)
    await q(`
        CREATE TABLE IF NOT EXISTS work_item_types (
            id          SERIAL PRIMARY KEY,
            org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            key         TEXT NOT NULL,
            name        TEXT NOT NULL,
            icon        TEXT,
            color       TEXT NOT NULL DEFAULT '#6366f1',
            description TEXT,
            is_default  BOOLEAN NOT NULL DEFAULT FALSE,
            is_epic     BOOLEAN NOT NULL DEFAULT FALSE,
            is_active   BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, key)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_work_item_types_org ON work_item_types(org_id, is_active, sort_order)`);

    // Customisable Workflow States (Kanban columns).
    // Categories: 'open' | 'in_progress' | 'in_review' | 'done'
    // Every tenant must keep at least one state in each category.
    await q(`
        CREATE TABLE IF NOT EXISTS workflow_states (
            id            SERIAL PRIMARY KEY,
            org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            key           TEXT NOT NULL,
            name          TEXT NOT NULL,
            category      TEXT NOT NULL CHECK(category IN ('open','in_progress','in_review','done')),
            color         TEXT NOT NULL DEFAULT '#6b7280',
            icon          TEXT,
            wip_limit     INTEGER,
            is_initial    BOOLEAN NOT NULL DEFAULT FALSE,
            is_terminal   BOOLEAN NOT NULL DEFAULT FALSE,
            is_active     BOOLEAN NOT NULL DEFAULT TRUE,
            sort_order    INTEGER NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, key)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_workflow_states_org ON workflow_states(org_id, is_active, sort_order)`);

    // Optional: which states apply to which work item types
    await q(`
        CREATE TABLE IF NOT EXISTS workflow_state_type_map (
            state_id INTEGER NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
            type_id  INTEGER NOT NULL REFERENCES work_item_types(id) ON DELETE CASCADE,
            PRIMARY KEY (state_id, type_id)
        )
    `);

    // Allowed transitions between workflow states (governance, optional)
    await q(`
        CREATE TABLE IF NOT EXISTS workflow_transitions (
            id            SERIAL PRIMARY KEY,
            org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            from_state_id INTEGER NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
            to_state_id   INTEGER NOT NULL REFERENCES workflow_states(id) ON DELETE CASCADE,
            required_role TEXT,
            UNIQUE(from_state_id, to_state_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_workflow_transitions_org ON workflow_transitions(org_id)`);

    // Per-team agile overrides (optional, falls back to org)
    await q(`
        CREATE TABLE IF NOT EXISTS team_agile_settings (
            team_id            INTEGER PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
            estimation_type    TEXT,
            estimation_values  JSONB,
            capacity_points    NUMERIC(7,1),
            updated_at         TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Access-control: who else (besides super_admin) can edit Agile settings.
    await q(`
        CREATE TABLE IF NOT EXISTS agile_editor_grants (
            id          SERIAL PRIMARY KEY,
            org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            granted_at  TIMESTAMPTZ DEFAULT NOW(),
            revoked_at  TIMESTAMPTZ,
            UNIQUE(org_id, user_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_agile_grants_active ON agile_editor_grants(org_id, user_id) WHERE revoked_at IS NULL`);

    await q(`
        CREATE TABLE IF NOT EXISTS agile_editor_requests (
            id            SERIAL PRIMARY KEY,
            org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            reason        TEXT,
            status        TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN ('pending','approved','rejected','cancelled')),
            reviewed_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            reviewed_at   TIMESTAMPTZ,
            reject_reason TEXT,
            created_at    TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_agile_requests_status ON agile_editor_requests(org_id, status, created_at)`);

    // Task-level agile fields
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS story_points NUMERIC(6,2)`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_item_type_id INTEGER REFERENCES work_item_types(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS workflow_state_id INTEGER REFERENCES workflow_states(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rank_value NUMERIC(20,10)`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acceptance_criteria JSONB`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS blocked_reason TEXT`);
    // Rollover provenance: when a sprint completes (manually or via the
    // auto-scheduler) any incomplete tickets are moved to the next sprint and
    // stamped with the sprint they came from. The Sprint Insights "Carried
    // Forward" panel reads this to link each carried ticket back to its origin.
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS carried_over_from_sprint_id INTEGER REFERENCES sprints(id) ON DELETE SET NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_tasks_carried_over ON tasks(carried_over_from_sprint_id) WHERE carried_over_from_sprint_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_tasks_workflow_state ON tasks(workflow_state_id) WHERE workflow_state_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_tasks_sprint_points ON tasks(sprint_id) WHERE sprint_id IS NOT NULL`);

    // Task dependencies graph
    await q(`
        CREATE TABLE IF NOT EXISTS task_dependencies (
            id            SERIAL PRIMARY KEY,
            task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            depends_on_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            type          TEXT NOT NULL DEFAULT 'blocks'
                CHECK(type IN ('blocks','relates','duplicates','clones')),
            created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at    TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(task_id, depends_on_id, type)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on ON task_dependencies(depends_on_id)`);

    // Sprint retrospectives — one row per sprint with a Went Well / To Improve
    // / Action Items / Mood / Summary template. The legacy "category/content/
    // votes" placeholder shape (Pass 1) was never wired to a UI; the v3
    // migration in migrationRunner.js drops + recreates it for older tenants.
    // For brand-new tenants we create the canonical shape directly so we don't
    // burn a drop/recreate cycle on first boot.
    await q(`
        CREATE TABLE IF NOT EXISTS sprint_retrospectives (
            id              SERIAL PRIMARY KEY,
            sprint_id       INTEGER NOT NULL UNIQUE REFERENCES sprints(id) ON DELETE CASCADE,
            went_well       TEXT,
            to_improve      TEXT,
            action_items    JSONB DEFAULT '[]'::jsonb,
            team_mood       SMALLINT CHECK (team_mood IS NULL OR team_mood BETWEEN 1 AND 5),
            summary         TEXT,
            created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_retros_sprint ON sprint_retrospectives(sprint_id)`);

    // ─────────────────────────────────────────────────────────────────────
    // Org branding & per-template email overrides.
    //   - org_branding holds logo URL + accent color (one row per org).
    //   - org_email_templates lets admins override the subject + body of any
    //     built-in mailer template (key matches mailer.js `templates` keys).
    //     A missing override row falls back to the built-in template.
    // ─────────────────────────────────────────────────────────────────────
    await q(`
        CREATE TABLE IF NOT EXISTS org_branding (
            org_id        INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
            logo_url      TEXT,
            accent_color  TEXT NOT NULL DEFAULT '#2383e2',
            updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        CREATE TABLE IF NOT EXISTS org_email_templates (
            org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            template_key  TEXT    NOT NULL,
            subject       TEXT    NOT NULL,
            body_html     TEXT    NOT NULL,
            enabled       BOOLEAN NOT NULL DEFAULT TRUE,
            updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_at    TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (org_id, template_key)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_org_email_templates_org ON org_email_templates(org_id)`);

    // ─────────────────────────────────────────────────────────────────────
    // Chunk 6 — Custom fields on tasks.
    //
    // custom_field_definitions: per-org catalog of field defs that admins
    // can configure (text, number, date, select, multiselect, checkbox, url).
    // task_custom_field_values: per-task value rows. We store the value as
    // JSONB so the same row shape works for every field type without an
    // extra column for each.
    //
    // Both tables are scoped by org_id so tenants stay isolated even though
    // they share the same physical DB schema in legacy single-DB mode.
    // ─────────────────────────────────────────────────────────────────────
}

export { initializeConfigurationTenantSchema };
