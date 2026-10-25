-- Per-user timers attributed to a task.
--
-- One running timer per user per task; stopping it writes the elapsed minutes
-- to `tasks.logged_minutes` and the timesheet.
CREATE TABLE IF NOT EXISTS task_timers (
    id          SERIAL PRIMARY KEY,
    task_id     INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    stopped_at  TIMESTAMPTZ,
    minutes     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_timers_running
    ON task_timers (task_id, user_id)
    WHERE stopped_at IS NULL;
-- At most one running timer per user per task, so starting twice is a no-op
-- rather than a second concurrent timer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_timers_running
    ON task_timers (task_id, user_id)
    WHERE stopped_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_task_timers_user_started
    ON task_timers (user_id, started_at);
