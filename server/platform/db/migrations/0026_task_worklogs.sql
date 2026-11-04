-- Estimates retain their legacy names until ticket 04. Time spent is read,
-- never written: source_timer_id makes conversion safe even without the ledger.
CREATE TABLE IF NOT EXISTS task_worklogs (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id),
    logged_by_id INTEGER NOT NULL REFERENCES users(id),
    day_worked DATE NOT NULL,
    start_time TIME,
    minutes INTEGER NOT NULL CHECK (minutes > 0),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    source_timer_id INTEGER UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_task_worklogs_ticket
    ON task_worklogs (task_id, day_worked DESC, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_worklogs_author_day
    ON task_worklogs (author_id, day_worked) WHERE deleted_at IS NULL;

LOCK TABLE task_timers IN SHARE ROW EXCLUSIVE MODE;
UPDATE task_timers
   SET stopped_at = NOW(),
       minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::integer)
 WHERE stopped_at IS NULL;

INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, start_time,
                          minutes, comment, created_at, updated_at, source_timer_id)
SELECT tt.task_id, tt.user_id, tt.user_id,
       (tt.started_at AT TIME ZONE COALESCE(NULLIF(o.timezone, ''), 'UTC'))::date,
       (tt.started_at AT TIME ZONE COALESCE(NULLIF(o.timezone, ''), 'UTC'))::time,
       GREATEST(1, COALESCE(tt.minutes, ROUND(EXTRACT(EPOCH FROM (tt.stopped_at - tt.started_at)) / 60)::integer)),
       'Migrated from timer', tt.stopped_at, tt.stopped_at, tt.id
  FROM task_timers tt
  JOIN tasks t ON t.id = tt.task_id
  JOIN users u ON u.id = tt.user_id
  LEFT JOIN organizations o ON o.id = COALESCE(t.org_id, u.org_id)
 WHERE tt.stopped_at IS NOT NULL
ON CONFLICT (source_timer_id) DO NOTHING;
