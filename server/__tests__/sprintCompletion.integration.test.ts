import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { TransactionContext } from "../types/domain";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { completeSprint } from "../services/sprintCompletion";
import { placeTickets } from "../modules/tasks/tasks.placement";
import { __test__ as schedulerTest } from "../services/sprintScheduler";

installPgTypeParsers();

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe("sprint completion on PostgreSQL", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let db: {
        query: (sql: string, params?: unknown[]) => Promise<any>;
        transaction: <T>(fn: (client: PoolClient, ctx: TransactionContext) => Promise<T>) => Promise<T>;
    };
    let openStateId: number;
    let doneStateId: number;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "sprintcompletion");
        pool = new Pool({ connectionString: database.url, max: 4 });

        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        const { initTenantSchema } = require("../platform/db/tenantSchema");
        const { runTenantMigrations } = require("../platform/db/migrations");
        await initTenantSchema(query);
        const migrations = await runTenantMigrations(query, { label: "sprintcompletion" });
        expect(migrations.failed).toEqual([]);

        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        db = {
            query: makePoolQuery(pool),
            transaction: makePoolTransaction(pool),
        };
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE audit_logs, task_history, tasks, sprints, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Placement', 'placement')");
        const { seedAgileDefaults } = require("../platform/db/agileDefaults");
        await seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
        const states = (await pool.query(
            "SELECT id, is_terminal FROM workflow_states ORDER BY id",
        )).rows;
        openStateId = Number(states.find((state) => !state.is_terminal)!.id);
        doneStateId = Number(states.find((state) => state.is_terminal)!.id);
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha')");
        await pool.query(`
            INSERT INTO users (id, username, password, full_name, org_id, team_id)
            VALUES (1, 'alice', 'x', 'Alice', 1, 1)`);
        await pool.query("UPDATE projects SET type = 'scrum' WHERE org_id = 1");
        await pool.query(`
            INSERT INTO sprints (id, team_id, name, start_date, end_date, status)
            VALUES
                (10, 1, 'Current', '2026-11-01', '2026-11-14', 'active'),
                (11, 1, 'Next', '2026-11-15', '2026-11-28', 'planned')`);
    });

    async function ticket(options: {
        sprintId: number;
        workflowStateId: number;
        dueDate?: string | null;
        preSprintDueDate?: string | null;
        plannedDate?: string | null;
        storyPoints?: number;
    }): Promise<number> {
        return Number((await pool.query(
            `INSERT INTO tasks
                (user_id, title, org_id, team_id, sprint_id, workflow_state_id, due_date, planned_date, story_points, pre_sprint_due_date)
             VALUES (1, 'Ticket', 1, 1, $1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [
                options.sprintId,
                options.workflowStateId,
                options.dueDate ?? null,
                options.plannedDate ?? null,
                options.storyPoints ?? null,
                options.preSprintDueDate ?? null,
            ],
        )).rows[0].id);
    }

    const actor = { userId: 1, orgId: 1 };
    const effects = { changed: jest.fn() };

    beforeEach(() => effects.changed.mockReset());

    test("concurrent completions claim once and carry tickets using the target sprint end date", async () => {
        const id = await ticket({
            sprintId: 10,
            workflowStateId: openStateId,
            dueDate: "2026-11-14",
            preSprintDueDate: "2026-12-10",
        });
        const doneId = await ticket({ sprintId: 10, workflowStateId: doneStateId, storyPoints: 3 });

        const completions = await Promise.all([
            completeSprint(db, { sprintId: 10, targetSprintId: 11, actor, effects }),
            completeSprint(db, { sprintId: 10, targetSprintId: 11, actor, effects }),
        ]);

        expect(completions.filter(Boolean)).toHaveLength(1);
        expect(completions.filter((result) => result === null)).toHaveLength(1);
        expect(completions.find((result) => result !== null)).toMatchObject({
            velocity: 3,
            doneTasks: 1,
            totalTasks: 2,
            rolledOver: 1,
        });
        const moved = (await pool.query(
            "SELECT sprint_id, due_date, pre_sprint_due_date, carried_over_from_sprint_id FROM tasks WHERE id = $1",
            [id],
        )).rows[0];
        expect(moved).toMatchObject({
            sprint_id: 11,
            due_date: "2026-11-28",
            pre_sprint_due_date: "2026-12-10",
            carried_over_from_sprint_id: 10,
        });
        expect((await pool.query("SELECT status FROM sprints WHERE id = 10")).rows[0].status).toBe("completed");
        expect((await pool.query("SELECT id FROM task_history WHERE task_id = $1 AND field = 'sprint'", [id])).rows).toHaveLength(1);
        expect((await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [doneId])).rows[0].sprint_id).toBe(10);
        expect(effects.changed).toHaveBeenCalledTimes(1);
    });

    test("a completion request from another organization cannot claim the sprint", async () => {
        const id = await ticket({ sprintId: 10, workflowStateId: openStateId });

        const result = await completeSprint(db, {
            sprintId: 10,
            targetSprintId: null,
            actor: { userId: 1, orgId: 2 },
            effects,
        });

        expect(result).toBeNull();
        expect((await pool.query("SELECT status FROM sprints WHERE id = 10")).rows[0].status).toBe("active");
        expect((await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [id])).rows[0].sprint_id).toBe(10);
    });

    test("concurrent placement and completion serialize without losing the ticket", async () => {
        const id = await ticket({ sprintId: 10, workflowStateId: openStateId });

        const [placement, completion] = await Promise.all([
            db.transaction((client, { afterCommit }) =>
                placeTickets({ db: client, afterCommit, actor, effects }, [id], "backlog")),
            completeSprint(db, { sprintId: 10, targetSprintId: null, actor, effects }),
        ]);

        expect(completion).not.toBeNull();
        expect(placement[0]).toMatchObject({ id, ok: expect.any(Boolean) });
        if (!placement[0].ok) expect(placement[0].code).toBe("SPRINT_FROZEN");
        expect((await pool.query("SELECT status FROM sprints WHERE id = 10")).rows[0].status).toBe("completed");
        expect((await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [id])).rows[0].sprint_id).toBeNull();
        expect((await pool.query("SELECT id FROM task_history WHERE task_id = $1 AND field = 'sprint'", [id])).rows).toHaveLength(1);
    });

    test("scheduler rollover uses the next sprint's end date and placement history", async () => {
        const id = await ticket({
            sprintId: 10,
            workflowStateId: openStateId,
            dueDate: "2026-11-14",
            preSprintDueDate: "2026-12-10",
        });

        await schedulerTest.completeAndRollover(db, 10, 11, 1);

        const moved = (await pool.query(
            "SELECT sprint_id, due_date, pre_sprint_due_date, carried_over_from_sprint_id FROM tasks WHERE id = $1",
            [id],
        )).rows[0];
        expect(moved).toMatchObject({
            sprint_id: 11,
            due_date: "2026-11-28",
            pre_sprint_due_date: "2026-12-10",
            carried_over_from_sprint_id: 10,
        });
        expect((await pool.query("SELECT id FROM task_history WHERE task_id = $1 AND field = 'sprint'", [id])).rows).toHaveLength(1);
    });

    test("completion moves unfinished tickets out while preserving planned day and restoring their due date", async () => {
        const id = await ticket({
            sprintId: 10,
            workflowStateId: openStateId,
            dueDate: "2026-11-14",
            preSprintDueDate: "2026-12-10",
            plannedDate: "2026-11-07",
        });

        await completeSprint(db, { sprintId: 10, targetSprintId: null, actor, effects });

        const moved = (await pool.query(
            "SELECT sprint_id, planned_date, due_date, pre_sprint_due_date FROM tasks WHERE id = $1",
            [id],
        )).rows[0];
        expect(moved).toMatchObject({
            sprint_id: null,
            planned_date: "2026-11-07",
            due_date: "2026-12-10",
            pre_sprint_due_date: null,
        });
    });

    test("a placement failure rolls back the claim and burndown snapshot", async () => {
        const id = await ticket({ sprintId: 10, workflowStateId: openStateId });

        await expect(completeSprint(db, {
            sprintId: 10,
            targetSprintId: 11,
            actor: { userId: 999, orgId: 1 },
            effects,
        })).rejects.toThrow();

        expect((await pool.query("SELECT status, completed_at FROM sprints WHERE id = 10")).rows[0]).toMatchObject({
            status: "active",
            completed_at: null,
        });
        expect((await pool.query("SELECT id FROM sprint_burndown_snapshots WHERE sprint_id = 10")).rows).toHaveLength(0);
        expect((await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [id])).rows[0].sprint_id).toBe(10);
        expect(effects.changed).not.toHaveBeenCalled();
    });
});
