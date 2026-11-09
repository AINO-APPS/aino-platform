import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";

const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
jest.setTimeout(60_000);
(url ? describe : describe.skip)("ticket hierarchy expansion (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    const sql = fs.readFileSync(path.join(__dirname, "../platform/db/migrations/0031_ticket_hierarchy.sql"), "utf8");
    beforeAll(async () => {
        database = await createTestDatabase(url!, "hierarchy_expand");
        pool = new Pool({ connectionString: database.url });
        await pool.query(`
            CREATE TABLE organizations (id SERIAL PRIMARY KEY);
            CREATE TABLE work_item_types (
                id SERIAL PRIMARY KEY, org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
                key TEXT, name TEXT, icon TEXT, color TEXT, is_default BOOLEAN DEFAULT FALSE,
                is_epic BOOLEAN DEFAULT FALSE, is_active BOOLEAN DEFAULT TRUE, sort_order INTEGER,
                UNIQUE(org_id, key)
            );
            CREATE TABLE tasks (id INTEGER PRIMARY KEY, org_id INTEGER, project_id INTEGER,
                sprint_id INTEGER, parent_task_id INTEGER, work_item_type_id INTEGER);
            CREATE TABLE task_history (id SERIAL PRIMARY KEY, task_id INTEGER, user_id INTEGER,
                action TEXT, field TEXT, old_value TEXT, new_value TEXT, actor_type TEXT DEFAULT 'user');
            INSERT INTO organizations (id) VALUES (1), (2);
            INSERT INTO work_item_types (id, org_id, key, name, is_epic, is_default) VALUES
                (1, 1, 'epic', 'Epic', TRUE, FALSE), (2, 1, 'story', 'Story', FALSE, TRUE),
                (3, 1, 'task', 'Task', FALSE, FALSE), (4, 1, 'subtask', 'Legacy Subtask', FALSE, FALSE),
                (5, 2, 'epic', 'Epic', TRUE, FALSE), (6, 2, 'task', 'Task', FALSE, TRUE);
            SELECT setval('work_item_types_id_seq', 6);
            INSERT INTO tasks VALUES
                (1, 1, 10, NULL, NULL, 1),
                (2, 1, 10, 10, 1, 2),
                (3, 1, 10, NULL, 2, 2),
                (4, 1, 10, NULL, 1, 1),
                (5, 1, 20, NULL, 2, 4),
                (6, 1, 10, 99, 2, 4),
                (7, 1, 10, NULL, NULL, 4),
                (8, 1, 10, NULL, 5, 2),
                (9, 1, 10, NULL, 11, 2),
                (10, 1, 10, NULL, 6, 4),
                (11, 2, 20, NULL, NULL, 5);
        `);
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    test("repairs only invalid legacy relationships, logs immutable review records and history, and replays without changes", async () => {
        await pool.query(sql);
        expect((await pool.query("SELECT id, parent_task_id, work_item_type_id, sprint_id FROM tasks ORDER BY id")).rows).toEqual([
            { id: 1, parent_task_id: null, work_item_type_id: 1, sprint_id: null },
            { id: 2, parent_task_id: 1, work_item_type_id: 2, sprint_id: 10 },
            { id: 3, parent_task_id: null, work_item_type_id: 2, sprint_id: null },
            { id: 4, parent_task_id: null, work_item_type_id: 1, sprint_id: null },
            { id: 5, parent_task_id: null, work_item_type_id: 3, sprint_id: null },
            { id: 6, parent_task_id: 2, work_item_type_id: 4, sprint_id: 10 },
            { id: 7, parent_task_id: null, work_item_type_id: 3, sprint_id: null },
            { id: 8, parent_task_id: null, work_item_type_id: 2, sprint_id: null },
            { id: 9, parent_task_id: null, work_item_type_id: 2, sprint_id: null },
            { id: 10, parent_task_id: null, work_item_type_id: 3, sprint_id: null },
            { id: 11, parent_task_id: null, work_item_type_id: 5, sprint_id: null },
        ]);
        const snapshot = async () => ({
            repairs: (await pool.query("SELECT * FROM task_hierarchy_repairs ORDER BY task_id")).rows,
            history: (await pool.query("SELECT * FROM task_history ORDER BY id")).rows,
            tasks: (await pool.query("SELECT * FROM tasks ORDER BY id")).rows,
        });
        const before = await snapshot();
        expect(before.repairs).toHaveLength(8);
        expect(before.repairs.find((r: any) => r.task_id === 5)).toMatchObject({
            before_value: { parent_task_id: 2, project_id: 20, work_item_type_id: 4 },
            after_value: { parent_task_id: null, project_id: 20, work_item_type_id: 3 },
        });
        expect(before.history).toEqual(expect.arrayContaining([
            expect.objectContaining({ task_id: 6, actor_type: "system", field: "sprint", old_value: "99", new_value: "10" }),
        ]));
        await pool.query(sql);
        expect(await snapshot()).toEqual(before);
        await pool.query("INSERT INTO organizations (id) VALUES (3)");
        expect((await pool.query("SELECT key, is_subtask FROM work_item_types WHERE org_id = 3")).rows)
            .toEqual([{ key: "subtask", is_subtask: true }]);
        await expect(pool.query("DELETE FROM work_item_types WHERE org_id = 3")).rejects.toThrow(/subtask/i);
    });
});
