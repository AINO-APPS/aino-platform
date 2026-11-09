import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(url ? describe : describe.skip)("start date expansion on PostgreSQL", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    beforeAll(async () => {
        database = await createTestDatabase(url!, "start_date_expand");
        pool = new Pool({ connectionString: database.url });
    });
    beforeEach(async () => {
        await pool.query("DROP TABLE IF EXISTS tasks, _data_backfills");
        await pool.query(`CREATE TABLE tasks (id SERIAL PRIMARY KEY, user_id INTEGER, assigned_to INTEGER, planned_date DATE, start_date DATE, due_date DATE, sprint_id INTEGER);
            INSERT INTO tasks (planned_date, start_date, due_date, sprint_id) VALUES
            ('2026-11-09', NULL, '2026-11-20', NULL),
            ('2026-11-10', '2026-11-12', '2026-11-20', 1), (NULL, NULL, NULL, NULL)`);
    });
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    test("expands an old schema without start_date and replay leaves schema, indexes and rows unchanged", async () => {
        await pool.query("DROP TABLE tasks");
        await pool.query("CREATE TABLE tasks (id SERIAL PRIMARY KEY, user_id INTEGER, assigned_to INTEGER, planned_date DATE)");
        await pool.query("INSERT INTO tasks (planned_date) VALUES ('2026-11-09'), (NULL)");
        const sql = fs.readFileSync(path.join(__dirname, "../platform/db/migrations/0029_tasks_start_date.sql"), "utf8");
        await pool.query(sql);
        expect((await pool.query("SELECT start_date FROM tasks ORDER BY id")).rows).toEqual([{ start_date: "2026-11-09" }, { start_date: null }]);
        const snapshot = async () => ({
            columns: (await pool.query("SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name='tasks' ORDER BY ordinal_position")).rows,
            indexes: (await pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename='tasks' ORDER BY indexname")).rows,
            data: (await pool.query("SELECT * FROM tasks ORDER BY id")).rows,
        });
        const before = await snapshot();
        expect(before.columns).toContainEqual({ column_name: "start_date", is_nullable: "YES", data_type: "date" });
        await pool.query(sql);
        expect(await snapshot()).toEqual(before);
    });
    test("copies planned days once, preserves explicit dates and never resurrects a cleared start date", async () => {
        const sql = fs.readFileSync(path.join(__dirname, "../platform/db/migrations/0029_tasks_start_date.sql"), "utf8");
        await pool.query(sql);
        expect((await pool.query("SELECT start_date FROM tasks ORDER BY id")).rows).toEqual([
            { start_date: "2026-11-09" }, { start_date: "2026-11-12" }, { start_date: null },
        ]);
        const first = (await pool.query("SELECT * FROM tasks ORDER BY id")).rows;
        await pool.query(sql);
        expect((await pool.query("SELECT * FROM tasks ORDER BY id")).rows).toEqual(first);
        await pool.query("UPDATE tasks SET start_date = NULL WHERE id = 1");
        await pool.query(sql);
        expect((await pool.query("SELECT start_date, planned_date FROM tasks WHERE id = 1")).rows[0])
            .toEqual({ start_date: null, planned_date: "2026-11-09" });
    });
});
