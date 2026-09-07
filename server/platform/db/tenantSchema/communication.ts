import type { SchemaQuery } from "../schemaTypes";

async function initializeCommunicationTenantSchema(q: SchemaQuery): Promise<void> {
    await q(`
        CREATE TABLE IF NOT EXISTS task_history (
            id         SERIAL PRIMARY KEY,
            task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            action     TEXT NOT NULL,
            field      TEXT,
            old_value  TEXT,
            new_value  TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id, created_at)`);

    await q(`
        CREATE TABLE IF NOT EXISTS notebooks (
            user_id    INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            data       TEXT NOT NULL DEFAULT '{}',
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS calendar_events (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            org_id      INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
            title       TEXT NOT NULL,
            description TEXT,
            start_time  TIMESTAMPTZ NOT NULL,
            end_time    TIMESTAMPTZ NOT NULL,
            all_day     BOOLEAN NOT NULL DEFAULT FALSE,
            color       TEXT DEFAULT '#6366f1',
            task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_cal_events_user_time ON calendar_events(user_id, start_time, end_time);
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS notebook_history (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            page_id    TEXT NOT NULL,
            page_title TEXT,
            content    TEXT,
            saved_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_nb_history_page ON notebook_history(user_id, page_id, saved_at DESC)
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS notifications (
            id           SERIAL PRIMARY KEY,
            user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            type         TEXT NOT NULL,
            title        TEXT NOT NULL,
            body         TEXT,
            link_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
            is_read      BOOLEAN NOT NULL DEFAULT FALSE,
            created_at   TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC)
    `);
    await q(`
        CREATE TABLE IF NOT EXISTS notification_metric_events (
            id                SERIAL PRIMARY KEY,
            client_event_id   TEXT NOT NULL UNIQUE,
            user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            dedupe_key        TEXT,
            conversation_id   TEXT,
            message_id        TEXT,
            notification_type TEXT,
            level             TEXT NOT NULL DEFAULT 'INFO',
            event             TEXT NOT NULL,
            state             TEXT,
            source            TEXT,
            duration_ms       INTEGER,
            error_hash        TEXT,
            metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
            client_timestamp  TIMESTAMPTZ NOT NULL,
            received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_notification_metric_events_timestamp
        ON notification_metric_events(client_timestamp DESC)
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_notification_metric_events_dedupe
        ON notification_metric_events(dedupe_key)
        WHERE dedupe_key IS NOT NULL
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_notification_metric_events_state
        ON notification_metric_events(state, client_timestamp DESC)
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_notification_metric_events_user
        ON notification_metric_events(user_id, client_timestamp DESC)
    `);

    // ---- Chat / Direct Messages ----
    await q(`
        CREATE TABLE IF NOT EXISTS conversations (
            id          SERIAL PRIMARY KEY,
            org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name        VARCHAR(100),
            is_group    BOOLEAN NOT NULL DEFAULT FALSE,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            updated_at  TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS name VARCHAR(100)`);
    await q(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);

    await q(`
        CREATE TABLE IF NOT EXISTS conversation_participants (
            conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            PRIMARY KEY (conversation_id, user_id)
        )
    `);
    await q(`
        CREATE INDEX IF NOT EXISTS idx_conv_participants_user ON conversation_participants(user_id)
    `);
    await q(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_favourite BOOLEAN NOT NULL DEFAULT FALSE`);
    // Signal-parity per-participant conversation flags (mobile long-press
    // action sheet): mute notifications and archive a conversation.
    await q(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_muted BOOLEAN NOT NULL DEFAULT FALSE`);
    await q(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE`);

    // ─────────────────────────────────────────────────────────────────────
    // Group-chat enhancements (Slack-style): local roles, group metadata,
    // post/add policies, notification granularity, and huddle (group call)
    // state. All ALTERs are idempotent so they're safe to re-run.
    //
    // Hybrid permission model: the local `role` here (owner/admin/member)
    // governs day-to-day group actions; org-wide RBAC (users.role / roleLevel
    // in middleware/rbac.ts) provides a governance override for moderation.
    // ─────────────────────────────────────────────────────────────────────

    // Local conversation role for group members.
    await q(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'`);
    await q(`
        DO $do$ BEGIN
            ALTER TABLE conversation_participants DROP CONSTRAINT IF EXISTS conversation_participants_role_check;
            ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_role_check
                CHECK (role IN ('owner','admin','member'));
        EXCEPTION WHEN others THEN NULL;
        END $do$;
    `);

    // Per-participant notification granularity (extends the boolean is_muted).
    //   all      → notify on every message (default)
    //   mentions → notify only when @mentioned
    //   none     → never notify
    await q(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS notify_level TEXT NOT NULL DEFAULT 'all'`);
    await q(`
        DO $do$ BEGIN
            ALTER TABLE conversation_participants DROP CONSTRAINT IF EXISTS conversation_participants_notify_level_check;
            ALTER TABLE conversation_participants ADD CONSTRAINT conversation_participants_notify_level_check
                CHECK (notify_level IN ('all','mentions','none'));
        EXCEPTION WHEN others THEN NULL;
        END $do$;
    `);
    // Timed mute — when set and in the future, suppress notifications until it.
    await q(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ`);

    // Group metadata.
    await q(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS avatar TEXT`);
    await q(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS description TEXT`);
    // Who may post: 'all' members, or 'admins' only.
    await q(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS post_policy TEXT NOT NULL DEFAULT 'all'`);
    await q(`
        DO $do$ BEGIN
            ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_post_policy_check;
            ALTER TABLE conversations ADD CONSTRAINT conversations_post_policy_check
                CHECK (post_policy IN ('all','admins'));
        EXCEPTION WHEN others THEN NULL;
        END $do$;
    `);
    // Who may add members: 'all' members, or 'admins' only (default admins).
    await q(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS add_policy TEXT NOT NULL DEFAULT 'admins'`);
    await q(`
        DO $do$ BEGIN
            ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_add_policy_check;
            ALTER TABLE conversations ADD CONSTRAINT conversations_add_policy_check
                CHECK (add_policy IN ('all','admins'));
        EXCEPTION WHEN others THEN NULL;
        END $do$;
    `);

    // Backfill: existing group creators become owners; everyone else stays
    // 'member'. Safe to re-run (only flips rows that aren't already owner).
    await q(`
        UPDATE conversation_participants cp
           SET role = 'owner'
          FROM conversations c
         WHERE c.id = cp.conversation_id
           AND c.is_group = TRUE
           AND c.created_by = cp.user_id
           AND cp.role <> 'owner'
    `);

    await q(`
        CREATE TABLE IF NOT EXISTS messages (
            id              SERIAL PRIMARY KEY,
            conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content         TEXT,
            reply_to_id     INTEGER REFERENCES messages(id) ON DELETE SET NULL,
            file_url        TEXT,
            file_name       VARCHAR(255),
            file_type       VARCHAR(50),
            file_size        INTEGER,
            edited_at       TIMESTAMPTZ,
            deleted_at      TIMESTAMPTZ,
            forwarded_from_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
            pinned_at       TIMESTAMPTZ,
            pinned_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at      TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    // Migrate existing messages tables
    await q(`ALTER TABLE messages ALTER COLUMN content DROP NOT NULL`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES messages(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_url TEXT`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_name VARCHAR(255)`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_type VARCHAR(50)`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size INTEGER`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS forwarded_from_id INTEGER REFERENCES messages(id) ON DELETE SET NULL`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ`);
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS pinned_by INTEGER REFERENCES users(id) ON DELETE SET NULL`);
    // Link previews (Signal parity): the SENDER generates the preview (title /
    // description / image / site name) and it travels WITH the message, so
    // recipients never fetch the URL themselves. Stored as a small JSONB blob:
    //   { url, title, description, image, siteName }
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS link_preview JSONB`);
    // client_msg_id powers the at-least-once delivery story for in-meeting
    // chat (and any future chat surface). The migration runner also adds
    // this column on existing tenants; declaring it here keeps fresh
    // tenants self-consistent and lets the WS handler always issue its
    // `INSERT ... ON CONFLICT DO NOTHING` against a real column + index.
    await q(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_msg_id TEXT`);
    await q(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_msg_id
        ON messages (conversation_id, sender_id, client_msg_id)
        WHERE client_msg_id IS NOT NULL
    `);

    await q(`
        CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at DESC)
    `);
    await q(`
        CREATE TABLE IF NOT EXISTS chat_media_jobs (
            id                SERIAL PRIMARY KEY,
            message_id        INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE UNIQUE,
            conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            sender_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status            TEXT NOT NULL DEFAULT 'queued'
                                CHECK (status IN ('queued','processing','completed','failed','cancelled')),
            stage             TEXT NOT NULL DEFAULT 'queued'
                                CHECK (stage IN ('queued','prepare','transform','upload','finalize','completed','failed','cancelled')),
            progress          INTEGER NOT NULL DEFAULT 0,
            attempts          INTEGER NOT NULL DEFAULT 0,
            failure_reason    TEXT,
            checksum_sha256   TEXT,
            resumable_token   TEXT,
            pipeline_meta     JSONB NOT NULL DEFAULT '{}'::jsonb,
            cancel_requested  BOOLEAN NOT NULL DEFAULT FALSE,
            created_at        TIMESTAMPTZ DEFAULT NOW(),
            updated_at        TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await q(`ALTER TABLE chat_media_jobs ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'queued'`);
    await q(`ALTER TABLE chat_media_jobs ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT`);
    await q(`ALTER TABLE chat_media_jobs ADD COLUMN IF NOT EXISTS resumable_token TEXT`);
    await q(`ALTER TABLE chat_media_jobs ADD COLUMN IF NOT EXISTS pipeline_meta JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await q(`CREATE INDEX IF NOT EXISTS idx_chat_media_jobs_conv ON chat_media_jobs(conversation_id, created_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS idx_chat_media_jobs_sender ON chat_media_jobs(sender_id, created_at DESC)`);
    await q(`
        CREATE TABLE IF NOT EXISTS message_reads (
            conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            last_read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (conversation_id, user_id)
        )
    `);

    // ---- Message Reactions ----
    await q(`
        CREATE TABLE IF NOT EXISTS message_reactions (
            id          SERIAL PRIMARY KEY,
            message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            emoji       VARCHAR(20) NOT NULL,
            created_at  TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE (message_id, user_id, emoji)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id)`);

    // Presence tracking
    await q(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);

    // Full-text search index on messages
    await q(`CREATE INDEX IF NOT EXISTS idx_messages_search ON messages USING gin(to_tsvector('english', COALESCE(content, '')))`);

    // The message-page query self-joins `messages rm ON rm.id = m.reply_to_id`
    // to inline the quoted parent. Partial — most messages aren't replies.
    await q(`CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL`);

    // ---- Starred Messages ----
    await q(`
        CREATE TABLE IF NOT EXISTS starred_messages (
            user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (user_id, message_id)
        )
    `);
    // The message-page query LEFT JOINs starred_messages on message_id (with a
    // user_id filter). The PK is (user_id, message_id), so message_id is NOT a
    // leading column and the join could not use it — add the reverse index.
    await q(`CREATE INDEX IF NOT EXISTS idx_starred_messages_message ON starred_messages(message_id)`);

    // ---- Blocked Users (Signal parity) ----
    // Directional block list: blocker_id blocks blocked_id. Enforcement lives
    // at the application layer (message send, call initiate, typing fan-out,
    // push dispatch) — a block in EITHER direction stops direct-message
    // delivery between the pair. Group messages are NOT filtered (matching
    // Signal, where blocked users' group messages still appear).
    await q(`
        CREATE TABLE IF NOT EXISTS blocked_users (
            blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (blocker_id, blocked_id)
        )
    `);
    await q(`CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id)`);

}

export { initializeCommunicationTenantSchema };
