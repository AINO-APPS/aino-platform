/** Notes embeds and converted tickets obey project access (disposable PostgreSQL). */
import { Pool } from "pg";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";

installPgTypeParsers();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1);
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: async (req: any, _res: any, next: any) => {
        const user = (await req.db.query("SELECT org_id, team_id, role FROM users WHERE id = $1", [req.userId])).rows[0];
        req.userRole = user.role;
        req.userOrgId = user.org_id;
        req.userTeamId = user.team_id;
        req.userTeamIds = user.team_id == null ? [] : [Number(user.team_id)];
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    ROLE_LEVEL: { employee: 1, team_lead: 2, hr_admin: 4, super_admin: 5 },
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn(), broadcast: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/mailer", () => ({ notifyByEmail: jest.fn(), sendMail: jest.fn() }));

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
jest.setTimeout(60_000);

(databaseUrl ? describe : describe.skip)("Notes project access (PostgreSQL)", () => {
    const request = require("supertest");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    let generalId: number;
    let sprintId: number;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "notes_access");
        pool = new Pool({ connectionString: database.url, max: 3 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenant = { id: 1, plan: "enterprise", features: { agile: true } };
            req.tenantId = 1;
            req.db = db;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/notes", require("../routes/notes"));
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE task_history, tasks, sprints, projects, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Notes', 'notes')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id, role) VALUES
            (1, 'member', 'x', 'Member', 1, 1, 'employee'),
            (2, 'outsider', 'x', 'Outsider', 1, 1, 'employee')`);
        await require("../platform/db/agileDefaults").seedAgileDefaults(
            (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]),
        );
        generalId = (await pool.query(
            "UPDATE projects SET type = 'scrum', key_published = TRUE WHERE org_id = 1 AND is_general RETURNING id",
        )).rows[0].id;
        await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, 1, 'member')", [generalId]);
        sprintId = (await pool.query(
            `INSERT INTO sprints (project_id, name, start_date, end_date, status)
             VALUES ($1, 'General sprint', '2026-11-01', '2026-11-14', 'active') RETURNING id`,
            [generalId],
        )).rows[0].id;
        await pool.query(
            "INSERT INTO tasks (user_id, org_id, project_id, sprint_id, title) VALUES (1, 1, $1, $2, 'Restricted ticket')",
            [generalId, sprintId],
        );
    });

    test("a project member sees the General sprint embed", async () => {
        const response = await request(app).get("/api/notes/sprint-embed").set("x-test-user", "1");
        expect(response.status).toBe(200);
        expect(response.body.sprint).toMatchObject({ id: sprintId, name: "General sprint" });
        expect(response.body.tasks.map((task: any) => task.title)).toEqual(["Restricted ticket"]);
    });

    test("an actor with no role in the General project gets no sprint, tickets or statistics", async () => {
        const response = await request(app).get("/api/notes/sprint-embed").set("x-test-user", "2");
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ sprint: null, tasks: [] });
    });

    test("a project member converts a checklist item into a General ticket", async () => {
        const response = await request(app).post("/api/notes/convert-to-task").set("x-test-user", "1").send({ title: "Follow up" });
        expect(response.status).toBe(200);
        expect(response.body.task.sprint_id).toBe(sprintId);
        expect((await pool.query("SELECT project_id FROM tasks WHERE id = $1", [response.body.task.id])).rows[0].project_id).toBe(generalId);
    });

    test("an actor with no create role in General cannot convert an item and nothing is inserted", async () => {
        const response = await request(app).post("/api/notes/convert-to-task").set("x-test-user", "2").send({ title: "Sneaky" });
        expect(response.status).toBe(403);
        expect(response.body.code).toBe("READ_ONLY_ROLE");
        expect((await pool.query("SELECT COUNT(*)::int AS n FROM tasks WHERE title = 'Sneaky'")).rows[0].n).toBe(0);
    });

    test("an archived General project refuses conversion even with no active sprint", async () => {
        await pool.query("UPDATE sprints SET status = 'completed' WHERE id = $1", [sprintId]);
        await pool.query("UPDATE projects SET is_archived = TRUE WHERE id = $1", [generalId]);
        const response = await request(app).post("/api/notes/convert-to-task").set("x-test-user", "1").send({ title: "Too late" });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe("PROJECT_ARCHIVED");
        expect((await pool.query("SELECT COUNT(*)::int AS n FROM tasks WHERE title = 'Too late'")).rows[0].n).toBe(0);
    });
});
