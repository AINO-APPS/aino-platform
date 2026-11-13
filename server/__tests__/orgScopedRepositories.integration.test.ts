/** Repository boundaries reject another organization's ids on their own (disposable PostgreSQL). */
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import * as placement from "../modules/tasks/tasks.placementRepository";
import { findOtherActiveSprint } from "../modules/tasks/tasks.sprintLifecycle";
import { searchSprints } from "../modules/search/search.repository";

installPgTypeParsers();
jest.setTimeout(60_000);

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("organization-scoped repositories (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    const ORG = 1;
    const FOREIGN_ORG = 2;
    let db: placement.PlacementDb;
    let ownProject: number;
    let ownSprint: number;
    let ownTicket: number;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "org_scoped_repositories");
        pool = new Pool({ connectionString: database.url, max: 2 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        db = { query: async (sql, params = []) => pool.query(sql, params as any[]) as any };
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE tasks, sprints, projects, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Own', 'own'), (2, 'Foreign', 'foreign')");
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id) VALUES (1, 'u', 'x', 'U', 1)");
        ownProject = (await pool.query(
            "UPDATE projects SET type = 'scrum' WHERE org_id = 1 AND is_general RETURNING id",
        )).rows[0].id;
        ownSprint = (await pool.query(
            `INSERT INTO sprints (project_id, name, start_date, end_date, status)
             VALUES ($1, 'Active', '2026-11-01', '2026-11-14', 'active') RETURNING id`, [ownProject],
        )).rows[0].id;
        ownTicket = (await pool.query(
            "INSERT INTO tasks (user_id, org_id, project_id, sprint_id, title) VALUES (1, 1, $1, $2, 'Own ticket') RETURNING id",
            [ownProject, ownSprint],
        )).rows[0].id;
    });

    const sprintOf = async (id: number) => (await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [id])).rows[0].sprint_id;

    test("a ticket in the actor's org leaves its sprint and joins another", async () => {
        const other = (await pool.query(
            `INSERT INTO sprints (project_id, name, start_date, end_date, status)
             VALUES ($1, 'Next', '2026-11-15', '2026-11-28', 'planned') RETURNING id`, [ownProject],
        )).rows[0].id;
        expect((await placement.leaveSprint(db, ownTicket, ORG)).sprint_id).toBeNull();
        expect((await placement.joinSprint(db, ownTicket, { id: other }, ORG)).sprint_id).toBe(other);
    });

    test.each([
        ["leaveSprint", (id: number) => placement.leaveSprint(db, id, FOREIGN_ORG)],
        ["joinSprint", (id: number) => placement.joinSprint(db, id, { id: 0 }, FOREIGN_ORG)],
    ])("%s changes nothing for a ticket of another organization", async (_name, write) => {
        expect(await write(ownTicket)).toBeUndefined();
        expect(await sprintOf(ownTicket)).toBe(ownSprint);
    });

    test("setProject refuses a ticket of another organization", async () => {
        const target = (await pool.query("SELECT id FROM projects WHERE org_id = 2 AND is_general")).rows[0].id;
        const state = (await pool.query("SELECT id FROM workflow_states LIMIT 1")).rows[0]?.id ?? null;
        expect(await placement.setProject(db, ownTicket, target, 99, "FOREIGN-99", state, true, FOREIGN_ORG)).toBeUndefined();
        const row = (await pool.query("SELECT project_id, sprint_id FROM tasks WHERE id = $1", [ownTicket])).rows[0];
        expect(row).toEqual({ project_id: ownProject, sprint_id: ownSprint });
    });

    test("the running sprint check never reports another organization's sprint", async () => {
        const other = (await pool.query(
            `INSERT INTO sprints (project_id, name, start_date, end_date, status)
             VALUES ($1, 'Second', '2026-11-15', '2026-11-28', 'planned') RETURNING id`, [ownProject],
        )).rows[0].id;
        expect(await findOtherActiveSprint(db, ownProject, other, ORG)).toMatchObject({ id: ownSprint, name: "Active" });
        expect(await findOtherActiveSprint(db, ownProject, other, FOREIGN_ORG)).toBeNull();
    });

    test("sprint search never returns another organization's sprint even for a known project id", async () => {
        expect((await searchSprints(db as any, ORG, [ownProject], "%Active%")).map((s) => s.id)).toEqual([ownSprint]);
        expect(await searchSprints(db as any, FOREIGN_ORG, [ownProject], "%Active%")).toEqual([]);
    });
});
