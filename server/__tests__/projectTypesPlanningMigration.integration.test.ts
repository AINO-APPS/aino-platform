import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
jest.setTimeout(120_000);

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("project planning migration 0032 (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let migration: string;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_planning_migration");
        pool = new Pool({ connectionString: database.url, max: 2 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);

        const migrationsDir = path.join(__dirname, "..", "platform", "db", "migrations");
        const files = fs.readdirSync(migrationsDir)
            .filter((file) => /^\d{4}_.*\.sql$/.test(file) && file < "0032_")
            .sort();
        for (const file of files) {
            await query(fs.readFileSync(path.join(migrationsDir, file), "utf8"));
        }
        migration = fs.readFileSync(path.join(migrationsDir, "0032_project_types_scrum_planning.sql"), "utf8");

        await query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Planning migration', 'planning-migration')");
        await query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Planning')");
        await query("INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES (1, 'planner', 'x', 'Planner', 1, 1)");
        await require("../platform/db/agileDefaults").seedAgileDefaults(query);
        await query(`
            INSERT INTO projects (id, org_id, key, name, type, origin_team_id) VALUES
                (10, 1, 'AUTO', 'All automatic', 'scrum', 1),
                (20, 1, 'MIXED', 'Mixed history', 'scrum', NULL)
        `);
        await query(`
            INSERT INTO sprints (id, project_id, team_id, name, start_date, end_date, status, auto_managed) VALUES
                (101, 10, 1, 'Auto active', '2026-11-01', '2026-11-14', 'active', TRUE),
                (102, 10, 1, 'Auto paused', '2026-11-15', '2026-11-28', 'paused', TRUE),
                (103, 10, 1, 'Auto planned', '2026-11-29', '2026-12-12', 'planned', TRUE),
                (104, 10, 1, 'Auto completed', '2026-10-18', '2026-10-31', 'completed', TRUE),
                (201, 20, 1, 'Manual history', '2026-10-18', '2026-10-31', 'completed', FALSE)
        `);
        const states = await pool.query<{ id: number; category: string }>(
            "SELECT id, category FROM workflow_states WHERE org_id = 1",
        );
        const openState = states.rows.find((row) => row.category !== "done")?.id;
        const doneState = states.rows.find((row) => row.category === "done")?.id;
        if (!openState || !doneState) throw new Error("Agile defaults must include open and done workflow states");

        await query(`
            INSERT INTO tasks (id, user_id, title, org_id, team_id, project_id, sprint_id, workflow_state_id, due_date, pre_sprint_due_date)
            VALUES
                (1001, 1, 'Restorable open ticket', 1, 1, 10, 101, $1, '2026-11-14', '2026-12-01'),
                (1002, 1, 'Hand-edited open ticket', 1, 1, 10, 101, $1, '2026-11-10', '2026-12-02'),
                (1003, 1, 'Finished active ticket', 1, 1, 10, 101, $2, '2026-11-14', '2026-12-03'),
                (1004, 1, 'Paused open ticket', 1, 1, 10, 102, $1, NULL, '2026-12-04'),
                (1005, 1, 'Planned ticket', 1, 1, 10, 103, $1, NULL, NULL),
                (1006, 1, 'Completed sprint ticket', 1, 1, 10, 104, $1, '2026-10-31', '2026-12-05'),
                (2001, 1, 'Mixed history ticket', 1, 1, 20, 201, $1, NULL, NULL)
        `, [openState, doneState]);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    test("restores only sprint-end due dates, closes automatic sprints and converts all-auto projects", async () => {
        await pool.query(migration);
        await pool.query(migration);

        const tickets = await pool.query(
            "SELECT id, sprint_id, due_date::text, pre_sprint_due_date::text FROM tasks WHERE id BETWEEN 1001 AND 1006 ORDER BY id",
        );
        expect(tickets.rows).toEqual([
            { id: 1001, sprint_id: null, due_date: "2026-12-01", pre_sprint_due_date: null },
            { id: 1002, sprint_id: null, due_date: "2026-11-10", pre_sprint_due_date: null },
            { id: 1003, sprint_id: 101, due_date: "2026-12-03", pre_sprint_due_date: null },
            { id: 1004, sprint_id: null, due_date: null, pre_sprint_due_date: null },
            { id: 1005, sprint_id: null, due_date: null, pre_sprint_due_date: null },
            { id: 1006, sprint_id: 104, due_date: "2026-12-05", pre_sprint_due_date: null },
        ]);

        const sprints = await pool.query("SELECT id, status FROM sprints ORDER BY id");
        expect(sprints.rows).toEqual([
            { id: 101, status: "completed" },
            { id: 102, status: "completed" },
            { id: 104, status: "completed" },
            { id: 201, status: "completed" },
        ]);
        expect((await pool.query("SELECT type, kanban_backlog_enabled FROM projects WHERE id = 10")).rows[0])
            .toEqual({ type: "kanban", kanban_backlog_enabled: false });
        expect((await pool.query("SELECT type FROM projects WHERE id = 20")).rows[0].type).toBe("scrum");

        const history = await pool.query(
            "SELECT task_id, action, field, old_value, new_value FROM task_history WHERE task_id BETWEEN 1001 AND 1006 ORDER BY task_id, id",
        );
        expect(history.rows).toEqual(expect.arrayContaining([
            { task_id: 1001, action: "updated", field: "due_date", old_value: "2026-11-14", new_value: "2026-12-01" },
            { task_id: 1002, action: "updated", field: "sprint", old_value: "Auto active", new_value: "none" },
            { task_id: 1004, action: "updated", field: "sprint", old_value: "Auto paused", new_value: "none" },
            { task_id: 1005, action: "updated", field: "sprint", old_value: "Auto planned", new_value: "none" },
        ]));
        expect(history.rows.filter((row) => row.field === "due_date" && row.task_id === 1002)).toHaveLength(0);
    });
});
