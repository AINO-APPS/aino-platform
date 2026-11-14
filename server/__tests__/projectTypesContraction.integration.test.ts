import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { runProjectTypesContraction } from "../modules/projectTypesRemoval/projectTypesRemoval.migrate";
import { verifyProjectOwnership } from "../platform/projectTypesRemoval";

jest.setTimeout(120_000);

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("guarded project-types contraction (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    const env = {
        PROJECT_TYPES_REMOVAL: "api",
        CLIENT_VERSION_MODE: "enforce",
        CLIENT_VERSION_MIN_ANDROID: "0.27.18",
        CLIENT_VERSION_MIN_DESKTOP: "3.0.80",
        CLIENT_VERSION_MIN_WEB: "3.0.80",
    };

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_types_contraction");
        pool = new Pool({ connectionString: database.url, max: 2 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        const migrations = await require("../platform/db/migrations").runTenantMigrations(query);
        expect(migrations.failed).toEqual([]);
        await query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Ready', 'ready'), (2, 'Blocked', 'blocked')");
        await query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Team')");
        await query("INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES (1, 'u', 'x', 'User', 1, 1)");
        await require("../platform/db/agileDefaults").seedAgileDefaults(query);
        await query("INSERT INTO projects (id, org_id, key, name, type, key_published) VALUES (10, 1, 'KEEP', 'Keep', 'scrum', TRUE)");
        await query(`INSERT INTO tasks (id, user_id, title, org_id, team_id, project_id, planned_date, start_date)
            VALUES (100, 1, 'Retained ticket', 1, 1, 10, '2026-11-12', '2026-11-12')`);
    });

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    function target() {
        return {
            name: "throwaway",
            transaction: async <T>(run: (query: (sql: string, params?: unknown[]) => Promise<any>) => Promise<T>) => {
                const client = await pool.connect();
                try {
                    await client.query("BEGIN");
                    const value = await run((sql, params = []) => client.query(sql, params as any[]));
                    await client.query("COMMIT");
                    return value;
                } catch (error) {
                    await client.query("ROLLBACK");
                    throw error;
                } finally {
                    client.release();
                }
            },
        };
    }

    test("refuses an unswitched organization without changing its project-owned ticket", async () => {
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        const verifyOwnership = () => verifyProjectOwnership(query);
        await expect(runProjectTypesContraction({
            env: () => env,
            verifyOwnership,
            tenantQueries: [target()],
        })).rejects.toThrow("Project ownership is not verified for every organization");
        expect((await query("SELECT id, project_id, title, planned_date::text FROM tasks WHERE id = 100")).rows[0])
            .toEqual({ id: 100, project_id: 10, title: "Retained ticket", planned_date: "2026-11-12" });
    });

    test("drops only compatibility storage after the preflight and keeps project-owned rows", async () => {
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await query("UPDATE organizations SET project_ownership = TRUE, project_ownership_switched_at = NOW()");
        const verifyOwnership = () => verifyProjectOwnership(query);
        await expect(runProjectTypesContraction({
            env: () => env,
            verifyOwnership,
            tenantQueries: [target()],
        })).resolves.toEqual(["throwaway"]);

        expect((await query("SELECT id, org_id, project_id, title, start_date::text FROM tasks WHERE id = 100")).rows[0])
            .toEqual({ id: 100, org_id: 1, project_id: 10, title: "Retained ticket", start_date: "2026-11-12" });
        expect((await query("SELECT id, key, name FROM projects WHERE id = 10")).rows).toEqual([
            { id: 10, key: "KEEP", name: "Keep" },
        ]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).applied).toEqual([]);
        const remaining = await query(`SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = current_schema() AND (
                (table_name = 'tasks' AND column_name IN ('planned_date', 'pre_sprint_due_date', 'team_id', 'logged_minutes', 'estimated_minutes'))
                OR (table_name = 'sprints' AND column_name IN ('team_id', 'is_auto', 'auto_managed', 'sprint_number'))
                OR (table_name = 'teams' AND column_name IN ('sprint_mode', 'sprint_paused', 'sprint_start_date', 'sprint_duration_weeks'))
                OR (table_name = 'organizations' AND column_name IN ('project_ownership', 'project_ownership_switched_at'))
            )`);
        expect(remaining.rows).toEqual([]);
        expect((await query("SELECT to_regclass('public.task_timers') AS timers")).rows[0].timers).toBeNull();
        await expect(runProjectTypesContraction({
            env: () => env,
            verifyOwnership,
            tenantQueries: [target()],
        })).resolves.toEqual([]);
    });
});
