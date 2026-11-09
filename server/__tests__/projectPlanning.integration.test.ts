import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
jest.setTimeout(120_000);
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 1;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: async (req: any, _res: any, next: any) => {
        req.userOrgId = 1;
        req.userTeamId = 1;
        req.userRole = req.get("x-role") || "team_lead";
        req.projectOwnership = req.get("x-legacy") !== "1";
        next();
    },
    requireRole: () => (req: any, res: any, next: any) =>
        req.userRole === "employee" ? res.status(403).json({ error: "Lead required" }) : next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
    ROLE_LEVEL: { employee: 1, team_lead: 2, hr_admin: 4, super_admin: 5 },
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn(), broadcast: jest.fn(), sendToUser: jest.fn() }));

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("project planning routes (PostgreSQL)", () => {
    const request = require("supertest");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_planning");
        pool = new Pool({ connectionString: database.url, max: 3 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
            req.tenant = { id: 1, plan: "enterprise", features: { agile: true, team_visibility: true } };
            req.tenantId = 1;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/sprints", require("../routes/sprintCompletion"));
        app.use("/api/sprints", require("../routes/sprints"));
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/projects", require("../routes/projects"));
        app.use("/api/organization", require("../routes/organization"));
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        await pool.query("TRUNCATE tasks, sprints, projects, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug, project_ownership) VALUES (1, 'Planning', 'planning', TRUE)");
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Team'), (2, 1, 'Other')");
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES (1, 'planner', 'x', 'Planner', 1, 1)");
        await pool.query(`INSERT INTO projects (id, org_id, key, name, origin_team_id) VALUES
            (10, 1, 'ONE', 'One', 1), (20, 1, 'TWO', 'Two', NULL), (30, 1, 'HIDE', 'Hidden', 2)`);
        await pool.query("UPDATE projects SET type = 'scrum' WHERE id IN (10, 20, 30)");
        await pool.query("INSERT INTO project_members (project_id, team_id, role) VALUES (10, 1, 'member'), (20, 1, 'member')");
    });

    test("my projects picker includes only active projects where the actor can create tickets", async () => {
        await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES (30, 1, 'viewer')");
        await pool.query("UPDATE projects SET is_archived = TRUE WHERE id = 20");
        const picker = await request(app).get("/api/projects/mine");
        expect(picker.status).toBe(200);
        expect(picker.body.map((project: any) => project.id)).toEqual([10]);
        expect(picker.body[0].capabilities.canCreateTickets).toBe(true);
        const admin = await request(app).get("/api/projects/mine").set("x-role", "super_admin");
        expect(admin.body.map((project: any) => project.id).sort((a: number, b: number) => a - b))
            .toEqual([1, 10, 30]);
    });

    test("creates a sprint in the selected project, not the actor's generated team project", async () => {
        const created = await request(app).post("/api/sprints").send({
            project_id: 20, name: "Second stream", start_date: "2026-11-01", end_date: "2026-11-14",
        });
        expect(created.status).toBe(200);
        expect(created.body.sprint).toMatchObject({ project_id: 20, name: "Second stream" });
        const listed = await request(app).get("/api/sprints?project_id=10");
        expect(listed.body.sprints).toEqual([]);
        const selected = await request(app).get("/api/sprints?project_id=20");
        expect(selected.body.sprints.map((sprint: any) => sprint.id)).toEqual([created.body.sprint.id]);
    });

    test.each(["/api/tasks", "/api/tasks/backlog"])("%s resolves request, sprint, team and General ownership and refuses invalid projects", async (path) => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date) VALUES
            (200, 20, 'Second', '2026-11-01', '2026-11-14')`);
        const create = (body: any) => request(app).post(path).send({ title: "New ticket", ...body });
        const explicit = await create({ project_id: 20 });
        expect(explicit.status).toBe(200);
        expect(explicit.body).toMatchObject({ project_id: 20, ticket_key: "TWO-1" });
        const sprint = await create({ sprint_id: 200 });
        expect(sprint.status).toBe(200);
        expect(sprint.body).toMatchObject({ project_id: 20, sprint_id: 200 });
        const legacy = await create({});
        expect(legacy.status).toBe(200);
        expect(legacy.body.project_id).toBe(10);
        await pool.query("UPDATE projects SET origin_team_id = NULL WHERE id = 10");
        const general = await request(app).post(path).set("x-role", "super_admin").send({ title: "General fallback" });
        expect(general.status).toBe(200);
        expect(general.body.project_id).toBe(1);
        const invalid = await create({ project_id: "not-an-id" });
        expect(invalid.status).toBe(400);
        const partial = await create({ project_id: "20garbage" });
        expect(partial.status).toBe(400);
        await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES (30, 1, 'viewer')");
        const viewer = await create({ project_id: 30 });
        expect(viewer.status).toBe(403);
        expect(viewer.body.code).toBe("READ_ONLY_ROLE");
        await pool.query("UPDATE projects SET is_archived = TRUE WHERE id = 20");
        const archived = await create({ project_id: 20 });
        expect(archived.status).toBe(409);
        expect(archived.body.code).toBe("PROJECT_ARCHIVED");
    });

    test("create, edit, bulk and plan placement refuse another project's sprint without changing the ticket", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date) VALUES
            (200, 20, 'Second', '2026-11-01', '2026-11-14')`);
        for (const path of ["/api/tasks", "/api/tasks/backlog"]) {
            const created = await request(app).post(path).send({ title: "Mismatch", project_id: 10, sprint_id: 200 });
            expect(created.status).toBe(409);
            expect(created.body.code).toBe("SPRINT_PROJECT_MISMATCH");
        }
        const created = await request(app).post("/api/tasks/backlog").send({ title: "Keep here", project_id: 10 });
        expect(created.status).toBe(200);
        const id = created.body.id;
        const edited = await request(app).put(`/api/tasks/${id}`).send({ title: "Wrong sprint", sprint_id: 200 });
        expect(edited.status).toBe(409);
        expect(edited.body.code).toBe("SPRINT_PROJECT_MISMATCH");
        const bulk = await request(app).post("/api/tasks/bulk").send({ ids: [id], action: "move_to_sprint", value: 200 });
        expect(bulk.status).toBe(200);
        expect(bulk.body).toMatchObject({ changed: 0, results: [{ id, ok: false, code: "SPRINT_PROJECT_MISMATCH" }] });
        const placed = await request(app).patch(`/api/tasks/${id}/assign-sprint`).send({ sprint_id: 200 });
        expect(placed.status).toBe(409);
        expect(placed.body.code).toBe("SPRINT_PROJECT_MISMATCH");
        const detail = await request(app).get("/api/tasks/backlog?project_id=10");
        expect(detail.body.tasks).toEqual([expect.objectContaining({ id, title: "Keep here", sprint_id: null, project_id: 10 })]);
    });

    test("project backlog, sprint board and plan isolate streams and legacy team scope maps to its generated project", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status) VALUES
            (100, 10, 'First', '2026-11-01', '2026-11-14', 'active'),
            (200, 20, 'Second', '2026-11-01', '2026-11-14', 'active')`);
        await pool.query(`INSERT INTO tasks (id, user_id, org_id, team_id, project_id, sprint_id, title) VALUES
            (1, 1, 1, 1, 10, NULL, 'One backlog'), (2, 1, 1, 1, 20, NULL, 'Two backlog'),
            (3, 1, 1, 1, 10, 100, 'One board'), (4, 1, 1, 1, 20, 200, 'Two board')`);
        const backlog = await request(app).get("/api/tasks/backlog?project_id=20");
        expect(backlog.status).toBe(200);
        expect(backlog.body.tasks.map((task: any) => task.id)).toEqual([2]);
        const board = await request(app).get("/api/sprints/200/board");
        expect(board.status).toBe(200);
        expect(board.body.tickets.map((task: any) => task.id)).toEqual([4]);
        const projectStates = await pool.query("SELECT id FROM workflow_states WHERE project_id = 20 AND is_active = TRUE AND key <> 'cancelled'");
        expect(projectStates.rows.length).toBeGreaterThan(0);
        expect(board.body.columns.map((column: any) => column.stateId).sort())
            .toEqual(projectStates.rows.map((state: any) => state.id).sort());
        const plan = await request(app).get("/api/sprints/200/tasks");
        expect(plan.status).toBe(200);
        expect(plan.body.tasks.map((task: any) => task.id)).toEqual([4]);
        const available = await request(app).get("/api/tasks/available-sprints?project_id=20");
        expect(available.status).toBe(200);
        expect(available.body.map((sprint: any) => sprint.id)).toEqual([200]);
        const legacy = await request(app).get("/api/sprints?team_id=1");
        expect(legacy.body.sprints.map((sprint: any) => sprint.id)).toEqual([100]);
        const active = await request(app).get("/api/sprints/active?project_id=20");
        expect(active.body.sprint.id).toBe(200);
        const hidden = await request(app).get("/api/sprints?project_id=30");
        expect(hidden.body.sprints).toEqual([]);
        const placed = await request(app).patch("/api/tasks/2/assign-sprint").send({ sprint_id: 200 });
        expect(placed.status).toBe(200);
        expect(placed.body).toMatchObject({ sprint_id: 200, project_id: 20, team_id: 1 });
        const crossProject = await request(app).patch("/api/tasks/2/assign-sprint").send({ sprint_id: 100 });
        expect(crossProject.status).toBe(409);
        expect(crossProject.body.code).toBe("SPRINT_PROJECT_MISMATCH");
    });

    test("the project list includes all team grants, excludes inaccessible projects, and lets admins see every project", async () => {
        const accessible = await request(app).get("/api/projects");
        expect(accessible.status).toBe(200);
        expect(accessible.body.map((project: any) => project.id)).toEqual([10, 20]);
        const paginated = await request(app).get("/api/projects?paginate=1&limit=1");
        expect(paginated.body.projects.map((project: any) => project.id)).toEqual([10]);
        expect(paginated.body.pagination.total).toBe(2);
        const admin = await request(app).get("/api/projects").set("x-role", "super_admin");
        expect(admin.body.map((project: any) => project.id).sort((a: number, b: number) => a - b)).toEqual([1, 10, 20, 30]);
        const legacy = await request(app).get("/api/projects").set("x-legacy", "1");
        expect(legacy.body).toHaveLength(4);
    });

    test("team deletion preserves project tickets and sprints, removes grants, and remains guarded before switch-over", async () => {
        await pool.query(`INSERT INTO sprints (id, team_id, project_id, name, start_date, end_date)
            VALUES (100, 1, 10, 'Keep sprint', '2026-11-01', '2026-11-14')`);
        await pool.query(`INSERT INTO tasks (id, user_id, org_id, team_id, project_id, sprint_id, title)
            VALUES (1, 1, 1, 1, 10, 100, 'Keep ticket')`);
        const refused = await request(app).delete("/api/organization/teams/1").set("x-legacy", "1").set("x-role", "super_admin");
        expect(refused.status).toBe(409);
        const deleted = await request(app).delete("/api/organization/teams/1").set("x-role", "super_admin");
        expect(deleted.status).toBe(200);
        const board = await request(app).get("/api/sprints/100/board").set("x-role", "super_admin");
        expect(board.status).toBe(200);
        expect(board.body.sprint).toMatchObject({ project_id: 10, team_id: null });
        expect(board.body.tickets.map((task: any) => task.id)).toEqual([1]);
        const members = await request(app).get("/api/projects/10/members").set("x-role", "super_admin");
        expect(members.status).toBe(200);
        expect(members.body).toEqual([]);
    });

    test("project sprints have independent lifecycle, plan stats and deletion without team ownership", async () => {
        const create = (project_id: number, name: string) => request(app).post("/api/sprints")
            .send({ project_id, name, start_date: "2026-11-01", end_date: "2026-11-14" });
        const first = (await create(10, "One")).body.sprint;
        const second = (await create(20, "Two")).body.sprint;
        const next = (await create(10, "Next")).body.sprint;
        await pool.query(`INSERT INTO tasks (id, user_id, org_id, team_id, project_id, sprint_id, title) VALUES
            (1, 1, 1, 1, 10, $1, 'Carry within project'), (2, 1, 1, 1, 20, $2, 'Return to project backlog')`,
        [first.id, second.id]);
        expect((await request(app).post(`/api/sprints/${first.id}/start`)).status).toBe(200);
        expect((await request(app).post(`/api/sprints/${second.id}/start`)).status).toBe(200);
        expect((await request(app).post(`/api/sprints/${next.id}/start`)).status).toBe(409);
        const stats = await request(app).get(`/api/sprints/${second.id}/stats`);
        expect(stats.status).toBe(200);
        expect(stats.body.sprint.project_id).toBe(20);
        expect((await request(app).post(`/api/sprints/${second.id}/pause`)).status).toBe(200);
        expect((await request(app).post(`/api/sprints/${second.id}/resume`)).status).toBe(200);
        expect((await request(app).put(`/api/sprints/${second.id}`).send({ goal: "Project goal" })).status).toBe(200);
        expect((await request(app).post(`/api/sprints/${first.id}/complete`).send({ rolloverTo: second.id })).status).toBe(400);
        expect((await request(app).post(`/api/sprints/${first.id}/complete`).send({ rolloverTo: next.id })).status).toBe(200);
        const carried = await request(app).get(`/api/sprints/${next.id}/tasks`);
        expect(carried.body.tasks.map((task: any) => task.id)).toEqual([1]);
        expect((await request(app).delete(`/api/sprints/${second.id}`)).status).toBe(200);
        const list = await request(app).get("/api/sprints?project_id=20");
        expect(list.body.sprints).toEqual([]);
    });

    test("completion preview and new-sprint completion share hierarchy-aware carryover within the project", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, team_id, name, start_date, end_date, status) VALUES
            (100, 10, 1, 'Current', '2026-11-01', '2026-11-14', 'active'),
            (101, 10, 1, 'Next', '2026-11-15', '2026-11-28', 'planned'),
            (200, 20, NULL, 'Other project', '2026-11-15', '2026-11-28', 'planned')`);
        const states = (await pool.query(
            "SELECT id, key, is_terminal FROM workflow_states WHERE org_id = 1",
        )).rows;
        const openStateId = Number(states.find((state: any) => !state.is_terminal && state.key !== "cancelled")!.id);
        const doneStateId = Number(states.find((state: any) => state.is_terminal && state.key !== "cancelled")!.id);
        const types = (await pool.query(
            "SELECT id, key FROM work_item_types WHERE org_id = 1",
        )).rows;
        const taskTypeId = Number(types.find((type: any) => type.key === "task")!.id);
        const subtaskTypeId = Number(types.find((type: any) => type.key === "subtask")!.id);
        const addTicket = async (input: {
            title: string;
            terminal: boolean;
            subtask?: boolean;
            parentId?: number;
            points: number;
        }) => Number((await pool.query(
            `INSERT INTO tasks
                (user_id, org_id, team_id, project_id, sprint_id, workflow_state_id, work_item_type_id, parent_task_id, title, story_points)
             VALUES (1, 1, 1, 10, 100, $1, $2, $3, $4, $5)
             RETURNING id`,
            [
                input.terminal ? doneStateId : openStateId,
                input.subtask ? subtaskTypeId : taskTypeId,
                input.parentId ?? null,
                input.title,
                input.points,
            ],
        )).rows[0].id);
        const terminalParent = await addTicket({ title: "Done parent with open work", terminal: true, points: 5 });
        const openSubtask = await addTicket({
            title: "Open subtask", terminal: false, subtask: true, parentId: terminalParent, points: 2,
        });
        const doneSubtask = await addTicket({
            title: "Done subtask", terminal: true, subtask: true, parentId: terminalParent, points: 1,
        });
        const openParent = await addTicket({ title: "Open parent", terminal: false, points: 3 });
        const doneSibling = await addTicket({
            title: "Done sibling", terminal: true, subtask: true, parentId: openParent, points: 2,
        });
        const finishedParent = await addTicket({ title: "Finished parent", terminal: true, points: 8 });
        const finishedSubtask = await addTicket({
            title: "Finished subtask", terminal: true, subtask: true, parentId: finishedParent, points: 1,
        });

        const dateBounds = (await pool.query(
            "SELECT (CURRENT_DATE + 1)::text AS start_date, (CURRENT_DATE + 14)::text AS end_date",
        )).rows[0];
        const preview = await request(app).get("/api/sprints/100/completion-preview?rolloverTo=new");
        expect(preview.status).toBe(200);
        expect(preview.body).toMatchObject({
            supportsNewSprint: true,
            defaultTarget: 101,
            defaultTargetType: "next",
            selectedTarget: "new",
            hasNext: true,
            nextPlannedSprint: { id: 101, name: "Next" },
            movingParents: [
                { id: terminalParent, title: "Done parent with open work" },
                { id: openParent, title: "Open parent" },
            ],
            movingSubtasks: 3,
            movingPoints: 13,
            staying: expect.arrayContaining([
                { id: finishedParent, title: "Finished parent", story_points: 8, completed: true },
                { id: finishedSubtask, title: "Finished subtask", story_points: 1, completed: true },
            ]),
            newSprint: {
                start_date: dateBounds.start_date,
                end_date: dateBounds.end_date,
            },
        });
        expect(preview.body.moving.map((ticket: any) => ticket.id)).toEqual([
            terminalParent, openSubtask, doneSubtask, openParent, doneSibling,
        ]);

        const completed = await request(app).post("/api/sprints/100/complete").send({ rolloverTo: "new" });
        expect(completed.status).toBe(200);
        const created = (await pool.query(
            "SELECT id, project_id, team_id, name, status, start_date::text, end_date::text FROM sprints WHERE project_id = 10 AND id NOT IN (100, 101)",
        )).rows[0];
        expect(created).toMatchObject({
            project_id: 10,
            team_id: null,
            status: "planned",
            start_date: dateBounds.start_date,
            end_date: dateBounds.end_date,
        });
        const moved = (await pool.query(
            "SELECT id, project_id, team_id, sprint_id FROM tasks WHERE id = ANY($1::int[]) ORDER BY id",
            [[terminalParent, openSubtask, doneSubtask, openParent, doneSibling]],
        )).rows;
        expect(moved.map((ticket: any) => ticket.id)).toEqual(
            [terminalParent, openSubtask, doneSubtask, openParent, doneSibling].sort((a, b) => a - b),
        );
        expect(moved.every((ticket: any) =>
            Number(ticket.project_id) === 10 && Number(ticket.team_id) === 1
            && Number(ticket.sprint_id) === Number(created.id))).toBe(true);
        const stayed = (await pool.query(
            "SELECT project_id, sprint_id FROM tasks WHERE id = ANY($1::int[]) ORDER BY id",
            [[finishedParent, finishedSubtask]],
        )).rows;
        expect(stayed).toEqual([
            { project_id: 10, sprint_id: 100 },
            { project_id: 10, sprint_id: 100 },
        ]);
    });

    test("omitting the completion target uses the previewed next planned sprint", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, team_id, name, start_date, end_date, status) VALUES
            (100, 10, 1, 'Current', '2026-11-01', '2026-11-14', 'active'),
            (101, 10, 1, 'Next', '2026-11-15', '2026-11-28', 'planned')`);
        const ticket = Number((await pool.query(
            `INSERT INTO tasks (user_id, org_id, team_id, project_id, sprint_id, title)
             VALUES (1, 1, 1, 10, 100, 'Omitted target')
             RETURNING id`,
        )).rows[0].id);

        const preview = await request(app).get("/api/sprints/100/completion-preview");
        expect(preview.body).toMatchObject({ defaultTarget: 101, defaultTargetType: "next", hasNext: true });
        const completed = await request(app).post("/api/sprints/100/complete").send({});

        expect(completed.status).toBe(200);
        expect((await pool.query("SELECT sprint_id FROM tasks WHERE id = $1", [ticket])).rows[0].sprint_id).toBe(101);
    });

    test("project members can plan without an organization lead role, but viewers and archived projects cannot write", async () => {
        const input = { project_id: 20, name: "Member planning", start_date: "2026-11-01", end_date: "2026-11-14" };
        const created = await request(app).post("/api/sprints").set("x-role", "employee").send(input);
        expect(created.status).toBe(200);
        await pool.query("UPDATE project_members SET role = 'viewer' WHERE project_id = 20");
        expect((await request(app).post("/api/sprints").send({ ...input, name: "Viewer" })).status).toBe(403);
        expect((await request(app).put(`/api/sprints/${created.body.sprint.id}`).send({ goal: "No" })).status).toBe(403);
        expect((await request(app).get(`/api/sprints/${created.body.sprint.id}/board`)).status).toBe(200);
        await pool.query("UPDATE project_members SET role = 'member' WHERE project_id = 20");
        await pool.query("UPDATE projects SET is_archived = TRUE WHERE id = 20");
        const archived = await request(app).post("/api/sprints").send({ ...input, name: "Archived" });
        expect(archived.status).toBe(409);
        expect(archived.body.code).toBe("PROJECT_ARCHIVED");
        expect((await request(app).post(`/api/sprints/${created.body.sprint.id}/start`)).status).toBe(403);
    });
});
