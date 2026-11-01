/**
 * Ticket placement against real PostgreSQL.
 *
 * The rules under test are SQL semantics (SET reads pre-update values,
 * precedence between sprint, planned day and backlog, atomicity), which a
 * mocked `db.query` cannot see. Runs only when TASKS_SCHEMA_TEST_DATABASE_URL
 * points at a local database whose name contains "test"; skipped otherwise.
 */
import crypto from "crypto";
import { Pool } from "pg";
import type { PoolClient } from "pg";
import type { TransactionContext } from "../types/domain";
import * as placementModule from "../modules/tasks/tasks.placement";
import type { PlacementChange, PlacementTarget } from "../modules/tasks/tasks.placement";

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const postgresDescribe = databaseUrl ? describe : describe.skip;

const ALPHA = 1;
const BETA = 2;
const ALICE = 1; // Alpha member
const BOB = 2; // Beta member
const ALPHA_PLANNED = 10; // ends 2026-11-14
const ALPHA_ACTIVE = 11; // ends 2026-11-28
const ALPHA_DONE = 12; // completed, ends 2026-10-31
const BETA_PLANNED = 20; // ends 2026-11-21
const ACTOR = { userId: ALICE, orgId: 1, ip: "10.0.0.1", userAgent: "jest" };

postgresDescribe("ticket placement on PostgreSQL", () => {
    const schema = `placement_${crypto.randomUUID().replace(/-/g, "")}`;
    let admin: Pool;
    let pool: Pool;
    let transaction: <T>(fn: (client: PoolClient, ctx: TransactionContext) => Promise<T>) => Promise<T>;
    const placement = () => placementModule;

    beforeAll(async () => {
        const parsed = new URL(databaseUrl!);
        const databaseName = decodeURIComponent(parsed.pathname.slice(1));
        if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(parsed.hostname)
            || !databaseName.toLowerCase().includes("test")) {
            throw new Error("TASKS_SCHEMA_TEST_DATABASE_URL must point to a local database whose name includes 'test'");
        }
        admin = new Pool({ connectionString: databaseUrl, max: 1 });
        await admin.query(`CREATE SCHEMA ${schema}`);
        pool = new Pool({ connectionString: databaseUrl, max: 2, options: `-c search_path=${schema},public` });

        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        const { initTenantSchema } = require("../platform/db/tenantSchema");
        const { runTenantMigrations } = require("../platform/db/migrations");
        const { seedAgileDefaults } = require("../platform/db/agileDefaults");
        await initTenantSchema(query);
        const migrations = await runTenantMigrations(query, { label: schema });
        expect(migrations.failed).toEqual([]);
        await seedAgileDefaults(query);

        transaction = require("../platform/db/pool").makePoolTransaction(pool);
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
        await admin?.end();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE audit_logs, task_history, tasks, sprints, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Placement', 'placement')");
        await pool.query(`INSERT INTO teams (id, org_id, name) VALUES (${ALPHA}, 1, 'Alpha'), (${BETA}, 1, 'Beta')`);
        await pool.query(`
            INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
                (${ALICE}, 'alice', 'x', 'Alice', 1, ${ALPHA}),
                (${BOB}, 'bob', 'x', 'Bob', 1, ${BETA})`);
        await pool.query(`
            INSERT INTO sprints (id, team_id, name, start_date, end_date, status) VALUES
                (${ALPHA_PLANNED}, ${ALPHA}, 'Alpha 1', '2026-11-01', '2026-11-14', 'planned'),
                (${ALPHA_ACTIVE}, ${ALPHA}, 'Alpha 2', '2026-11-15', '2026-11-28', 'active'),
                (${ALPHA_DONE}, ${ALPHA}, 'Alpha 0', '2026-10-18', '2026-10-31', 'completed'),
                (${BETA_PLANNED}, ${BETA}, 'Beta 1', '2026-11-08', '2026-11-21', 'planned')`);
    });

    interface TicketSeed {
        team_id?: number | null;
        sprint_id?: number | null;
        planned_date?: string | null;
        due_date?: string | null;
        pre_sprint_due_date?: string | null;
    }

    async function ticket(seed: TicketSeed = {}): Promise<number> {
        const row = (await pool.query(
            `INSERT INTO tasks (user_id, title, org_id, team_id, sprint_id, planned_date, due_date, pre_sprint_due_date)
             VALUES ($1, 'Ticket', 1, $2, $3, $4, $5, $6) RETURNING id`,
            [ALICE, seed.team_id === undefined ? ALPHA : seed.team_id, seed.sprint_id ?? null,
                seed.planned_date ?? null, seed.due_date ?? null, seed.pre_sprint_due_date ?? null],
        )).rows[0];
        return row.id;
    }

    /** A placement context on a real transaction; `changes` fills only after COMMIT. */
    function context(client: PoolClient, afterCommit: TransactionContext["afterCommit"], changes: PlacementChange[]) {
        return {
            db: client,
            afterCommit,
            actor: ACTOR,
            effects: { changed: (change: PlacementChange) => { changes.push(change); } },
        };
    }

    async function place(ids: number[], target: PlacementTarget) {
        const changes: PlacementChange[] = [];
        const results = await transaction((client, { afterCommit }) =>
            placementModule.placeTickets(context(client, afterCommit, changes), ids, target));
        return { results, changes };
    }

    test("a backlog ticket joining a sprint takes the sprint's end as its due date and remembers its own", async () => {
        const id = await ticket({ due_date: "2026-11-20" });

        const { results } = await place([id], { sprint: ALPHA_PLANNED });

        expect(results).toEqual([expect.objectContaining({
            id,
            ok: true,
            task: expect.objectContaining({
                sprint_id: ALPHA_PLANNED,
                due_date: "2026-11-14",
                pre_sprint_due_date: "2026-11-20",
                planned_date: null,
            }),
        })]);
    });

    test.each([
        ["a Scheduled ticket", { planned_date: "2026-11-05", due_date: "2026-11-30" }, "2026-11-30"],
        ["a sprinted ticket with a planned day", { sprint_id: ALPHA_PLANNED, planned_date: "2026-11-05", due_date: "2026-11-14", pre_sprint_due_date: "2026-11-30" }, "2026-11-30"],
    ])("%s joining a sprint keeps its planned day, which the sprint outranks", async (_label, seed, remembered) => {
        const id = await ticket(seed);

        const { results } = await place([id], { sprint: ALPHA_ACTIVE });

        expect(results[0]).toMatchObject({
            ok: true,
            task: { sprint_id: ALPHA_ACTIVE, planned_date: "2026-11-05", due_date: "2026-11-28", pre_sprint_due_date: remembered },
        });
    });

    test("a ticket already in the target sprint is left alone, including a due date edited by hand", async () => {
        const id = await ticket({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-10", pre_sprint_due_date: "2026-11-30" });

        const { results, changes } = await place([id], { sprint: ALPHA_PLANNED });

        expect(results[0]).toMatchObject({ ok: true, task: { sprint_id: ALPHA_PLANNED, due_date: "2026-11-10", pre_sprint_due_date: "2026-11-30" } });
        expect(changes).toEqual([]);
    });

    test("a Scheduled ticket moved to another day changes only its planned day", async () => {
        const id = await ticket({ planned_date: "2026-11-05", due_date: "2026-11-30" });

        const { results } = await place([id], { day: "2026-11-09" });

        expect(results[0]).toMatchObject({ ok: true, task: { planned_date: "2026-11-09", due_date: "2026-11-30", sprint_id: null } });
    });

    test("moving sprint to sprint takes the new sprint's end and keeps the remembered own due date", async () => {
        const id = await ticket({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-14", pre_sprint_due_date: "2026-11-20" });

        const { results } = await place([id], { sprint: ALPHA_ACTIVE });

        expect(results[0]).toMatchObject({
            ok: true,
            task: { sprint_id: ALPHA_ACTIVE, due_date: "2026-11-28", pre_sprint_due_date: "2026-11-20" },
        });
    });

    test.each([
        ["no planned day lands in the backlog", null],
        ["a planned day lands in Scheduled", "2026-11-05"],
    ])("leaving a sprint restores the own due date; %s", async (_label, plannedDay) => {
        const id = await ticket({
            sprint_id: ALPHA_PLANNED, planned_date: plannedDay, due_date: "2026-11-14", pre_sprint_due_date: "2026-11-20",
        });

        const { results } = await place([id], { sprint: null });

        expect(results[0]).toMatchObject({
            ok: true,
            task: { sprint_id: null, planned_date: plannedDay, due_date: "2026-11-20", pre_sprint_due_date: null },
        });
    });

    test("planning a backlog ticket onto a day moves it to Scheduled and leaves its due date alone", async () => {
        const id = await ticket({ due_date: "2026-11-30" });

        const { results } = await place([id], { day: "2026-11-06" });

        expect(results[0]).toMatchObject({ ok: true, task: { planned_date: "2026-11-06", due_date: "2026-11-30", sprint_id: null } });
    });

    test("a ticket in a sprint cannot be given a planned day", async () => {
        const id = await ticket({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-14" });

        const { results } = await place([id], { day: "2026-11-06" });

        expect(results[0]).toMatchObject({ id, ok: false, code: "IN_SPRINT" });
        expect((await pool.query("SELECT planned_date FROM tasks WHERE id = $1", [id])).rows[0].planned_date).toBeNull();
    });

    test.each([
        ["from Scheduled clears the planned day and keeps the due date", { planned_date: "2026-11-06", due_date: "2026-11-30" },
            { planned_date: null, due_date: "2026-11-30" }],
        ["from a sprint clears the sprint and the planned day and restores the own due date",
            { sprint_id: ALPHA_PLANNED, planned_date: "2026-11-06", due_date: "2026-11-14", pre_sprint_due_date: "2026-11-20" },
            { sprint_id: null, planned_date: null, due_date: "2026-11-20", pre_sprint_due_date: null }],
    ])("back to backlog %s", async (_label, seed, expected) => {
        const id = await ticket(seed);

        const { results } = await place([id], "backlog");

        expect(results[0]).toMatchObject({ ok: true, task: expected });
    });

    test.each([
        ["into a completed sprint", { due_date: "2026-11-20" }, { sprint: ALPHA_DONE }, "SPRINT_FROZEN"],
        ["out of a completed sprint", { sprint_id: ALPHA_DONE, due_date: "2026-10-31" }, "backlog", "SPRINT_FROZEN"],
        ["into another team's sprint", { due_date: "2026-11-20" }, { sprint: BETA_PLANNED }, "SPRINT_TEAM_MISMATCH"],
    ] as const)("refuses a move %s and leaves the row untouched", async (_label, seed, target, code) => {
        const id = await ticket(seed);
        const before = (await pool.query("SELECT * FROM tasks WHERE id = $1", [id])).rows[0];

        const { results, changes } = await place([id], target as PlacementTarget);

        expect(results[0]).toMatchObject({ id, ok: false, code });
        expect((await pool.query("SELECT * FROM tasks WHERE id = $1", [id])).rows[0]).toEqual(before);
        expect(changes).toEqual([]);
    });

    test("refuses a ticket that does not exist or belongs to another org", async () => {
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Other', 'other')");
        const foreign = (await pool.query(
            "INSERT INTO tasks (user_id, title, org_id) VALUES ($1, 'Foreign', 2) RETURNING id", [ALICE],
        )).rows[0].id;

        const { results } = await place([foreign, 9999], { sprint: ALPHA_PLANNED });

        expect(results).toEqual([
            expect.objectContaining({ id: foreign, ok: false, code: "NOT_FOUND" }),
            expect.objectContaining({ id: 9999, ok: false, code: "NOT_FOUND" }),
        ]);
    });

    test("refuses a sprint that is not in the actor's org", async () => {
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Other', 'other')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (3, 2, 'Gamma')");
        await pool.query("INSERT INTO sprints (id, team_id, name, start_date, end_date) VALUES (30, 3, 'G', '2026-11-01', '2026-11-14')");
        const id = await ticket({ team_id: null });

        const { results } = await place([id], { sprint: 30 });

        expect(results[0]).toMatchObject({ ok: false, code: "SPRINT_NOT_FOUND" });
    });

    test("a legacy ticket with no team adopts the sprint's team on entry", async () => {
        const id = await ticket({ team_id: null });

        const { results } = await place([id], { sprint: BETA_PLANNED });

        expect(results[0]).toMatchObject({ ok: true, task: { team_id: BETA, sprint_id: BETA_PLANNED } });
    });

    test("a bulk move applies the valid tickets and reports the refused ones", async () => {
        const mine = await ticket({ due_date: "2026-11-20" });
        const theirs = await ticket({ team_id: BETA });

        const { results } = await place([mine, theirs], { sprint: ALPHA_PLANNED });

        expect(results).toEqual([
            expect.objectContaining({ id: mine, ok: true }),
            expect.objectContaining({ id: theirs, ok: false, code: "SPRINT_TEAM_MISMATCH" }),
        ]);
        expect((await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [mine])).rows[0].sprint_id).toBe(ALPHA_PLANNED);
    });

    async function history(id: number) {
        return (await pool.query(
            "SELECT action, field, old_value, new_value, user_id FROM task_history WHERE task_id = $1 ORDER BY id",
            [id],
        )).rows;
    }

    test("joining a sprint records sprint and due-date history by sprint name", async () => {
        const id = await ticket({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-14" });

        await place([id], { sprint: ALPHA_ACTIVE });

        expect(await history(id)).toEqual([
            { action: "updated", field: "sprint", old_value: "Alpha 1", new_value: "Alpha 2", user_id: ALICE },
            { action: "updated", field: "due_date", old_value: "2026-11-14", new_value: "2026-11-28", user_id: ALICE },
        ]);
    });

    test("scheduling and returning to the backlog record planned-day history", async () => {
        const id = await ticket();

        await place([id], { day: "2026-11-06" });
        await place([id], "backlog");

        expect(await history(id)).toEqual([
            { action: "scheduled", field: "planned_date", old_value: "backlog", new_value: "2026-11-06", user_id: ALICE },
            { action: "unscheduled", field: "planned_date", old_value: "2026-11-06", new_value: "backlog", user_id: ALICE },
        ]);
    });

    async function audit(id: number) {
        return (await pool.query(
            "SELECT org_id, actor_id, action, entity_type, details, ip_address, user_agent FROM audit_logs WHERE entity_id = $1 ORDER BY id",
            [id],
        )).rows.map((row) => ({ ...row, details: JSON.parse(row.details) }));
    }

    test("a move is audited in the same transaction with who, from where and what changed", async () => {
        const id = await ticket({ due_date: "2026-11-20" });

        await place([id], { sprint: ALPHA_PLANNED });

        expect(await audit(id)).toEqual([{
            org_id: 1,
            actor_id: ALICE,
            action: "place",
            entity_type: "task",
            details: {
                from: { sprint_id: null, planned_date: null, due_date: "2026-11-20" },
                to: { sprint_id: ALPHA_PLANNED, planned_date: null, due_date: "2026-11-14" },
            },
            ip_address: "10.0.0.1",
            user_agent: "jest",
        }]);
    });

    test("a move that changes nothing writes no history and reports no change", async () => {
        const id = await ticket({ planned_date: "2026-11-06" });

        const { results, changes } = await place([id], { day: "2026-11-06" });

        expect(results[0]).toMatchObject({ ok: true });
        expect(await history(id)).toEqual([]);
        expect(changes).toEqual([]);
    });

    test("hands each committed move to effects after COMMIT, with the row before and after", async () => {
        const id = await ticket({ due_date: "2026-11-20" });
        let visibleToOthersWhenNotified: number | null = null;
        const changes: PlacementChange[] = [];

        await transaction((client, { afterCommit }) => placementModule.placeTickets({
            db: client,
            afterCommit,
            actor: ACTOR,
            effects: {
                changed: async (change: PlacementChange) => {
                    // A different connection sees the row only once it is committed.
                    visibleToOthersWhenNotified = (await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [id])).rows[0].sprint_id;
                    changes.push(change);
                },
            },
        }, [id], { sprint: ALPHA_PLANNED }));

        expect(visibleToOthersWhenNotified).toBe(ALPHA_PLANNED);
        expect(changes).toEqual([expect.objectContaining({
            before: expect.objectContaining({ sprint_id: null, due_date: "2026-11-20" }),
            after: expect.objectContaining({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-14" }),
            actor: ACTOR,
        })]);
    });

    test("a rolled-back transaction keeps the row, writes no history and tells nobody", async () => {
        const id = await ticket({ due_date: "2026-11-20" });
        const changes: PlacementChange[] = [];

        await expect(transaction(async (client, { afterCommit }) => {
            await placementModule.placeTickets(context(client, afterCommit, changes), [id], { sprint: ALPHA_PLANNED });
            throw new Error("caller failed later in the same transaction");
        })).rejects.toThrow("caller failed");

        expect((await pool.query("SELECT sprint_id, due_date FROM tasks WHERE id = $1", [id])).rows[0])
            .toEqual({ sprint_id: null, due_date: "2026-11-20" });
        expect(await history(id)).toEqual([]);
        expect(await audit(id)).toEqual([]);
        expect(changes).toEqual([]);
    });

    describe("team transfer", () => {
        async function transfer(id: number, toTeamId: number) {
            const changes: PlacementChange[] = [];
            const result = await transaction((client, { afterCommit }) =>
                placementModule.transferTicket(context(client, afterCommit, changes), id, toTeamId));
            return { result, changes };
        }

        test("leaving the team leaves its sprint like any other placement", async () => {
            const id = await ticket({
                sprint_id: ALPHA_PLANNED, planned_date: "2026-11-05", due_date: "2026-11-14", pre_sprint_due_date: "2026-11-20",
            });

            const { result, changes } = await transfer(id, BETA);

            expect(result).toMatchObject({
                ok: true,
                task: { team_id: BETA, sprint_id: null, planned_date: "2026-11-05", due_date: "2026-11-20", pre_sprint_due_date: null },
            });
            expect(await history(id)).toEqual([
                { action: "transferred", field: "team", old_value: String(ALPHA), new_value: String(BETA), user_id: ALICE },
                { action: "updated", field: "sprint", old_value: "Alpha 1", new_value: "none", user_id: ALICE },
                { action: "updated", field: "due_date", old_value: "2026-11-14", new_value: "2026-11-20", user_id: ALICE },
            ]);
            expect(changes).toEqual([expect.objectContaining({
                before: expect.objectContaining({ team_id: ALPHA }),
                after: expect.objectContaining({ team_id: BETA, sprint_id: null }),
            })]);
            expect(await audit(id)).toEqual([expect.objectContaining({
                action: "transfer",
                details: {
                    from: { team_id: ALPHA, sprint_id: ALPHA_PLANNED, planned_date: "2026-11-05", due_date: "2026-11-14" },
                    to: { team_id: BETA, sprint_id: null, planned_date: "2026-11-05", due_date: "2026-11-20" },
                },
            })]);
        });

        test.each([
            ["to its current team", {}, ALPHA, "TEAM_UNCHANGED"],
            ["to a team outside the org", {}, 99, "TEAM_NOT_FOUND"],
            ["out of a completed sprint", { sprint_id: ALPHA_DONE }, BETA, "SPRINT_FROZEN"],
        ] as const)("refuses a transfer %s", async (_label, seed, toTeamId, code) => {
            const id = await ticket(seed);

            const { result, changes } = await transfer(id, toTeamId);

            expect(result).toMatchObject({ ok: false, code });
            expect(changes).toEqual([]);
        });
    });

    describe("sprint end-date moves", () => {
        test("re-time members still on the old end and leave hand-edited due dates alone", async () => {
            const onEnd = await ticket({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-14", pre_sprint_due_date: "2026-11-30" });
            const handEdited = await ticket({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-10" });
            const elsewhere = await ticket({ sprint_id: ALPHA_ACTIVE, due_date: "2026-11-14" });
            await pool.query("UPDATE sprints SET end_date = '2026-11-17' WHERE id = $1", [ALPHA_PLANNED]);
            const changes: PlacementChange[] = [];

            const moved = await transaction((client, { afterCommit }) => placementModule.retimeSprintDueDates(
                context(client, afterCommit, changes), ALPHA_PLANNED, "2026-11-14", "2026-11-17",
            ));

            expect(moved).toBe(1);
            const dueDates = (await pool.query(
                "SELECT id, due_date, pre_sprint_due_date FROM tasks ORDER BY id",
            )).rows;
            expect(dueDates).toEqual([
                { id: onEnd, due_date: "2026-11-17", pre_sprint_due_date: "2026-11-30" },
                { id: handEdited, due_date: "2026-11-10", pre_sprint_due_date: null },
                { id: elsewhere, due_date: "2026-11-14", pre_sprint_due_date: null },
            ]);
            expect(await history(onEnd)).toEqual([
                { action: "updated", field: "due_date", old_value: "2026-11-14", new_value: "2026-11-17", user_id: ALICE },
            ]);
            expect(changes.map((c) => c.after.id)).toEqual([onEnd]);
        });

        test("refuses a sprint outside the actor's org and re-times nothing", async () => {
            await pool.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Other', 'other')");
            await pool.query("INSERT INTO teams (id, org_id, name) VALUES (3, 2, 'Gamma')");
            await pool.query("INSERT INTO sprints (id, team_id, name, start_date, end_date) VALUES (30, 3, 'G', '2026-11-01', '2026-11-14')");
            const foreign = (await pool.query(
                "INSERT INTO tasks (user_id, title, org_id, team_id, sprint_id, due_date) VALUES ($1, 'F', 2, 3, 30, '2026-11-14') RETURNING id",
                [ALICE],
            )).rows[0].id;

            const moved = await transaction((client, { afterCommit }) => placementModule.retimeSprintDueDates(
                context(client, afterCommit, []), 30, "2026-11-14", "2026-11-17",
            ));

            expect(moved).toBe(0);
            expect((await pool.query("SELECT due_date FROM tasks WHERE id = $1", [foreign])).rows[0].due_date).toBe("2026-11-14");
        });

        test("an unchanged end date moves nothing", async () => {
            await ticket({ sprint_id: ALPHA_PLANNED, due_date: "2026-11-14" });
            const changes: PlacementChange[] = [];

            const moved = await transaction((client, { afterCommit }) => placementModule.retimeSprintDueDates(
                context(client, afterCommit, changes), ALPHA_PLANNED, "2026-11-14", "2026-11-14",
            ));

            expect(moved).toBe(0);
            expect(changes).toEqual([]);
        });
    });
});
