import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { seedLegacyAgileFixture } from "../test-support/legacyAgileFixture";

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
jest.setTimeout(120_000);

postgresDescribe("projects own their workflows (PostgreSQL migration seam)", () => {
    let pool: Pool;
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
    const migrationsDir = path.join(__dirname, "../platform/db/migrations");
    const migration = () => fs.readFileSync(path.join(migrationsDir, "0021_workflow_per_project.sql"), "utf8");

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_workflow");
        pool = new Pool({ connectionString: database.url, max: 1 });
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        await query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Workflow test', 'workflow-test')");
        await query("INSERT INTO users (id, username, password, full_name, org_id) VALUES (1, 'admin', 'unused', 'Admin', 1)");
        for (const file of fs.readdirSync(migrationsDir).filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < "0021_").sort()) {
            await query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
        }
        await seedLegacyAgileFixture(query);
        await query(`INSERT INTO projects (id, org_id, key, name, type) VALUES
            (100, 1, 'ONE', 'One', 'kanban'), (101, 1, 'TWO', 'Two', 'kanban')`);
        await query(`INSERT INTO workflow_states
            (org_id, key, name, category, color, icon, wip_limit, is_initial, is_terminal, is_active, sort_order)
            VALUES (1, 'blocked', 'Blocked', 'in_progress', '#123456', 'Pause', 7, FALSE, FALSE, TRUE, 12)`);
        const states = (await query("SELECT id, key FROM workflow_states WHERE org_id = 1 ORDER BY id")).rows;
        const byKey = new Map(states.map((state) => [state.key, state.id]));
        await query(
            "INSERT INTO workflow_transitions (org_id, from_state_id, to_state_id, required_role) VALUES (1, $1, $2, 'manager')",
            [byKey.get("pending"), byKey.get("blocked")],
        );
        await query(`INSERT INTO tasks (id, title, user_id, org_id, project_id, workflow_state_id)
            VALUES (501, 'One ticket', 1, 1, 100, $1), (502, 'Two ticket', 1, 1, 101, $1)`,
        [byKey.get("blocked")]);
    });

    afterAll(async () => { await pool?.end(); await database?.drop(); });

    test("copies each org template into every project, repoints tickets, and is idempotent", async () => {
        await query(migration());

        const stateRows = (await query(
            "SELECT project_id, key, name, category, color, icon, wip_limit, is_initial, is_terminal, is_active, sort_order FROM workflow_states WHERE project_id IS NOT NULL ORDER BY project_id, sort_order, key",
        )).rows;
        expect(stateRows.filter((state) => state.project_id === 100)).toEqual(expect.arrayContaining([
            expect.objectContaining({
                key: "blocked", name: "Blocked", category: "in_progress", color: "#123456",
                icon: "Pause", wip_limit: 7, is_initial: false, is_terminal: false, is_active: true, sort_order: 12,
            }),
            expect.objectContaining({ key: "cancelled", name: "Cancelled", category: "done", is_terminal: true }),
        ]));
        expect(stateRows.filter((state) => state.project_id === 101)).toHaveLength(stateRows.filter((state) => state.project_id === 100).length);

        const statesByProject = (await query(
            "SELECT id, project_id, key FROM workflow_states WHERE project_id IS NOT NULL",
        )).rows;
        const stateId = (projectId: number, key: string) => statesByProject.find((state) => state.project_id === projectId && state.key === key)?.id;
        expect((await query("SELECT workflow_state_id FROM tasks WHERE id = 501")).rows[0].workflow_state_id).toBe(stateId(100, "blocked"));
        expect((await query("SELECT workflow_state_id FROM tasks WHERE id = 502")).rows[0].workflow_state_id).toBe(stateId(101, "blocked"));
        await expect(query(
            "INSERT INTO workflow_states (org_id, project_id, key, name, category) VALUES (1, 100, 'blocked', 'duplicate', 'open')",
        )).rejects.toMatchObject({ code: "23505" });
        await query(
            "INSERT INTO workflow_states (org_id, project_id, key, name, category) VALUES (1, 101, 'only-two', 'Only Two', 'open')",
        );

        const snapshot = async () => (await query(`SELECT jsonb_build_object(
            'states', (SELECT jsonb_agg(s ORDER BY id) FROM workflow_states s),
            'transitions', (SELECT jsonb_agg(t ORDER BY id) FROM workflow_transitions t),
            'tickets', (SELECT jsonb_agg(jsonb_build_object('id', id, 'workflow_state_id', workflow_state_id) ORDER BY id) FROM tasks)) AS data`)).rows[0].data;
        const before = await snapshot();
        await query(migration());
        expect(await snapshot()).toEqual(before);

        const inserted = (await query(
            "INSERT INTO projects (org_id, key, name, type) VALUES (1, 'THREE', 'Three', 'kanban') RETURNING id",
        )).rows[0];
        expect((await query("SELECT key FROM workflow_states WHERE project_id = $1 ORDER BY key", [inserted.id])).rows.map((row) => row.key))
            .toEqual(expect.arrayContaining(["blocked", "cancelled", "pending"]));
        expect((await query("SELECT COUNT(*)::int AS count FROM workflow_transitions WHERE project_id = $1", [inserted.id])).rows[0].count).toBeGreaterThan(0);
    });
});
