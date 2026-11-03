import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { createTestDatabase } from '../test-support/pgTestDatabase';
const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(url ? describe : describe.skip)('original and remaining estimates (PostgreSQL migration seam)', () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    const migration = () => pool.query(fs.readFileSync(path.join(__dirname, '..', 'platform', 'db', 'migrations', '0020_task_estimates.sql'), 'utf8'));
    beforeAll(async () => { database = await createTestDatabase(url!, 'estimates_migration'); pool = new Pool({ connectionString: database.url }); });
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    test('renames and preserves legacy estimates, backfills from active worklogs, and retries without resetting forecasts', async () => {
        await pool.query(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, estimated_minutes INTEGER);
            CREATE TABLE task_worklogs (task_id INTEGER, minutes INTEGER, deleted_at TIMESTAMPTZ);
            INSERT INTO tasks VALUES (1,120),(2,30),(3,NULL),(4,0);
            INSERT INTO task_worklogs VALUES (1,45,NULL),(1,900,NOW()),(2,60,NULL),(3,15,NULL)`);
        await migration();
        expect((await pool.query('SELECT * FROM tasks ORDER BY id')).rows).toEqual([
            {id:1, original_estimate_minutes:120, remaining_estimate_minutes:75},
            {id:2, original_estimate_minutes:30, remaining_estimate_minutes:0},
            {id:3, original_estimate_minutes:null, remaining_estimate_minutes:null},
            {id:4, original_estimate_minutes:0, remaining_estimate_minutes:0},
        ]);
        await pool.query('UPDATE tasks SET remaining_estimate_minutes = NULL WHERE id = 1');
        await migration();
        expect((await pool.query('SELECT remaining_estimate_minutes FROM tasks WHERE id=1')).rows[0].remaining_estimate_minutes).toBeNull();
        await expect(pool.query('UPDATE tasks SET remaining_estimate_minutes=-1 WHERE id=1')).rejects.toThrow();
        await expect(pool.query('UPDATE tasks SET original_estimate_minutes=-1 WHERE id=1')).rejects.toThrow();
        const definition = async () => (await pool.query(`SELECT column_name,data_type,is_nullable FROM information_schema.columns
            WHERE table_name='tasks' AND column_name IN ('original_estimate_minutes','remaining_estimate_minutes') ORDER BY column_name`)).rows;
        const upgraded = await definition();
        await pool.query('DROP TABLE task_worklogs; DROP TABLE tasks');
        await require('../platform/db/tenantSchema').initTenantSchema((sql:string, params:unknown[]=[]) => pool.query(sql,params));
        expect(await definition()).toEqual(upgraded);
    },120_000);
});
