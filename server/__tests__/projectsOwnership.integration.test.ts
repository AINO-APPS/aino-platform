import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;
jest.setTimeout(120_000);

postgresDescribe("projects own tickets expansion (PostgreSQL migration seam)", () => {
    let pool: Pool;
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
    const migration = () => fs.readFileSync(path.join(__dirname, "../platform/db/migrations/0019_projects_own_tickets.sql"), "utf8");

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_ownership");
        pool = new Pool({ connectionString: database.url, max: 1 });
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        const dir = path.join(__dirname, "../platform/db/migrations");
        for (const file of fs.readdirSync(dir).filter(f => /^\d{4}_.*\.sql$/.test(f) && f < "0019_").sort()) {
            await query(fs.readFileSync(path.join(dir, file), "utf8"));
        }
        await query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Test', 'test')");
        await query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Al-pha'), (3, 1, '9'), (4, 1, 'Support')");
        await query(`INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
            (1, 'lead', 'unused', 'Lead', 1, 1), (2, 'other', 'unused', 'Other', 1, 2)`);
        await query("UPDATE teams SET lead_id = 1 WHERE id = 1");
        await query(`INSERT INTO projects (id, org_id, key, name, lead_user_id, next_task_number) VALUES
            (100, 1, 'ALPHA', 'Existing', 1, 8), (101, 1, 'GEN', 'Collision', NULL, 2)`);
        // Some historical tenants contain teamless sprints; the old baseline did not allow them.
        await query("ALTER TABLE sprints ALTER COLUMN team_id DROP NOT NULL");
        await query(`INSERT INTO sprints (id, team_id, name, start_date, end_date) VALUES
            (10, 1, 'Mixed', '2026-11-01', '2026-11-14'),
            (11, 2, 'Tie', '2026-11-01', '2026-11-14'),
            (12, NULL, 'No team', '2026-11-01', '2026-11-14'),
            (13, 2, 'Empty', '2026-11-01', '2026-11-14')`);
        await query(`INSERT INTO tasks (id, title, user_id, org_id, team_id, project_id, task_number, sprint_id, created_at) VALUES
            (1, 'Existing key', 1, 1, 1, 100, 7, 10, '2026-01-01'),
            (2, 'Existing majority', 2, 1, 2, 100, 3, 10, '2026-01-02'),
            (3, 'Minority moves', 1, 1, 1, 101, 1, 10, '2026-01-03'),
            (4, 'Legacy older', 1, 1, 1, NULL, NULL, NULL, '2026-01-04'),
            (5, 'Legacy newer', 1, 1, 1, NULL, NULL, NULL, '2026-01-05'),
            (6, 'Teamless', 1, 1, NULL, NULL, NULL, NULL, '2026-01-06'),
            (7, 'Tie one', 1, 1, 2, 100, 4, 11, '2026-01-07'),
            (8, 'Tie two', 1, 1, 2, 101, 2, 11, '2026-01-08')`);
    });

    afterAll(async () => { await pool?.end(); await database?.drop(); });

    test("backfills keys, deterministic projects, sprint majority and reviewable aliases without enabling ownership", async () => {
        await query(migration());
        const projects = (await query("SELECT * FROM projects ORDER BY id")).rows;
        expect(projects).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'ALPHA', type: 'scrum', key_published: true }),
            expect.objectContaining({ key: 'ALPHA1', origin_team_id: 1, name: 'Alpha', type: 'scrum', key_published: false }),
            expect.objectContaining({ key: 'ALPHA2', origin_team_id: 2, type: 'scrum', key_published: false }),
            expect.objectContaining({ key: 'GEN1', is_general: true, type: 'task_list' }),
            expect.objectContaining({ origin_team_id: 4, type: 'task_list' }),
        ]));
        expect(projects.filter(p => p.origin_team_id !== null)).toHaveLength(4);
        const tickets = (await query("SELECT id, project_id, task_number, ticket_key FROM tasks ORDER BY id")).rows;
        expect(tickets[0].ticket_key).toBe('ALPHA-7');
        expect(tickets[1].ticket_key).toBe('ALPHA-3');
        expect(tickets[2].ticket_key).toBe('ALPHA-8');
        expect(tickets[3].ticket_key).toBe('ALPHA1-1');
        expect(tickets[4].ticket_key).toBe('ALPHA1-2');
        expect(tickets[5].ticket_key).toBe('GEN1-1');
        expect(new Set(tickets.map(t => t.ticket_key)).size).toBe(8);
        const alpha = projects.find(p => p.origin_team_id === 2)!;
        expect((await query("SELECT project_id FROM sprints WHERE id = 10")).rows[0].project_id).toBe(100);
        expect((await query("SELECT project_id FROM sprints WHERE id = 11")).rows[0].project_id).toBe(alpha.id);
        expect((await query("SELECT project_id FROM sprints WHERE id = 12")).rows[0].project_id).toBe(projects.find(p => p.is_general).id);
        expect((await query("SELECT project_id FROM sprints WHERE id = 13")).rows[0].project_id).toBe(alpha.id);
        expect((await query("SELECT * FROM ticket_key_aliases WHERE task_id = 3")).rows[0]).toMatchObject({ key: 'GEN-1', reason: 'migration' });
        expect((await query("SELECT task_id FROM project_migration_moves ORDER BY task_id")).rows.map(r => r.task_id)).toEqual([3, 7, 8]);
        expect((await query("SELECT project_ownership FROM organizations WHERE id = 1")).rows[0].project_ownership).toBe(false);
        expect((await query("SELECT service_desk_project_id FROM organizations WHERE id = 1")).rows[0].service_desk_project_id).toBeNull();
        expect((await query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'project_id'")).rows[0].is_nullable).toBe('NO');
        expect((await query("SELECT is_nullable FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'ticket_key'")).rows[0].is_nullable).toBe('NO');
        expect((await query("SELECT * FROM project_members WHERE project_id = 100")).rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ user_id: 1, role: 'project_admin' }),
            expect.objectContaining({ team_id: 1, role: 'member' }),
            expect.objectContaining({ team_id: 2, role: 'member' }),
        ]));
        const generatedAlpha = projects.find(p => p.origin_team_id === 1);
        expect((await query("SELECT user_id, team_id, role FROM project_members WHERE project_id = $1", [generatedAlpha.id])).rows).toEqual(expect.arrayContaining([
            expect.objectContaining({ user_id: 1, role: 'project_admin' }),
            expect.objectContaining({ team_id: 1, role: 'member' }),
        ]));
        const snapshot = async () => (await query(`SELECT jsonb_build_object(
            'projects', (SELECT jsonb_agg(p ORDER BY id) FROM projects p),
            'tickets', (SELECT jsonb_agg(t ORDER BY id) FROM tasks t),
            'sprints', (SELECT jsonb_agg(s ORDER BY id) FROM sprints s),
            'grants', (SELECT jsonb_agg(m ORDER BY id) FROM project_members m),
            'aliases', (SELECT jsonb_agg(a ORDER BY id) FROM ticket_key_aliases a),
            'moves', (SELECT jsonb_agg(m ORDER BY task_id) FROM project_migration_moves m)) AS data`)).rows[0].data;
        const before = await snapshot();
        await query(migration());
        expect(await snapshot()).toEqual(before);

        const { findByIssueKey } = require("../modules/tasks/tasks.repository");
        expect((await findByIssueKey({ query }, 1, "GEN", 1)).id).toBe(3);

        const generalId = projects.find(p => p.is_general).id;
        const alphaId = projects.find(p => p.origin_team_id === 1).id;
        const explicit = await query(
            `INSERT INTO tasks (id, user_id, org_id, team_id, project_id, sprint_id, title)
             VALUES (1000, 1, 1, 2, 100, 11, 'Explicit project') RETURNING project_id, ticket_key`,
        );
        const sprintDefault = await query(
            `INSERT INTO tasks (id, user_id, org_id, team_id, sprint_id, title)
             VALUES (1001, 1, 1, 1, 11, 'Sprint project') RETURNING project_id, ticket_key`,
        );
        const teamDefault = await query(
            `INSERT INTO tasks (id, user_id, org_id, team_id, title)
             VALUES (1002, 1, 1, 1, 'Team project') RETURNING project_id, ticket_key`,
        );
        const generalDefault = await query(
            `INSERT INTO tasks (id, user_id, org_id, title)
             VALUES (1003, 1, 1, 'General project') RETURNING project_id, ticket_key`,
        );
        expect(explicit.rows[0].project_id).toBe(100);
        expect(sprintDefault.rows[0].project_id).toBe(alpha.id);
        expect(teamDefault.rows[0].project_id).toBe(alphaId);
        expect(generalDefault.rows[0].project_id).toBe(generalId);
        for (const result of [explicit, sprintDefault, teamDefault, generalDefault]) {
            expect(result.rows[0].ticket_key).toMatch(/^[A-Z][A-Z0-9_]{1,9}-\d+$/);
        }

        const newSprint = await query(
            `INSERT INTO sprints (team_id, name, start_date, end_date)
             VALUES (1, 'Project default', '2026-11-15', '2026-11-28') RETURNING project_id`,
        );
        expect(newSprint.rows[0].project_id).toBe(alphaId);
        await query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Second', 'second')");
        expect((await query("SELECT key FROM projects WHERE org_id = 2 AND is_general")).rows[0].key).toBe('GEN');
    });
});
