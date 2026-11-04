/**
 * Ticket routes against real PostgreSQL (spec issue 03, seam B).
 *
 * Only the flows where the order of the move and the field update matters:
 * the mocked route suite cannot see which write wins. Runs only when
 * TASKS_SCHEMA_TEST_DATABASE_URL is set (`npm run test:pg`, or CI).
 */
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
        req.userRole = req.get("x-test-role") || "employee";
        const user = (await req.db.query(
            "SELECT org_id, team_id FROM users WHERE id = $1",
            [req.userId],
        )).rows[0];
        req.userOrgId = user?.org_id ?? 1;
        req.userTeamId = user?.team_id ?? null;
        req.roleLevel = req.userRole === "manager" || req.userRole === "super_admin" ? 2 : 1;
        req.projectOwnership = (await req.db.query(
            "SELECT project_ownership FROM organizations WHERE id = $1",
            [req.userOrgId],
        )).rows[0]?.project_ownership === true;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
    getVisibleUserIds: async () => [1, 2],
    ROLE_LEVEL: { employee: 1, manager: 2, super_admin: 4 },
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
const postgresDescribe = databaseUrl ? describe : describe.skip;

postgresDescribe("ticket routes place through the module (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    const request = require("supertest");

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "placement_routes");
        pool = new Pool({ connectionString: database.url, max: 3 });

        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        const migrations = await require("../platform/db/migrations").runTenantMigrations(query, { label: "placement_routes" });
        expect(migrations.failed).toEqual([]);
        await require("../platform/db/agileDefaults").seedAgileDefaults(query);

        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenant = { id: 1, plan: "enterprise", features: { team_visibility: true, agile: true } };
            req.tenantId = 1;
            req.db = db;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/projects", require("../routes/projects"));
        app.use("/api/manager", require("../routes/manager"));
        app.use("/api/notes", require("../routes/notes"));
    }, 120_000);

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    beforeEach(async () => {
        await pool.query("TRUNCATE audit_logs, task_history, tasks, sprints, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Routes', 'routes')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Beta')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
            (1, 'alice', 'x', 'Alice', 1, 1), (2, 'admin', 'x', 'Admin', 1, 1)`);
        await pool.query(
            "INSERT INTO sprints (id, team_id, name, start_date, end_date, status) VALUES (10, 1, 'Alpha 1', '2026-11-01', '2026-11-14', 'planned')",
        );
        // seedAgileDefaults keys workflow states by org; re-seed for org 1.
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
    });

    async function row(id: number) {
        return (await pool.query("SELECT sprint_id, planned_date, due_date, pre_sprint_due_date FROM tasks WHERE id = $1", [id])).rows[0];
    }

    function expectTicketDecision(ticket: any) {
        expect(ticket).toMatchObject({
            container: expect.stringMatching(/^(sprint|scheduled|backlog)$/),
            capabilities: {
                transitions: expect.any(Array),
                can: {
                    edit: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    changeState: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    cancel: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    transfer: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    delete: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    placeInSprint: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    schedule: expect.objectContaining({ allowed: expect.any(Boolean) }),
                },
            },
        });
    }

    test("creating straight into a sprint remembers the own due date and sets no planned day", async () => {
        const res = await request(app).post("/api/tasks").send({ title: "New", sprint_id: 10, due_date: "2026-11-20" });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            container: "sprint",
            capabilities: {
                transitions: expect.any(Array),
                can: {
                    edit: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    changeState: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    cancel: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    transfer: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    delete: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    placeInSprint: expect.objectContaining({ allowed: expect.any(Boolean) }),
                    schedule: expect.objectContaining({ allowed: expect.any(Boolean) }),
                },
            },
        });
        expect(await row(res.body.id)).toEqual({
            sprint_id: 10, planned_date: null, due_date: "2026-11-14", pre_sprint_due_date: "2026-11-20",
        });
    });

    test("a ticket created while ownership is off still returns its stored sprint-project key", async () => {
        const res = await request(app)
            .post("/api/tasks")
            .send({ title: "Stored key", sprint_id: 10 });

        expect(res.status).toBe(200);
        expect(res.body.ticket_key).toBeTruthy();
        expect(res.body.issue_key).toBe(res.body.ticket_key);
        expect(res.body.project_id).toBe((await pool.query("SELECT project_id FROM sprints WHERE id = 10")).rows[0].project_id);
        expect((await pool.query("SELECT project_ownership FROM organizations WHERE id = 1")).rows[0].project_ownership).toBe(false);
    });

    test("ticket creation honors a requested project, otherwise the team project", async () => {
        const teamProject = (await pool.query(
            `INSERT INTO projects (org_id, key, name, origin_team_id, key_published)
             VALUES (1, 'ALPHA', 'Alpha', 1, FALSE) RETURNING id`,
        )).rows[0].id;
        const teamCreated = await request(app).post("/api/tasks").send({ title: "Team project" });
        expect(teamCreated.status).toBe(200);
        expect(teamCreated.body.project_id).toBe(teamProject);
        expect(teamCreated.body.ticket_key).toBe("ALPHA-1");

        const explicitProject = (await pool.query(
            "INSERT INTO projects (org_id, key, name) VALUES (1, 'EXPLICIT', 'Explicit') RETURNING id",
        )).rows[0].id;
        const explicitCreated = await request(app).post("/api/tasks").send({
            title: "Explicit project",
            project_id: explicitProject,
            sprint_id: 10,
        });
        expect(explicitCreated.status).toBe(200);
        expect(explicitCreated.body.project_id).toBe(explicitProject);
        expect(explicitCreated.body.ticket_key).toBe("EXPLICIT-1");
    });

    test("project ownership filters real PostgreSQL ticket lists and direct reads by grants or authorship", async () => {
        await pool.query("UPDATE organizations SET project_ownership = TRUE WHERE id = 1");
        await pool.query("UPDATE users SET team_id = 2 WHERE id = 2");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (3, 1, 'Gamma')");
        const projects = (await pool.query(
            `INSERT INTO projects (org_id, key, name, origin_team_id, key_published)
             VALUES (1, 'PERSONAL', 'Personal grant', 1, FALSE),
                    (1, 'TEAM', 'Team grant', 2, FALSE),
                    (1, 'PRIVATE', 'No grant', 3, FALSE)
             RETURNING id, origin_team_id`,
        )).rows;
        const projectByTeam = new Map(projects.map((project: any) => [Number(project.origin_team_id), Number(project.id)]));
        const personalProject = projectByTeam.get(1)!;
        const teamProject = projectByTeam.get(2)!;
        const privateProject = projectByTeam.get(3)!;

        await pool.query(
            `INSERT INTO project_members (project_id, user_id, role)
             VALUES ($1, 1, 'viewer')`,
            [personalProject],
        );
        await pool.query(
            `INSERT INTO project_members (project_id, team_id, role)
             VALUES ($1, 1, 'project_admin'), ($2, 1, 'member')`,
            [personalProject, teamProject],
        );
        const { createProjectAccess } = require("../modules/tasks/tasks.projectAccess");
        const access = createProjectAccess(
            { query: (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]) },
            { userId: 1, orgId: 1, orgRole: "employee", teamIds: [1] },
        );
        expect(await access.roleForProject(personalProject)).toBe("project_admin");

        const stateId = (await pool.query(
            "SELECT id FROM workflow_states WHERE org_id = 1 AND is_initial = TRUE ORDER BY id LIMIT 1",
        )).rows[0].id;
        const tickets = (await pool.query(
            `INSERT INTO tasks (title, user_id, assigned_to, org_id, team_id, project_id, task_number, ticket_key, workflow_state_id)
             VALUES ('Personal project ticket', 1, NULL, 1, 1, $1, 1, 'PERSONAL-1', $4),
                    ('Team project ticket', 2, NULL, 1, 1, $2, 1, 'TEAM-1', $4),
                    ('Private reporter ticket', 1, NULL, 1, 1, $3, 1, 'PRIVATE-1', $4),
                    ('Private assigned ticket', 2, 1, 1, 1, $3, 2, 'PRIVATE-2', $4)
             RETURNING id, title`,
            [personalProject, teamProject, privateProject, stateId],
        )).rows;
        const ticketId = (title: string) => tickets.find((ticket: any) => ticket.title === title).id;

        const list = await request(app).get("/api/tasks/backlog");
        expect(list.status).toBe(200);
        expect(list.body.tasks.map((ticket: any) => ticket.title)).toEqual(expect.arrayContaining([
            "Personal project ticket",
            "Team project ticket",
            "Private reporter ticket",
            "Private assigned ticket",
        ]));

        const projectScope = await request(app).get(`/api/tasks/backlog?project_id=${teamProject}`);
        expect(projectScope.status).toBe(200);
        expect(projectScope.body.tasks.map((ticket: any) => ticket.title)).toEqual(["Team project ticket"]);

        const legacyTeamScope = await request(app).get("/api/tasks/backlog?team_id=2");
        expect(legacyTeamScope.status).toBe(200);
        expect(legacyTeamScope.body.tasks.map((ticket: any) => ticket.title)).toEqual(["Team project ticket"]);

        const unassigned = await request(app).get("/api/tasks/backlog?unassigned=1");
        expect(unassigned.status).toBe(200);
        expect(unassigned.body.tasks).toEqual([]);

        expect((await request(app).get(`/api/tasks/${ticketId("Personal project ticket")}/detail`)).status).toBe(200);
        expect((await request(app).get(`/api/tasks/${ticketId("Private reporter ticket")}/detail`)).status).toBe(200);
        expect((await request(app).get(`/api/tasks/${ticketId("Private assigned ticket")}/detail`)).status).toBe(200);
        const outsider = await request(app)
            .get(`/api/tasks/${ticketId("Personal project ticket")}/detail`)
            .set("x-test-user", "2");
        expect(outsider.status).toBe(403);
        const admin = await request(app)
            .get(`/api/tasks/${ticketId("Private reporter ticket")}/detail`)
            .set("x-test-role", "hr_admin");
        expect(admin.status).toBe(200);

        await pool.query("UPDATE organizations SET project_ownership = FALSE WHERE id = 1");
        const flagOff = await request(app).get("/api/tasks/backlog").set("x-test-user", "1");
        expect(flagOff.status).toBe(200);
        expect(flagOff.body.tasks.map((ticket: any) => ticket.title)).toEqual(expect.arrayContaining([
            "Personal project ticket",
            "Team project ticket",
            "Private reporter ticket",
            "Private assigned ticket",
        ]));
    });

    test("a team transfer changes the project and key while preserving the previous key as an alias", async () => {
        const created = await request(app).post("/api/tasks").send({ title: "Transfer me" });
        expect(created.status).toBe(200);
        const oldKey = created.body.ticket_key;

        const transferred = await request(app)
            .post(`/api/tasks/${created.body.id}/transfer`)
            .set("x-test-role", "super_admin")
            .send({ team_id: 2 });

        expect(transferred.status).toBe(200);
        expect(transferred.body.task.ticket_key).not.toBe(oldKey);
        expect(transferred.body.task.issue_key).toBe(transferred.body.task.ticket_key);
        expect((await pool.query(
            "SELECT key, reason FROM ticket_key_aliases WHERE task_id = $1",
            [created.body.id],
        )).rows).toEqual([{ key: oldKey, reason: "move" }]);
        expect((await pool.query(
            "SELECT origin_team_id FROM projects WHERE id = $1",
            [transferred.body.task.project_id],
        )).rows[0].origin_team_id).toBe(2);
    });

    test("read surfaces return fresh capabilities for the requesting actor", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Capability surface" });
        expect(created.status).toBe(200);
        expectTicketDecision(created.body);

        const tomorrow = (await pool.query("SELECT (CURRENT_DATE + 1)::text AS date")).rows[0].date;
        const scheduled = await request(app).post("/api/tasks").send({
            title: "Scheduled capability",
            date: tomorrow,
        });
        const scheduledList = await request(app).get("/api/tasks/scheduled");
        const dailyList = await request(app).get(`/api/tasks?date=${tomorrow}`);
        const sprintTicket = await request(app).post("/api/tasks").send({
            title: "Sprint capability",
            sprint_id: 10,
        });
        const sprintList = await request(app).get("/api/tasks?sprint_id=10");
        const search = await request(app).get("/api/tasks/search?q=Capability");
        const quicksearch = await request(app).get("/api/tasks/lookup/quicksearch?q=Capability");
        const backlog = await request(app).get("/api/tasks/backlog?search=Capability");
        const detail = await request(app).get(`/api/tasks/${created.body.id}/detail`);
        const projectId = (await pool.query(
            "INSERT INTO projects (org_id, key, name, created_by) VALUES (1, 'CAP', 'Capabilities', 1) RETURNING id",
        )).rows[0].id;
        const stateId = (await pool.query(
            "SELECT id FROM workflow_states WHERE org_id = 1 AND is_initial = TRUE ORDER BY id LIMIT 1",
        )).rows[0].id;
        const projectTask = (await pool.query(
            `INSERT INTO tasks (title, user_id, org_id, team_id, project_id, task_number, workflow_state_id)
             VALUES ('By-key capability', 1, 1, 1, $1, 1, $2) RETURNING id`,
            [projectId, stateId],
        )).rows[0];
        const byKey = await request(app).get("/api/tasks/by-key/CAP-1");
        const projectTasks = await request(app).get(`/api/projects/${projectId}/tasks`);
        expect(search.status).toBe(200);
        expect(quicksearch.status).toBe(200);
        expect(backlog.status).toBe(200);
        expect(scheduled.status).toBe(200);
        expect(scheduledList.status).toBe(200);
        expect(dailyList.status).toBe(200);
        expect(sprintTicket.status).toBe(200);
        expect(sprintList.status).toBe(200);
        expect(detail.status).toBe(200);
        expectTicketDecision(scheduled.body);
        expectTicketDecision(scheduledList.body.tasks.find((ticket: any) => ticket.id === scheduled.body.id));
        expectTicketDecision(dailyList.body.tasks.find((ticket: any) => ticket.id === scheduled.body.id));
        expectTicketDecision(sprintList.body.tasks.find((ticket: any) => ticket.id === sprintTicket.body.id));
        expectTicketDecision(search.body.find((ticket: any) => ticket.id === created.body.id));
        expectTicketDecision(quicksearch.body.tasks.find((ticket: any) => ticket.id === created.body.id));
        expectTicketDecision(backlog.body.tasks.find((ticket: any) => ticket.id === created.body.id));
        expectTicketDecision(detail.body);
        expect(byKey.status).toBe(200);
        expect(byKey.body.id).toBe(projectTask.id);
        expectTicketDecision(byKey.body);
        expect(projectTasks.status).toBe(200);
        expectTicketDecision(projectTasks.body.tasks.find((ticket: any) => ticket.id === projectTask.id));

        const member = await request(app)
            .get(`/api/tasks/search?q=Capability`)
            .set("x-test-user", "1")
            .set("x-test-role", "employee");
        const admin = await request(app)
            .get(`/api/tasks/search?q=Capability`)
            .set("x-test-user", "2")
            .set("x-test-role", "super_admin");
        const memberTicket = member.body.find((ticket: any) => ticket.id === created.body.id);
        const adminTicket = admin.body.find((ticket: any) => ticket.id === created.body.id);
        expect(memberTicket.capabilities.can.transfer).toEqual({ allowed: false, reason: "ACCESS_DENIED" });
        expect(adminTicket.capabilities.can.transfer).toEqual({ allowed: true });
    });

    test("My Work and dashboard ticket lists include actor capabilities", async () => {
        const today = (await pool.query("SELECT CURRENT_DATE::text AS date")).rows[0].date;
        const taskId = (await pool.query(
            `INSERT INTO tasks (title, user_id, org_id, team_id, planned_date)
             VALUES ('Manager dashboard capability', 1, 1, 1, $1) RETURNING id`,
            [today],
        )).rows[0].id;

        const response = await request(app)
            .get(`/api/manager/member/1/tasks?date=${today}`)
            .set("x-test-role", "manager");

        expect(response.status).toBe(200);
        expectTicketDecision(response.body.find((ticket: any) => ticket.id === taskId));
    });

    test("bulk and cancellation responses include the refreshed ticket decision", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Bulk capability" });
        const bulk = await request(app).post("/api/tasks/bulk").send({
            ids: [created.body.id], action: "assign", value: null,
        });

        expect(bulk.status).toBe(200);
        expectTicketDecision(bulk.body.results[0].ticket);

        const cancelled = await request(app).delete(`/api/tasks/${created.body.id}`);
        expect(cancelled.status).toBe(200);
        expectTicketDecision(cancelled.body.task);
        expect(cancelled.body.task.capabilities.can.cancel)
            .toEqual({ allowed: false, reason: "CANCELLED_TERMINAL" });
    });

    test("ticket mutation responses carry fresh decisions after every placement and state change", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Mutation capability" });
        expectTicketDecision(created.body);

        const edited = await request(app).put(`/api/tasks/${created.body.id}`).send({
            title: "Mutation capability updated",
            sprint_id: null,
            planned_date: null,
        });
        expect(edited.status).toBe(200);
        expectTicketDecision(edited.body);

        const targetState = (await pool.query(
            `SELECT id FROM workflow_states
             WHERE org_id = 1 AND category = 'in_progress' AND is_active = TRUE
             ORDER BY sort_order, id LIMIT 1`,
        )).rows[0].id;
        const status = await request(app).patch(`/api/tasks/${created.body.id}/status`)
            .send({ workflow_state_id: targetState });
        expect(status.status).toBe(200);
        expect(status.body.workflow_state_id).toBe(targetState);
        expectTicketDecision(status.body);

        const tomorrow = (await pool.query("SELECT (CURRENT_DATE + 1)::text AS date")).rows[0].date;
        const scheduled = await request(app).patch(`/api/tasks/${created.body.id}/schedule`)
            .send({ date: tomorrow });
        expect(scheduled.status).toBe(200);
        expectTicketDecision(scheduled.body);
        const unscheduled = await request(app).patch(`/api/tasks/${created.body.id}/unschedule`).send({});
        expect(unscheduled.status).toBe(200);
        expectTicketDecision(unscheduled.body);

        const joined = await request(app).patch(`/api/tasks/${created.body.id}/assign-sprint`)
            .send({ sprint_id: 10 });
        expect(joined.status).toBe(200);
        expectTicketDecision(joined.body);
        const left = await request(app).patch(`/api/tasks/${created.body.id}/assign-sprint`)
            .send({ sprint_id: null });
        expect(left.status).toBe(200);
        expectTicketDecision(left.body);

        const transferred = await request(app).post(`/api/tasks/${created.body.id}/transfer`)
            .set("x-test-user", "2")
            .set("x-test-role", "super_admin")
            .send({ team_id: 2 });
        expect(transferred.status).toBe(200);
        expectTicketDecision(transferred.body.task);
        expect(transferred.body.task.team_id).toBe(2);
    });

    test("leaving a sprint with an explicit due date keeps the typed date over the restored one", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New", sprint_id: 10, due_date: "2026-11-20" });

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: null, due_date: "2026-12-01" });

        expect(res.status).toBe(200);
        expect(await row(created.body.id)).toEqual({
            sprint_id: null, planned_date: null, due_date: "2026-12-01", pre_sprint_due_date: null,
        });
    });

    test("scheduling a ticket in a sprint is refused and changes nothing", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New", sprint_id: 10 });
        const before = await row(created.body.id);

        const res = await request(app).patch(`/api/tasks/${created.body.id}/schedule`).send({ date: "2026-11-06" });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("IN_SPRINT");
        expect(await row(created.body.id)).toEqual(before);
    });

    const guardedWrites = [
        ["patch", "/status", { status: "in_progress" }],
        ["put", "", { title: "Edited" }],
        ["delete", "", {}],
        ["patch", "/schedule", { date: "2026-11-06" }],
        ["patch", "/assign-sprint", { sprint_id: 10 }],
        ["post", "/transfer", { team_id: 2 }],
    ] as const;

    test.each(guardedWrites)("%s %s refuses another team's ticket with the decision reason", async (method, suffix, body) => {
        const ticket = (await pool.query(`INSERT INTO tasks (title, user_id, org_id, team_id)
            VALUES ('Other team', 1, 1, 2) RETURNING id`)).rows[0];
        const response = await request(app)[method](`/api/tasks/${ticket.id}${suffix}`).send(body);

        expect(response.status).toBe(403);
        expect(response.body.code).toBe("ACCESS_DENIED");
    });

    test.each(guardedWrites)("%s %s preserves the frozen sprint denial status", async (method, suffix, body) => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Frozen", sprint_id: 10 });
        await pool.query("UPDATE sprints SET status = 'completed' WHERE id = 10");
        const response = await request(app)[method](`/api/tasks/${created.body.id}${suffix}`).send(body);

        expect(response.status).toBe(method === "post" ? 403 : 409);
        expect(response.body.code).toBe(method === "post" ? "ACCESS_DENIED" : "SPRINT_FROZEN");
    });

    test.each(guardedWrites)("%s %s hides a different organization's ticket", async (method, suffix, body) => {
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Other', 'other')");
        const ticket = (await pool.query(`INSERT INTO tasks (title, user_id, org_id, team_id)
            VALUES ('Private', 1, 2, 1) RETURNING id`)).rows[0];
        const response = await request(app)[method](`/api/tasks/${ticket.id}${suffix}`).send(body);

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Task not found");
    });

    test("the detail editor's full save (sprint_id: null) still plans the day", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New" });

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: null, planned_date: "2026-11-06" });

        expect(res.status).toBe(200);
        expect((await row(created.body.id)).planned_date).toBe("2026-11-06");
    });

    test("editing the due date of a sprinted ticket while resending its sprint keeps the typed date", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "New", sprint_id: 10 });

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: 10, due_date: "2026-11-12" });

        expect(res.status).toBe(200);
        expect(await row(created.body.id)).toMatchObject({ sprint_id: 10, due_date: "2026-11-12" });
    });

    test("linked notes return ticket details only from the actor's organization", async () => {
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (2, 'Other org', 'other-org')");
        const local = (await pool.query(
            "INSERT INTO tasks (title, user_id, org_id, team_id) VALUES ('Our ticket', 1, 1, 1) RETURNING id",
        )).rows[0];
        const foreign = (await pool.query(
            "INSERT INTO tasks (title, user_id, org_id) VALUES ('Other org secret', 1, 2) RETURNING id",
        )).rows[0];
        await pool.query(
            `INSERT INTO note_links (user_id, page_id, entity_type, entity_id)
             VALUES (1, 'linked-tickets', 'task', $1), (1, 'linked-tickets', 'task', $2)`,
            [local.id, foreign.id],
        );

        const response = await request(app).get("/api/notes/links/linked-tickets");

        expect(response.status).toBe(200);
        expect(response.body.links).toHaveLength(2);
        expect(response.body.links.find((link: any) => link.entity_id === local.id).detail)
            .toMatchObject({ id: local.id, title: "Our ticket" });
        expect(response.body.links.find((link: any) => link.entity_id === foreign.id).detail).toBeNull();
    });

    test("a note checklist item becomes a ticket in the user's org", async () => {
        const res = await request(app).post("/api/notes/convert-to-task").send({ title: "From note" });

        expect(res.status).toBe(200);
        expect(res.body.task).toMatchObject({ title: "From note", sprint_id: null, date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
        expectTicketDecision(res.body.task);
        expect((await pool.query("SELECT org_id FROM tasks WHERE id = $1", [res.body.task.id])).rows[0].org_id).toBe(1);
    });

    test("carry-forward records one planned-day history row per copy", async () => {
        await pool.query("UPDATE users SET timezone = 'UTC' WHERE id = 1").catch(() => undefined);
        const yesterday = (await pool.query("SELECT (CURRENT_DATE - 1)::text AS d")).rows[0].d;
        const created = await request(app).post("/api/tasks").send({ title: "Yesterday", date: yesterday });
        expect(created.status).toBe(200);

        const res = await request(app).post("/api/tasks/carry-forward").send({});

        expect(res.status).toBe(200);
        const copies = (await pool.query("SELECT id FROM tasks WHERE title = 'Yesterday' AND id <> $1", [created.body.id])).rows;
        expect(copies).toHaveLength(1);
        const history = (await pool.query(
            "SELECT action, field FROM task_history WHERE task_id = $1 AND field = 'planned_date'", [copies[0].id],
        )).rows;
        expect(history).toHaveLength(1);
    });

    test("a refused sprint move on PUT rolls back the other fields too", async () => {
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Before" });
        await pool.query("UPDATE sprints SET status = 'completed' WHERE id = 10");

        const res = await request(app).put(`/api/tasks/${created.body.id}`).send({ sprint_id: 10, title: "After" });

        expect(res.status).toBe(409);
        expect((await pool.query("SELECT title FROM tasks WHERE id = $1", [created.body.id])).rows[0].title).toBe("Before");
    });
});
