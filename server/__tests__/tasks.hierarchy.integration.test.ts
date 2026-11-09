/** Public HTTP writes and reads, backed by an isolated PostgreSQL database. */
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1); next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: async (req: any, _res: any, next: any) => {
        req.userOrgId = 1; req.userTeamId = req.userId === 2 ? 2 : 1; req.userTeamIds = [req.userTeamId];
        req.userRole = req.get("x-test-role") || "employee"; req.roleLevel = 1;
        req.projectOwnership = true; next();
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
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn(), broadcast: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/mailer", () => ({ notifyByEmail: jest.fn(), sendMail: jest.fn() }));

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
jest.setTimeout(30_000);
(databaseUrl ? describe : describe.skip)("ticket hierarchy (PostgreSQL HTTP)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    let projectId: number;
    let otherProjectId: number;
    const request = require("supertest");
    const create = (body: any) => request(app).post("/api/tasks/backlog").send({ title: "Work", project_id: projectId, ...body });

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "hierarchy_routes");
        pool = new Pool({ connectionString: database.url, max: 4 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        const result = await require("../platform/db/migrations").runTenantMigrations(query, { label: "hierarchy_routes" });
        expect(result.failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const express = require("express");
        app = express(); app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
            req.tenant = { id: 1, plan: "enterprise", features: { team_visibility: true, agile: true } };
            req.tenantId = 1;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/agile", require("../routes/agile"));
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        await pool.query("TRUNCATE audit_logs, task_history, tasks, sprints, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug, project_ownership) VALUES (1, 'Hierarchy', 'hierarchy', TRUE)");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Beta')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
            (1, 'alice', 'x', 'Alice', 1, 1), (2, 'viewer', 'x', 'Viewer', 1, 2)`);
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
        await pool.query(`INSERT INTO projects (id, org_id, key, name, type, origin_team_id) VALUES
            (10, 1, 'ONE', 'One', 'scrum', 1), (20, 1, 'TWO', 'Two', 'scrum', 2)`);
        await pool.query("INSERT INTO project_members (project_id, team_id, role) VALUES (10, 1, 'member'), (20, 1, 'member')");
        projectId = 10; otherProjectId = 20;
    }, 120_000);

    test("create refuses an epic with a parent and a story under another story, but allows cross-project epic children", async () => {
        const epic = await create({ work_item_type_id: "epic" });
        expect(epic.status).toBe(200);
        const story = await create({ work_item_type_id: "story", parent_task_id: epic.body.id, project_id: otherProjectId })
            .set("x-test-role", "super_admin");
        expect(story.status).toBe(200);
        for (const body of [
            { work_item_type_id: "epic", parent_task_id: epic.body.id },
            { work_item_type_id: "story", parent_task_id: story.body.id },
        ]) {
            const rejected = await create(body);
            expect(rejected).toMatchObject({ status: 409, body: { code: "INVALID_HIERARCHY" } });
            expect(rejected.body.error).toMatch(/epic/i);
        }
    });

    test("members add subtasks inheriting the parent's project and sprint through every create route", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
            VALUES (10, $1, 'Current', '2026-11-01', '2026-11-14', 'planned')`, [projectId]);
        const parent = await create({ sprint_id: 10, work_item_type_id: "task" });
        expect(parent.status).toBe(200);
        for (const route of [`/api/tasks/${parent.body.id}/subtasks`, "/api/tasks", "/api/tasks/backlog"]) {
            const result = await request(app).post(route).send({
                title: "Small piece", work_item_type_id: "subtask", parent_task_id: parent.body.id,
                project_id: otherProjectId, sprint_id: null, start_date: "2026-11-09",
            });
            expect(result).toMatchObject({ status: 200, body: {
                project_id: projectId, sprint_id: 10, parent_task_id: parent.body.id, start_date: "2026-11-09",
            } });
            const detail = await request(app).get(`/api/tasks/${result.body.id}/detail`);
            expect(detail.body.capabilities.can.placeInSprint).toEqual({ allowed: false, reason: "SUBTASK_FOLLOWS_PARENT" });
            const history = await request(app).get(`/api/tasks/${result.body.id}/history`);
            expect(history.body).toEqual(expect.arrayContaining([
                expect.objectContaining({ action: "created" }),
                expect.objectContaining({ field: "parent", new_value: String(parent.body.id) }),
            ]));
        }
        const types = await request(app).get("/api/agile/work-item-types");
        expect(types.body.filter((type: any) => type.is_subtask)).toHaveLength(1);
        const subtaskType = types.body.find((type: any) => type.is_subtask);
        expect(subtaskType).toMatchObject({ key: "subtask", name: "Subtask" });
        const summary = await request(app).get(`/api/tasks/${parent.body.id}/children`);
        expect(summary.body.children).toHaveLength(3);
    });

    test("parent and type edits enforce both sides, reject cycles, and commit history only for legal changes", async () => {
        const epic = (await create({ work_item_type_id: "epic" })).body;
        const story = (await create({ work_item_type_id: "story", parent_task_id: epic.id })).body;
        const subtask = (await request(app).post(`/api/tasks/${story.id}/subtasks`).send({ title: "Piece" })).body;
        const before = (await request(app).get(`/api/tasks/${story.id}/history`)).body;
        for (const [method, path, body] of [
            ["patch", `/api/tasks/${epic.id}/parent`, { parent_task_id: story.id }],
            ["patch", `/api/tasks/${story.id}/parent`, { parent_task_id: subtask.id }],
            ["put", `/api/tasks/${story.id}`, { work_item_type_id: "epic" }],
            ["put", `/api/tasks/${epic.id}`, { work_item_type_id: "task" }],
            ["put", `/api/tasks/${subtask.id}`, { parent_task_id: null }],
            ["put", `/api/tasks/${subtask.id}`, { parent_task_id: epic.id }],
            ["put", `/api/tasks/${story.id}`, { work_item_type_id: "subtask", parent_task_id: subtask.id }],
            ["put", `/api/tasks/${story.id}`, { parent_task_id: "1garbage" }],
        ] as const) {
            const result = await request(app)[method](path).send(body);
            expect({ path, body, status: result.status, code: result.body.code })
                .toMatchObject({ status: 409, code: "INVALID_HIERARCHY" });
        }
        expect((await request(app).get(`/api/tasks/${story.id}/history`)).body).toEqual(before);
        const cleared = await request(app).patch(`/api/tasks/${story.id}/parent`).send({ parent_task_id: null });
        expect(cleared.status).toBe(200);
        expect((await request(app).get(`/api/tasks/${story.id}/history`)).body).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "parent", old_value: String(epic.id), new_value: null }),
        ]));
    });

    test("subtasks cannot move sprint or project independently, including bulk, full edit, preview and admin writes", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
            VALUES (10, $1, 'Current', '2026-11-01', '2026-11-14', 'planned')`, [projectId]);
        const parent = (await create({ work_item_type_id: "bug", sprint_id: 10 })).body;
        const subtask = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        const history = (await request(app).get(`/api/tasks/${subtask.id}/history`)).body;
        for (const [method, suffix, body] of [
            ["patch", "/assign-sprint", { sprint_id: null }],
            ["patch", "/assign-sprint", { sprint_id: 10 }],
            ["put", "", { sprint_id: null, title: "Must not edit" }],
            ["put", "", { project_id: otherProjectId }],
            ["post", "/move-project/preview", { project_id: otherProjectId }],
            ["post", "/move-project", { project_id: otherProjectId }],
        ] as const) {
            const result = await request(app)[method](`/api/tasks/${subtask.id}${suffix}`).set("x-test-role", "super_admin").send(body);
            expect({ suffix, body, status: result.status, response: result.body })
                .toMatchObject({ status: 409, response: { code: "SUBTASK_FOLLOWS_PARENT" } });
        }
        const bulk = await request(app).post("/api/tasks/bulk").send({ ids: [subtask.id], action: "move_to_sprint", value: null });
        expect(bulk.body).toMatchObject({ changed: 0, results: [{ ok: false, code: "SUBTASK_FOLLOWS_PARENT" }] });
        const detail = await request(app).get(`/api/tasks/${subtask.id}/detail`);
        expect(detail.body).toMatchObject({ title: "Piece", project_id: projectId, sprint_id: 10 });
        expect((await request(app).get(`/api/tasks/${subtask.id}/history`)).body).toEqual(history);
        const ordinary = (await create({ sprint_id: 10 })).body;
        const conversionMove = await request(app).put(`/api/tasks/${ordinary.id}`).send({
            work_item_type_id: "subtask", parent_task_id: parent.id, sprint_id: null,
        });
        expect(conversionMove).toMatchObject({ status: 409, body: { code: "SUBTASK_FOLLOWS_PARENT" } });
        // Ticket 07 supplies cascading moves; ticket 06 must not leave a cross-project child meanwhile.
        const moveParent = await request(app).post(`/api/tasks/${parent.id}/move-project`).send({ project_id: otherProjectId });
        expect(moveParent).toMatchObject({ status: 409, body: { code: "INVALID_HIERARCHY" } });
    });

    test("the seeded Subtask type cannot be deleted, deactivated, made default or turned into an epic", async () => {
        const types = (await request(app).get("/api/agile/work-item-types")).body;
        const subtask = types.find((type: any) => type.is_subtask);
        expect(subtask).toBeDefined();
        const removed = await request(app).delete(`/api/agile/work-item-types/${subtask.id}`).set("x-test-role", "super_admin");
        expect(removed).toMatchObject({ status: 409, body: { code: "INVALID_HIERARCHY" } });
        for (const body of [{ is_active: false }, { is_epic: true }, { is_default: true }, { is_subtask: false }]) {
            const result = await request(app).put(`/api/agile/work-item-types/${subtask.id}`).set("x-test-role", "super_admin").send(body);
            expect(result).toMatchObject({ status: 409, body: { code: "INVALID_HIERARCHY" } });
        }
        const after = (await request(app).get("/api/agile/work-item-types")).body.find((type: any) => type.id === subtask.id);
        expect(after).toEqual(subtask);
        const story = types.find((type: any) => type.key === "story");
        await create({ work_item_type_id: story.id });
        const levelChange = await request(app).put(`/api/agile/work-item-types/${story.id}`)
            .set("x-test-role", "super_admin").send({ is_epic: true });
        expect(levelChange).toMatchObject({ status: 409, body: { code: "INVALID_HIERARCHY" } });
    });

    test("detail summaries expose navigable parent/subtasks and server-decided add action without leaking private project links", async () => {
        const epic = (await create({ work_item_type_id: "epic" })).body;
        const story = (await create({ parent_task_id: epic.id })).body;
        const subtask = (await request(app).post(`/api/tasks/${story.id}/subtasks`).send({ title: "Piece" })).body;
        const parentDetail = await request(app).get(`/api/tasks/${story.id}/detail`);
        expect(parentDetail.body).toMatchObject({
            parent: { id: epic.id }, subtasks: [{ id: subtask.id, title: "Piece", ticket_key: subtask.ticket_key }],
            capabilities: { can: { canAddSubtask: { allowed: true } } },
        });
        const childDetail = await request(app).get(`/api/tasks/${subtask.id}/detail`);
        expect(childDetail.body.parent).toMatchObject({ id: story.id, ticket_key: story.ticket_key });
        expect(childDetail.body.subtasks).toEqual([]);
        expect(childDetail.body.capabilities.can.canAddSubtask.allowed).toBe(false);
        await pool.query("DELETE FROM project_members WHERE project_id = $1", [otherProjectId]);
        const privateEpic = (await create({ work_item_type_id: "epic", project_id: otherProjectId }).set("x-test-role", "super_admin")).body;
        await pool.query("UPDATE tasks SET parent_task_id = $1 WHERE id = $2", [privateEpic.id, story.id]);
        await pool.query("INSERT INTO project_members (project_id, user_id, role) VALUES ($1, 2, 'viewer')", [projectId]);
        const viewer = await request(app).get(`/api/tasks/${story.id}/detail`).set("x-test-user", "2");
        expect(viewer.status).toBe(200);
        expect(viewer.body.parent).toBeNull();
        expect(viewer.body.capabilities.can.canAddSubtask).toEqual({ allowed: false, reason: "READ_ONLY_ROLE" });
        const refused = await request(app).post(`/api/tasks/${story.id}/subtasks`).set("x-test-user", "2").send({ title: "Not allowed" });
        expect(refused).toMatchObject({ status: 403, body: { code: "READ_ONLY_ROLE" } });
        expect((await request(app).get(`/api/tasks/${story.id}/parent`).set("x-test-user", "2")).body).toEqual({ parent: null });
    });
});
