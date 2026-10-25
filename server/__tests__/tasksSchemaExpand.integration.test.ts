import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { QueryFn } from "../types/domain";
import type { SchemaQuery } from "../platform/db/schemaTypes";

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const migrationsDir = path.join(__dirname, "..", "platform", "db", "migrations");

const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe("task schema expansion on PostgreSQL", () => {
    let pool: Pool | undefined;
    let client: PoolClient | undefined;

    function getClient(): PoolClient {
        if (!client) throw new Error("The PostgreSQL integration-test client is not connected");
        return client;
    }

    beforeAll(async () => {
        if (!databaseUrl) return;

        const parsed = new URL(databaseUrl);
        const databaseName = decodeURIComponent(parsed.pathname.slice(1));
        if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname)
            || !databaseName.toLowerCase().includes("test")) {
            throw new Error("TASKS_SCHEMA_TEST_DATABASE_URL must point to a local database whose name includes 'test'");
        }

        pool = new Pool({ connectionString: databaseUrl, max: 1 });
        client = await pool.connect();
    });

    afterAll(async () => {
        client?.release();
        await pool?.end();
    });

    async function withTenantSchema<T>(
        body: (query: SchemaQuery & QueryFn, schema: string) => Promise<T>,
    ): Promise<T> {
        const dbClient = getClient();
        const schema = `tasks_schema_${crypto.randomUUID().replace(/-/g, "")}`;
        await dbClient.query(`CREATE SCHEMA ${schema}`);
        await dbClient.query(`SET search_path TO ${schema}, public`);
        const query: SchemaQuery & QueryFn = async <R extends import("pg").QueryResultRow>(
            sql: string,
            params: unknown[] = [],
        ) => dbClient.query<R>(sql, params);

        try {
            return await body(query, schema);
        } finally {
            await dbClient.query("SET search_path TO public");
            await dbClient.query(`DROP SCHEMA ${schema} CASCADE`);
        }
    }

    async function initializeBase(query: SchemaQuery & QueryFn): Promise<void> {
        const { initTenantSchema } = require("../platform/db/tenantSchema");
        await initTenantSchema(query);
    }

    async function createOrganization(query: SchemaQuery & QueryFn): Promise<void> {
        await query(
            "INSERT INTO organizations (id, name, slug) VALUES (1, 'Tasks test', 'tasks-test')",
        );
        await query(
            "INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Creators'), (2, 1, 'Sprint team')",
        );
        await query(`
            INSERT INTO users (id, username, password, full_name, org_id, team_id)
            VALUES
                (1, 'creator', 'unused', 'Creator', 1, 1),
                (2, 'assignee', 'unused', 'Assignee', 1, 2),
                (3, 'assignee-fallback-owner', 'unused', 'Assignee Fallback', 1, NULL),
                (4, 'teamless-owner', 'unused', 'Teamless Owner', 1, NULL)
        `);
    }

    async function seedDefaults(query: SchemaQuery & QueryFn): Promise<void> {
        const { seedAgileDefaults } = require("../platform/db/agileDefaults");
        await seedAgileDefaults(query);
    }

    async function applyExistingMigrations(query: SchemaQuery & QueryFn): Promise<string[]> {
        const files = fs.readdirSync(migrationsDir)
            .filter((file) => /^\d{4}_.*\.sql$/.test(file) && file < "0011_")
            .sort();

        for (const file of files) {
            await query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
        }

        await query(`
            CREATE TABLE IF NOT EXISTS _migrations (
                name TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        for (const file of files) {
            await query(
                "INSERT INTO _migrations (name) VALUES ($1)",
                [file.replace(/\.sql$/, "")],
            );
        }
        return files.map((file) => file.replace(/\.sql$/, ""));
    }

    /**
     * Recreate the pre-ticket-28 task columns.
     *
     * The base tenant schema no longer declares `date`, `status` or
     * `rank_value`, so an "upgraded tenant" has to be simulated explicitly:
     * this is exactly the shape a database created before the contract step
     * still has when the new migrations run against it.
     */
    async function addLegacyColumns(query: SchemaQuery & QueryFn): Promise<void> {
        await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS date TEXT`);
        await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`);
        await query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS rank_value NUMERIC(20,10)`);
    }

    async function seedLegacyTasks(query: SchemaQuery & QueryFn): Promise<{ pendingId: number; doneId: number }> {
        await query(
            "INSERT INTO sprints (id, team_id, name, start_date, end_date) VALUES (1, 2, 'Sprint', '2026-10-01', '2026-10-14')",
        );
        const pending = await query<{ id: number }>(`
            INSERT INTO tasks (user_id, date, title, status, created_at, assigned_to, due_date, org_id)
            VALUES (1, '2026-10-02', 'First task', 'pending', '2026-01-01T00:00:00Z', 2, '2026-10-12', 1)
            RETURNING id
        `);
        const done = await query<{ id: number }>(`
            INSERT INTO tasks (user_id, date, title, status, created_at, assigned_to, due_date, sprint_id, org_id)
            VALUES (1, NULL, 'Done task', 'done', '2026-01-02T00:00:00Z', 2, NULL, 1, 1)
            RETURNING id
        `);
        await query(`
            INSERT INTO tasks (user_id, date, title, status, created_at, assigned_to, org_id)
            VALUES (3, NULL, 'Assignee team fallback', 'in_progress', '2026-01-03T00:00:00Z', 2, 1)
        `);
        await query(`
            INSERT INTO tasks (user_id, date, title, status, created_at, org_id)
            VALUES (4, NULL, 'Teamless task', 'in_review', '2026-01-04T00:00:00Z', 1)
        `);
        await query(`
            INSERT INTO tasks (user_id, date, title, status, created_at, org_id)
            VALUES (1, NULL, 'Second creator task', 'in_progress', '2026-01-05T00:00:00Z', 1)
        `);
        return { pendingId: pending.rows[0].id, doneId: done.rows[0].id };
    }

    async function schemaSnapshot(query: SchemaQuery & QueryFn): Promise<unknown[]> {
        const columns = await query(`
            SELECT table_name, column_name, data_type, is_nullable
              FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name IN ('tasks', 'sprint_baselines')
             ORDER BY table_name, ordinal_position
        `);
        const indexes = await query(`
            SELECT tablename, indexname, indexdef
              FROM pg_indexes
             WHERE schemaname = current_schema()
               AND tablename IN ('tasks', 'sprint_baselines')
             ORDER BY tablename, indexname
        `);
        const constraints = await query(`
            SELECT rel.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition
              FROM pg_constraint con
              JOIN pg_class rel ON rel.oid = con.conrelid
             WHERE con.connamespace = current_schema()::regnamespace
               AND rel.relname IN ('tasks', 'sprint_baselines')
             ORDER BY rel.relname, con.conname
        `);
        const triggers = await query(`
            SELECT tgname, pg_get_triggerdef(oid)
              FROM pg_trigger
             WHERE tgrelid = 'tasks'::regclass
               AND NOT tgisinternal
             ORDER BY tgname
        `);
        return [columns.rows, indexes.rows, constraints.rows, triggers.rows];
    }

    it("backfills legacy tasks, owns completion timestamps, converges fresh and upgraded tenants, and reruns safely", async () => {
        const { runTenantMigrations } = require("../platform/db/migrations");

        const freshSnapshot = await withTenantSchema(async (query) => {
            await initializeBase(query);
            const result = await runTenantMigrations(query, { label: "tasks-fresh-test", failFast: true });
            expect(result.failed).toEqual([]);
            await createOrganization(query);
            await seedDefaults(query);

            const firstSnapshot = await schemaSnapshot(query);
            await initializeBase(query);
            const rerun = await runTenantMigrations(query, { label: "tasks-fresh-test", failFast: true });
            expect(rerun.failed).toEqual([]);
            expect(await schemaSnapshot(query)).toEqual(firstSnapshot);
            return firstSnapshot;
        });

        const upgradedSnapshot = await withTenantSchema(async (query) => {
            await initializeBase(query);
            await createOrganization(query);
            const oldMigrations = await applyExistingMigrations(query);
            await addLegacyColumns(query);
            await seedDefaults(query);
            const { pendingId, doneId } = await seedLegacyTasks(query);

            const result = await runTenantMigrations(query, { label: "tasks-upgraded-test", failFast: true });
            expect(result.failed).toEqual([]);
            expect(result.applied).toContain("0011_tasks_schema_expand");
            expect(result.applied).toContain("0015_drop_legacy_task_columns");

            const tasks = await query<{
                id: number;
                planned_date: string | null;
                due_date: string | null;
                title: string;
                category: string;
                team_id: number | null;
                rank: string;
                completed_at: Date | null;
            }>(`
                SELECT t.id, t.planned_date, t.due_date, ws.category,
                       t.team_id, t.rank, t.completed_at
                  FROM tasks t
                  JOIN workflow_states ws ON ws.id = t.workflow_state_id
                 ORDER BY t.id
            `);

            const pending = tasks.rows.find((task) => task.id === pendingId)!;
            const done = tasks.rows.find((task) => task.id === doneId)!;
            const assigneeFallback = tasks.rows.find((task) => task.title === "Assignee team fallback")!;
            const teamless = tasks.rows.find((task) => task.title === "Teamless task")!;
            expect(pending).toMatchObject({
                planned_date: "2026-10-02",
                due_date: "2026-10-12",
                category: "open",
                team_id: 1,
            });
            expect(done).toMatchObject({ category: "done", team_id: 2 });
            expect(done.completed_at).toBeInstanceOf(Date);
            expect(assigneeFallback.team_id).toBe(2);
            expect(teamless).toMatchObject({ category: "in_review", team_id: null });

            const ranksByTeam = new Map<string, string[]>();
            for (const task of tasks.rows) {
                const teamScope = task.team_id === null ? "org" : String(task.team_id);
                ranksByTeam.set(teamScope, [...(ranksByTeam.get(teamScope) || []), task.rank]);
            }
            for (const ranks of ranksByTeam.values()) {
                expect(new Set(ranks).size).toBe(ranks.length);
                expect(ranks).toEqual([...ranks].sort());
            }

            const states = await query<{ id: number; category: string }>(`
                SELECT id, category FROM workflow_states WHERE org_id = 1
            `);
            const doneState = states.rows.find((state) => state.category === "done")!;
            const openState = states.rows.find((state) => state.category === "open")!;
            const transitioned = await query<{ completed_at: Date }>(`
                UPDATE tasks
                   SET workflow_state_id = $1, completed_at = '2000-01-01T00:00:00Z'
                 WHERE id = $2
                 RETURNING completed_at
            `, [doneState.id, pendingId]);
            const completedAt = transitioned.rows[0].completed_at;
            expect(completedAt.getUTCFullYear()).toBeGreaterThan(2000);

            const directWrite = await query<{ completed_at: Date }>(`
                UPDATE tasks SET completed_at = '2001-01-01T00:00:00Z'
                 WHERE id = $1 RETURNING completed_at
            `, [pendingId]);
            expect(directWrite.rows[0].completed_at).toEqual(completedAt);

            const reopened = await query<{ completed_at: Date | null }>(`
                UPDATE tasks
                   SET workflow_state_id = $1, completed_at = '2001-01-01T00:00:00Z'
                 WHERE id = $2
                 RETURNING completed_at
            `, [openState.id, pendingId]);
            expect(reopened.rows[0].completed_at).toBeNull();

            const taskColumns = await query<{ column_name: string; data_type: string }>(`
                SELECT column_name, data_type
                  FROM information_schema.columns
                 WHERE table_schema = current_schema() AND table_name = 'tasks'
            `);
            const typeByColumn = Object.fromEntries(taskColumns.rows.map((column) => [column.column_name, column.data_type]));

            // Ticket 28: the legacy columns are gone, so there is exactly one
            // status (the workflow state) and one planned date.
            expect(typeByColumn).not.toHaveProperty("date");
            expect(typeByColumn).not.toHaveProperty("status");
            expect(typeByColumn).not.toHaveProperty("rank_value");
            expect(typeByColumn).toMatchObject({
                planned_date: "date",
                due_date: "date",
                rank: "text",
                team_id: "integer",
            });

            const baseline = await query<{ table_name: string }>(`
                SELECT table_name FROM information_schema.tables
                 WHERE table_schema = current_schema() AND table_name = 'sprint_baselines'
            `);
            expect(baseline.rows).toHaveLength(1);

            const firstSnapshot = await schemaSnapshot(query);
            await initializeBase(query);
            const rerun = await runTenantMigrations(query, { label: "tasks-upgraded-test", failFast: true });
            expect(rerun.failed).toEqual([]);
            expect(await schemaSnapshot(query)).toEqual(firstSnapshot);
            expect(oldMigrations).toHaveLength(9);
            return firstSnapshot;
        });

        expect(upgradedSnapshot).toEqual(freshSnapshot);
    });

    it("fails with tenant and offending legacy status instead of leaving a task unmapped", async () => {
        const { runTenantMigrations } = require("../platform/db/migrations");

        await withTenantSchema(async (query) => {
            await initializeBase(query);
            await createOrganization(query);
            await applyExistingMigrations(query);
            await addLegacyColumns(query);
            await seedDefaults(query);
            await query(`
                INSERT INTO tasks (user_id, title, status, org_id)
                VALUES (1, 'Unmappable task', 'unknown_legacy_status', 1)
            `);

            await expect(runTenantMigrations(query, {
                label: "tenant-bad-status-test",
                failFast: true,
            })).rejects.toThrow(/tenant-bad-status-test.*unknown_legacy_status/i);

            const applied = await query<{ name: string }>("SELECT name FROM _migrations WHERE name = '0011_tasks_schema_expand'");
            expect(applied.rows).toHaveLength(0);
        });
    });

    it("keeps every task categorised after the legacy columns are dropped", async () => {
        const { runTenantMigrations } = require("../platform/db/migrations");

        await withTenantSchema(async (query) => {
            await initializeBase(query);
            await createOrganization(query);
            await applyExistingMigrations(query);
            await addLegacyColumns(query);
            await seedDefaults(query);
            const { pendingId, doneId } = await seedLegacyTasks(query);

            const result = await runTenantMigrations(query, { label: "tasks-contract-test", failFast: true });
            expect(result.failed).toEqual([]);

            const rows = await query<{ id: number; category: string; planned_date: string | null }>(`
                SELECT t.id, ws.category, t.planned_date
                  FROM tasks t
                  JOIN workflow_states ws ON ws.id = t.workflow_state_id
                 ORDER BY t.id
            `);
            expect(rows.rows).toHaveLength(5);
            expect(rows.rows.find((row) => row.id === pendingId)).toMatchObject({
                category: "open",
                planned_date: "2026-10-02",
            });
            expect(rows.rows.find((row) => row.id === doneId)).toMatchObject({ category: "done" });
            expect(rows.rows.every((row) => row.category !== null)).toBe(true);
        });
    });
});
