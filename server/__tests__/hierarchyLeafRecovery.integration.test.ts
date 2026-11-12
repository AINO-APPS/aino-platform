import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";

jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));
const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
jest.setTimeout(120_000);
(url ? describe : describe.skip)("ordered hierarchy leaf recovery (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    const directory = path.join(__dirname, "../platform/db/migrations");
    const query = (sql: string, values: unknown[] = []) => pool.query(sql, values);
    beforeEach(async () => {
        database = await createTestDatabase(url!, "hierarchy_leaf_recovery");
        pool = new Pool({ connectionString: database.url });
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        await pool.query("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())");
        for (const file of fs.readdirSync(directory).filter(file => file.endsWith(".sql") && file < "0031").sort()) {
            await pool.query(fs.readFileSync(path.join(directory, file), "utf8"));
            await pool.query("INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING", [file.replace(".sql", "")]);
        }
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Recovery', 'recovery')");
        await pool.query(`INSERT INTO work_item_types (org_id, key, name, is_epic, is_default) VALUES
            (1, 'epic', 'Epic', TRUE, FALSE), (1, 'story', 'Story', FALSE, FALSE),
            (1, 'task', 'Task', FALSE, TRUE), (1, 'bug', 'Bug', FALSE, FALSE),
            (1, 'subtask', 'Legacy Subtask', FALSE, FALSE)`);
        await pool.query(`INSERT INTO workflow_states (org_id, key, name, category, is_initial)
            VALUES (1, 'pending', 'New', 'open', TRUE)`);
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id) VALUES (1, 'member', 'x', 'Member', 1)");
        await pool.query(`INSERT INTO projects (id, org_id, key, name, type) VALUES
            (10, 1, 'ONE', 'One', 'scrum'), (20, 1, 'TWO', 'Two', 'scrum'),
            (30, 1, 'AUTO', 'Automatic', 'scrum')`);
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
            VALUES (10, 10, 'Current', '2026-11-01', '2026-11-14', 'planned')`);
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status, auto_managed) VALUES
            (30, 30, 'Automatic active', '2026-11-01', '2026-11-14', 'active', TRUE),
            (31, 30, 'Automatic planned', '2026-11-15', '2026-11-28', 'planned', TRUE),
            (32, 30, 'Automatic history', '2026-10-01', '2026-10-14', 'completed', TRUE)`);
        for (const [id, type, project, parent, sprint] of [
            [1, "epic", 10, null, null], [2, "task", 10, 1, 10], [3, "story", 10, 2, null],
            [4, "task", 10, null, 10], [5, "bug", 10, 4, null],
            [6, "task", 10, 4, null], [7, "task", 10, 6, null],
            [8, "story", 20, 4, null], [9, "epic", 10, 4, null],
            [10, "subtask", 10, 4, null], [11, "subtask", 10, null, null],
            [12, "task", 10, 12, null], [13, "task", 10, 4, null],
            [14, "task", 10, 4, null], [15, "task", 10, 4, null],
            [16, "task", 10, 4, null], [17, "task", 20, 16, null],
            [20, "task", 30, null, 30], [21, "story", 30, 20, 30], [22, "bug", 30, 20, null],
            [23, "task", 30, null, 31], [24, "task", 30, 23, 31],
            [25, "task", 30, null, 32], [26, "task", 30, 25, 32],
        ]) {
            await pool.query(`INSERT INTO tasks (id, title, user_id, org_id, project_id, parent_task_id, sprint_id, work_item_type_id)
                SELECT $1::integer, 'Legacy ' || $1::text, 1, 1, $2, $3, $4, id FROM work_item_types WHERE org_id = 1 AND key = $5`,
            [id, project, parent, sprint, type]);
        }
    });
    afterEach(async () => { await pool?.end(); await database?.drop(); });

    test.each([false, true])("the full ordered chain recovers eligible leaves and replays unchanged (0031 already applied: %s)", async alreadyApplied => {
        if (alreadyApplied) {
            await pool.query(fs.readFileSync(path.join(directory, "0031_ticket_hierarchy.sql"), "utf8"));
            await pool.query("INSERT INTO _migrations (name) VALUES ('0031_ticket_hierarchy')");
            await pool.query("UPDATE tasks SET parent_task_id = 1 WHERE id = 14");
            await pool.query("UPDATE tasks SET work_item_type_id = (SELECT id FROM work_item_types WHERE org_id = 1 AND key = 'bug') WHERE id = 15");
            await pool.query(`INSERT INTO task_history (task_id, user_id, action, field, old_value, new_value)
                VALUES (14, 1, 'updated', 'parent', NULL, '1'), (15, 1, 'updated', 'work_item_type', 'Task', 'Bug')`);
        }
        await pool.query("UPDATE tasks SET title = 'Human title retained' WHERE id = 13");
        const run = () => require("../platform/db/migrations").runTenantMigrations(query, {
            transaction: require("../platform/db/pool").makePoolTransaction(pool),
        });
        expect((await run()).failed).toEqual([]);
        const rows = (await pool.query(`SELECT t.id, t.parent_task_id, t.sprint_id, w.key AS type, t.title
            FROM tasks t JOIN work_item_types w ON w.id = t.work_item_type_id ORDER BY t.id`)).rows;
        const byId = (id: number) => rows.find(row => row.id === id);
        expect([3, 5, 13].map(id => byId(id))).toEqual([
            expect.objectContaining({ id: 3, parent_task_id: 2, sprint_id: 10, type: "subtask" }),
            expect.objectContaining({ id: 5, parent_task_id: 4, sprint_id: 10, type: "subtask" }),
            expect.objectContaining({ id: 13, parent_task_id: 4, sprint_id: 10, type: "subtask", title: "Human title retained" }),
        ]);
        for (const id of [6, 8, 9, 11, 12, 16, 17]) expect(byId(id)?.parent_task_id).toBeNull();
        expect(byId(7)).toMatchObject({ parent_task_id: 6, type: "subtask", sprint_id: null });
        expect(byId(2)).toMatchObject({ parent_task_id: 1, type: "task" });
        expect(byId(10)).toMatchObject({ parent_task_id: 4, sprint_id: 10, type: "subtask" });
        expect(byId(14)).toMatchObject(alreadyApplied ? { parent_task_id: 1, type: "task" }
            : { parent_task_id: 4, type: "subtask" });
        expect(byId(15)).toMatchObject(alreadyApplied ? { parent_task_id: null, type: "bug" }
            : { parent_task_id: 4, type: "subtask" });
        for (const [id, parent, sprint] of [[21, 20, null], [22, 20, null], [24, 23, null], [26, 25, 32]]) {
            const ambiguousPriorMove = alreadyApplied && [21, 24].includes(id!);
            expect(byId(id!)).toMatchObject(ambiguousPriorMove ? { parent_task_id: null, type: id === 21 ? "story" : "task" }
                : { parent_task_id: parent, type: "subtask", sprint_id: sprint });
        }
        const snapshot = async () => ({
            tasks: (await pool.query("SELECT * FROM tasks ORDER BY id")).rows,
            repairs: (await pool.query("SELECT * FROM task_hierarchy_repairs ORDER BY task_id")).rows,
            corrections: (await pool.query("SELECT * FROM task_hierarchy_repair_corrections ORDER BY task_id")).rows,
            history: (await pool.query("SELECT * FROM task_history ORDER BY id")).rows,
        });
        const first = await snapshot();
        expect(first.corrections).toHaveLength(alreadyApplied ? 6 : 10);
        expect(first.repairs.find(row => row.task_id === 3)?.after_value.parent_task_id).toBeNull();
        expect(first.history).toEqual(expect.arrayContaining([
            expect.objectContaining({ task_id: 3, field: "parent", actor_type: "system", new_value: "2" }),
            expect.objectContaining({ task_id: 3, field: "sprint", actor_type: "system", new_value: "10" }),
        ]));
        expect((await run()).failed).toEqual([]);
        await pool.query(fs.readFileSync(path.join(directory, "0034_recover_hierarchy_leaves.sql"), "utf8"));
        expect(await snapshot()).toEqual(first);
    });
});
