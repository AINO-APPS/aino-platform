import type { SchemaQuery } from "../schemaTypes";

async function initializeIntegrationTenantSchema(q: SchemaQuery): Promise<void> {
    await q(`
        CREATE TABLE IF NOT EXISTS custom_field_definitions (
            id              SERIAL PRIMARY KEY,
            org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            key             TEXT    NOT NULL,
            label           TEXT    NOT NULL,
            field_type      TEXT    NOT NULL CHECK(field_type IN
                                ('text','number','date','select','multiselect','checkbox','url')),
            description     TEXT,
            options         JSONB   NOT NULL DEFAULT '[]'::jsonb,
            is_required     BOOLEAN NOT NULL DEFAULT FALSE,
            show_on_card    BOOLEAN NOT NULL DEFAULT FALSE,
            applies_to_types JSONB  NOT NULL DEFAULT '[]'::jsonb,
            sort_order      INTEGER NOT NULL DEFAULT 0,
            is_active       BOOLEAN NOT NULL DEFAULT TRUE,
            created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(org_id, key)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_cfd_org ON custom_field_definitions(org_id, is_active, sort_order)`);

    await q(`
        CREATE TABLE IF NOT EXISTS task_custom_field_values (
            task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            field_id    INTEGER NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
            value       JSONB,
            updated_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
            updated_at  TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (task_id, field_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_tcfv_field ON task_custom_field_values(field_id)`);

    // ─────────────────────────────────────────────────────────────────────
    // Stage 3 — Projects, human-readable task keys, and Git integration.
    //
    //   projects                — Jira-style projects with a unique KEY
    //                             (e.g. PSSPMT). Migration 0019 makes project
    //                             ownership mandatory and stores every ticket
    //                             key on the task row.
    //   org_integrations        — per-org provider config (GitHub for now).
    //   org_integration_secrets — webhook signing secret per integration.
    //   task_git_refs           — branches / PRs / commits linked to a task
    //                             (via the issue key found in branch / PR
    //                             title / commit message).
    // ─────────────────────────────────────────────────────────────────────
    await q(`
        CREATE TABLE IF NOT EXISTS projects (
            id              SERIAL PRIMARY KEY,
            org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            key             TEXT    NOT NULL,
            name            TEXT    NOT NULL,
            description     TEXT,
            color           TEXT    NOT NULL DEFAULT '#6366f1',
            lead_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
            next_task_number INTEGER NOT NULL DEFAULT 1,
            type            TEXT NOT NULL DEFAULT 'task_list'
                                CHECK(type IN ('scrum','kanban','task_list')),
            origin_team_id  INTEGER REFERENCES teams(id) ON DELETE SET NULL,
            key_published   BOOLEAN NOT NULL DEFAULT TRUE,
            is_general      BOOLEAN NOT NULL DEFAULT FALSE,
            is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
            created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (org_id, key)
        )
    `);
    await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'task_list'`);
    await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS origin_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS key_published BOOLEAN NOT NULL DEFAULT TRUE`);
    await q(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_general BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`
        DO $do$ BEGIN
            ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_type_check;
            ALTER TABLE projects ADD CONSTRAINT projects_type_check
                CHECK (type IN ('scrum','kanban','task_list'));
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);
    // Project key must be ALL CAPS + alphanumeric + underscores so it forms
    // a clean prefix for human-readable IDs (PROJ-1, PSSPMT-42).
    await q(`
        DO $do$ BEGIN
            ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_key_format_check;
            ALTER TABLE projects ADD CONSTRAINT projects_key_format_check
                CHECK (key ~ '^[A-Z][A-Z0-9_]{1,9}$');
        EXCEPTION WHEN others THEN NULL;
        END $do$
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id, is_archived)`);

    // Project ownership is expanded by migration 0019. Keep the transitional
    // columns nullable here so initTenantSchema remains safe on old tenants;
    // the migration backfills and then enforces the final constraints.
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT`);
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS ticket_key TEXT`);
    await q(`ALTER TABLE sprints ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE RESTRICT`);
    // `task_number` is the per-project counter. It remains useful for key
    // allocation and lookup; `ticket_key` is the canonical stored identifier.
    await q(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_number INTEGER`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_tasks_project_number ON tasks(project_id, task_number) WHERE project_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id) WHERE project_id IS NOT NULL`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_org_origin_team ON projects(org_id, origin_team_id) WHERE origin_team_id IS NOT NULL`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_org_general ON projects(org_id) WHERE is_general = TRUE`);

    await q(`
        CREATE TABLE IF NOT EXISTS project_members (
            id          SERIAL PRIMARY KEY,
            project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
            team_id     INTEGER REFERENCES teams(id) ON DELETE CASCADE,
            role        TEXT NOT NULL CHECK (role IN ('project_admin','member','viewer')),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CHECK ((user_id IS NULL) <> (team_id IS NULL)),
            UNIQUE (project_id, user_id),
            UNIQUE (project_id, team_id)
        )
    `);
    await q(`
        CREATE TABLE IF NOT EXISTS ticket_key_aliases (
            id          SERIAL PRIMARY KEY,
            org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            key         TEXT NOT NULL,
            task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            reason      TEXT NOT NULL CHECK (reason IN ('migration','move','rename')),
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (org_id, key)
        )
    `);
    await q(`
        CREATE TABLE IF NOT EXISTS reserved_project_keys (
            org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            key          TEXT NOT NULL,
            reason       TEXT NOT NULL DEFAULT 'project',
            reserved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (org_id, key)
        )
    `);
    await q(`
        CREATE TABLE IF NOT EXISTS project_migration_moves (
            task_id           INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
            sprint_id         INTEGER REFERENCES sprints(id) ON DELETE SET NULL,
            from_project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            to_project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
            old_key           TEXT,
            new_key           TEXT NOT NULL,
            moved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id) WHERE user_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_project_members_team ON project_members(team_id) WHERE team_id IS NOT NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_ticket_key_alias_task ON ticket_key_aliases(task_id) WHERE task_id IS NOT NULL`);

    await q(`
        DO $do$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint
                            WHERE conname = 'organizations_service_desk_project_id_fkey'
                              AND conrelid = 'organizations'::regclass) THEN
                ALTER TABLE organizations
                    ADD CONSTRAINT organizations_service_desk_project_id_fkey
                    FOREIGN KEY (service_desk_project_id) REFERENCES projects(id) ON DELETE SET NULL;
            END IF;
        END $do$
    `);


    // Per-org integrations catalog. `provider` is constrained to known values
    // (currently 'github' / 'gitlab' / 'bitbucket') so we can route webhook
    // payloads. The `config` JSONB holds non-secret config (org/owner name,
    // installation id, base url). The secret (webhook signing key, OAuth
    // token) lives in `org_integration_secrets` so it never gets serialised
    // back to the client.
    await q(`
        CREATE TABLE IF NOT EXISTS org_integrations (
            id           SERIAL PRIMARY KEY,
            org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            provider     TEXT    NOT NULL CHECK (provider IN ('github','gitlab','bitbucket')),
            config       JSONB   NOT NULL DEFAULT '{}'::jsonb,
            is_active    BOOLEAN NOT NULL DEFAULT TRUE,
            created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at   TIMESTAMPTZ DEFAULT NOW(),
            updated_at   TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (org_id, provider)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_integrations_org ON org_integrations(org_id, is_active)`);

    await q(`
        CREATE TABLE IF NOT EXISTS org_integration_secrets (
            integration_id   INTEGER PRIMARY KEY REFERENCES org_integrations(id) ON DELETE CASCADE,
            webhook_secret   TEXT,
            access_token     TEXT,
            refresh_token    TEXT,
            token_expires_at TIMESTAMPTZ,
            updated_at       TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    // Git refs (branches, PRs, commits) discovered by webhook payloads and
    // linked to a task by matching the human-readable key in the branch
    // name / PR title / commit message. `ref_type` distinguishes the kind
    // of artifact; `status` carries the current state (open / merged /
    // closed / committed) so the UI can render the timeline:
    //   "branch created → PR opened → PR merged".
    //
    // `external_id` is whatever id the provider uses (PR number, commit sha)
    // so we can dedupe + look up by source.
    await q(`
        CREATE TABLE IF NOT EXISTS task_git_refs (
            id              SERIAL PRIMARY KEY,
            task_id         INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            integration_id  INTEGER REFERENCES org_integrations(id) ON DELETE SET NULL,
            ref_type        TEXT NOT NULL CHECK (ref_type IN ('branch','pull_request','commit')),
            status          TEXT NOT NULL DEFAULT 'open'
                                 CHECK (status IN ('open','merged','closed','draft','committed')),
            external_id     TEXT,         -- pr number, commit sha, branch name
            title           TEXT,
            url             TEXT,
            repository      TEXT,
            ref_name        TEXT,         -- branch name (for branch + PR rows)
            author_login    TEXT,
            commit_sha      TEXT,         -- head sha (PR) or full sha (commit)
            payload         JSONB,        -- raw webhook payload for debugging
            event_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (task_id, ref_type, external_id, repository)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_git_refs_task ON task_git_refs(task_id, event_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_git_refs_status ON task_git_refs(status) WHERE status != 'merged'`);

    // GitHub repos connected via OAuth. We persist the GitHub-side hook id
    // for every repo so disconnecting removes the webhook on GitHub instead
    // of leaving a dangling delivery destination. `full_name` is the
    // canonical owner/repo string (e.g. "AINO-APPS/aino-platform").
    await q(`
        CREATE TABLE IF NOT EXISTS github_repo_connections (
            id              SERIAL PRIMARY KEY,
            integration_id  INTEGER NOT NULL REFERENCES org_integrations(id) ON DELETE CASCADE,
            full_name       TEXT    NOT NULL,
            html_url        TEXT,
            default_branch  TEXT,
            hook_id         BIGINT,
            is_active       BOOLEAN NOT NULL DEFAULT TRUE,
            created_at      TIMESTAMPTZ DEFAULT NOW(),
            updated_at      TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (integration_id, full_name)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_gh_repo_conn_integration ON github_repo_connections(integration_id, is_active)`);

    // GitHub OAuth identity for the connecting user. We surface the login /
    // avatar in the integrations UI so admins know which account installed
    // the connection (and can spot a stale connection to a person who left
    // the team).
    await q(`ALTER TABLE org_integration_secrets ADD COLUMN IF NOT EXISTS github_login TEXT`);
    await q(`ALTER TABLE org_integration_secrets ADD COLUMN IF NOT EXISTS github_avatar TEXT`);
    await q(`ALTER TABLE org_integration_secrets ADD COLUMN IF NOT EXISTS scopes TEXT`);

}

export { initializeIntegrationTenantSchema };
