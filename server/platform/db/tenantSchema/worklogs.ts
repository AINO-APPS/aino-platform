import type { SchemaQuery } from "../schemaTypes";

export async function initializeWorklogSchema(q: SchemaQuery): Promise<void> {
    await q(`CREATE TABLE IF NOT EXISTS task_worklogs (
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
    )`);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_worklogs_ticket
        ON task_worklogs (task_id, day_worked DESC, created_at DESC, id DESC) WHERE deleted_at IS NULL`);
    await q(`CREATE INDEX IF NOT EXISTS idx_task_worklogs_author_day
        ON task_worklogs (author_id, day_worked) WHERE deleted_at IS NULL`);
}
