import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";

installPgTypeParsers();
const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const pgDescribe = url ? describe : describe.skip;
const migration = "0026_task_worklogs";

pgDescribe("timer history becomes worklogs (PostgreSQL migration seam)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
    beforeAll(async () => {
        database = await createTestDatabase(url!, "worklog_migration");
        pool = new Pool({ connectionString: database.url, max: 1 });
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        await query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())");
        await query("INSERT INTO _migrations (name) VALUES ($1)", [migration]);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });

    test("new-tenant baseline worklog columns, constraints and indexes match the migration", async () => {
        const snapshot = async () => ({
            columns: (await query(`SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'task_worklogs'
                ORDER BY ordinal_position`)).rows,
            constraints: (await query(`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
                WHERE conrelid = 'task_worklogs'::regclass ORDER BY definition`)).rows,
            indexes: (await query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'task_worklogs' ORDER BY indexname`)).rows,
        });
        const baseline = await snapshot();
        await query('DROP TABLE task_worklogs');
        await query(fs.readFileSync(path.join(__dirname, '..', 'platform', 'db', 'migrations', `${migration}.sql`), 'utf8'));
        expect(await snapshot()).toEqual(baseline);
    });

    test("stopped and running time is retained once, dated in the organization timezone", async () => {
        await query("DROP TABLE IF EXISTS task_worklogs");
        await query("INSERT INTO organizations (id, name, slug, timezone) VALUES (1, 'Worklogs', 'worklogs', 'Asia/Kolkata'), (2, 'UTC', 'utc', DEFAULT)");
        await query("INSERT INTO users (id, username, password, full_name, org_id) VALUES (1, 'alice', 'unused', 'Alice', 1), (2, 'bob', 'unused', 'Bob', 2)");
        await query("INSERT INTO tasks (id, user_id, org_id, title, logged_minutes) VALUES (1, 1, 1, 'Migrated', 75), (2, 2, 2, 'UTC', 10)");
        await query(`INSERT INTO task_timers (id, task_id, user_id, started_at, stopped_at, minutes) VALUES
            (1, 1, 1, '2026-11-02T23:45:00Z', '2026-11-03T00:30:00Z', 45),
            (2, 1, 1, NOW() - INTERVAL '30 minutes', NULL, NULL),
            (3, 2, 2, '2026-11-02T23:45:00Z', '2026-11-02T23:55:00Z', 10)`);
        await query("DELETE FROM _migrations WHERE name = $1", [migration]);
        const run = await require("../platform/db/migrations").runTenantMigrations(query);
        expect(run.failed).toEqual([]);
        expect(run.applied).toContain(migration);
        const visible = await query("SELECT task_id, author_id, logged_by_id, day_worked::text, minutes, comment FROM task_worklogs ORDER BY source_timer_id");
        expect(visible.rows).toEqual([
            { task_id: 1, author_id: 1, logged_by_id: 1, day_worked: '2026-11-03', minutes: 45, comment: 'Migrated from timer' },
            { task_id: 1, author_id: 1, logged_by_id: 1, day_worked: expect.any(String), minutes: 30, comment: 'Migrated from timer' },
            { task_id: 2, author_id: 2, logged_by_id: 2, day_worked: '2026-11-02', minutes: 10, comment: 'Migrated from timer' },
        ]);
        expect((await query("SELECT id FROM task_timers WHERE stopped_at IS NULL")).rows).toEqual([]);
        expect((await query("SELECT task_id, SUM(minutes)::int AS total FROM task_worklogs GROUP BY task_id ORDER BY task_id")).rows).toEqual([
            { task_id: 1, total: 75 }, { task_id: 2, total: 10 },
        ]);
        const rerun = await require("../platform/db/migrations").runTenantMigrations(query);
        expect(rerun.failed).toEqual([]);
        expect(rerun.applied).toEqual([]);
        // Retry the SQL too, independently of the migration ledger.
        await query(fs.readFileSync(path.join(__dirname, '..', 'platform', 'db', 'migrations', `${migration}.sql`), 'utf8'));
        expect((await query("SELECT COUNT(*)::int AS count FROM task_worklogs")).rows[0].count).toBe(3);
    }, 120_000);
});
