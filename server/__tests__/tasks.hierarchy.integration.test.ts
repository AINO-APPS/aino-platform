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
        req.projectOwnership = req.get("x-test-legacy") !== "1"; next();
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
    let transactionProbe: ((req: any, client: any, sql: string, values?: unknown[]) => Promise<any>) | undefined;
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
            const transaction = makePoolTransaction(pool);
            req.db = { query: makePoolQuery(pool), transaction: (run: any) => transaction((client: any, context: any) =>
                run(transactionProbe ? { query: (sql: string, values?: unknown[]) =>
                    transactionProbe!(req, client, sql, values) } : client, context)) };
            req.tenant = { id: 1, plan: "enterprise", features: { team_visibility: true, agile: true } };
            req.tenantId = 1;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/agile", require("../routes/agile"));
        app.use("/api/sprints", require("../routes/sprints"));
        app.use("/api/sprints", require("../routes/sprintBaseline"));
        app.use("/api/sprints", require("../routes/sprintCompletion"));
        app.use("/api/projects", require("../routes/projects"));
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        transactionProbe = undefined;
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

    test.each(["status", "key rename"])("a project move and %s lock cannot deadlock on the same ticket", async operation => {
        const parent = (await create({ work_item_type_id: "task" })).body;
        const moving = await pool.connect();
        const changing = await pool.connect();
        let releaseMove!: () => void;
        let ticketLocked!: () => void;
        const paused = new Promise<void>(resolve => { ticketLocked = resolve; });
        const resume = new Promise<void>(resolve => { releaseMove = resolve; });
        const { moveTicketProject } = require("../modules/tasks/tasks.placement");
        const { lockBoardWrite } = require("../modules/tasks/tasks.boardRepository");
        try {
            await moving.query("BEGIN");
            await changing.query("BEGIN");
            await moving.query("SET LOCAL deadlock_timeout = '100ms'");
            const pid = Number((await changing.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
            const move = moveTicketProject({
                db: { query: async (sql: string, params: unknown[]) => {
                    const result = await moving.query(sql, params);
                    if (sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
                        ticketLocked();
                        await resume;
                    }
                    return result;
                } },
                actor: { userId: 1, orgId: 1 },
                ticketActor: { userId: 1, orgId: 1, role: "super_admin", projectOwnership: true },
                afterCommit: () => undefined, effects: { changed: async () => undefined },
            }, parent.id, otherProjectId).then(async (result: any) => {
                await moving.query("COMMIT");
                return result;
            }, async (error: Error) => { await moving.query("ROLLBACK"); throw error; });
            await Promise.race([paused, move.then(() => { throw new Error("Move completed before taking its ticket lock"); })]);
            const write = operation === "status" ? lockBoardWrite(changing, projectId, parent.id, 1)
                : require("../modules/tasks/tasks.projectKey").changeProjectKey({
                    query: changing.query.bind(changing),
                    transaction: async (run: (client: any) => Promise<unknown>) => run(changing),
                }, { userId: 1, orgId: 1, orgRole: "super_admin", teamIds: [] }, projectId, "SAFE", false);
            const status = write
                .then(async (result: any) => { await changing.query("COMMIT"); return result; },
                    async (error: Error) => { await changing.query("ROLLBACK"); throw error; });
            // Wait for a real database lock, not a timing-dependent sleep.
            const deadline = Date.now() + 5000;
            while (!(await pool.query("SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [pid])).rows[0].blocked) {
                if (Date.now() > deadline) throw new Error("Status writer did not reach its lock");
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            releaseMove();
            const results = await Promise.allSettled([move, status]);
            expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
            expect(results[0]).toMatchObject({ value: { ok: true, task: { project_id: otherProjectId } } });
        } finally {
            releaseMove();
            await moving.query("ROLLBACK"); await changing.query("ROLLBACK");
            moving.release(); changing.release();
        }
    });

    test.each(["status", "key rename"])("concurrent move-project and %s HTTP requests never return a deadlock 500", async operation => {
        const parent = (await create({ work_item_type_id: "task" })).body;
        const state = (await pool.query("SELECT id FROM workflow_states WHERE project_id = 10 AND key = 'in_progress'")).rows[0].id;
        let release!: () => void;
        let locked!: () => void;
        let writerStarted!: () => void;
        const paused = new Promise<void>(resolve => { locked = resolve; });
        const resume = new Promise<void>(resolve => { release = resolve; });
        const started = new Promise<void>(resolve => { writerStarted = resolve; });
        let writerPid = 0;
        transactionProbe = async (req, client, sql, values) => {
            if (req.get("x-test-call") === "writer" && !writerPid) {
                writerPid = Number((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
                writerStarted();
            }
            const result = await client.query(sql, values);
            if (req.get("x-test-call") === "move" && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
                locked();
                await resume;
            }
            return result;
        };
        const move = request(app).post(`/api/tasks/${parent.id}/move-project`)
            .set("x-test-call", "move").send({ project_id: otherProjectId }).then((response: any) => response);
        try {
            await Promise.race([paused, move.then((response: any) => {
                throw new Error(`Move completed before its lock: HTTP ${response.status}`);
            })]);
            const write = (operation === "status"
                ? request(app).patch(`/api/tasks/${parent.id}/status`).send({ workflow_state_id: state })
                : request(app).post("/api/projects/10/key").send({ key: "SAFE" }))
                .set("x-test-call", "writer").set("x-test-role", "super_admin").then((response: any) => response);
            await Promise.race([started, write.then((response: any) => {
                throw new Error(`Writer completed before its transaction: HTTP ${response.status}`);
            })]);
            const deadline = Date.now() + 5000;
            while (!(await pool.query("SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked", [writerPid])).rows[0].blocked) {
                if (Date.now() > deadline) throw new Error("HTTP writer did not reach its lock");
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            release();
            const [moved, written] = await Promise.all([move, write]);
            expect(moved).toMatchObject({ status: 200 });
            expect([200, 409]).toContain(written.status);
            const detail = await request(app).get(`/api/tasks/${parent.id}/detail`);
            expect(detail).toMatchObject({ status: 200, body: { project_id: otherProjectId } });
        } finally {
            release();
            await move;
            transactionProbe = undefined;
        }
    });

    test("deactivating an Epic type preserves its stored hierarchy on unrelated edits and parent changes", async () => {
        const epic = (await create({ work_item_type_id: "epic" })).body;
        const leafEpic = (await create({ work_item_type_id: "epic" })).body;
        await create({ work_item_type_id: "story", parent_task_id: epic.id });
        const types = (await request(app).get("/api/agile/work-item-types")).body;
        const epicType = types.find((type: any) => type.key === "epic");
        await request(app).put(`/api/agile/work-item-types/${epicType.id}`)
            .set("x-test-role", "super_admin").send({ is_active: false }).expect(200);
        const edit = await request(app).put(`/api/tasks/${epic.id}`).send({ title: "Still an epic" });
        const fullEdit = await request(app).put(`/api/tasks/${epic.id}`).send({
            title: "Still an inactive epic", work_item_type_id: epicType.id,
        });
        const sameKeyEdit = await request(app).put(`/api/tasks/${leafEpic.id}`).send({ work_item_type_id: "epic" });
        const invalidParent = await request(app).patch(`/api/tasks/${leafEpic.id}/parent`).send({ parent_task_id: epic.id });
        expect([edit.status, fullEdit.status, sameKeyEdit.status, invalidParent.status]).toEqual([200, 200, 200, 409]);
        expect(invalidParent).toMatchObject({ status: 409, body: { code: "INVALID_HIERARCHY" } });
        expect(invalidParent.body.error).toMatch(/epic cannot have a parent/i);
        await create({ work_item_type_id: epicType.id }).expect(400);
        const ordinary = (await create({ work_item_type_id: "task" })).body;
        await request(app).put(`/api/tasks/${ordinary.id}`).send({ work_item_type_id: epicType.id }).expect(400);
        const detail = await request(app).get(`/api/tasks/${leafEpic.id}/detail`);
        expect(detail.body.parent_task_id).toBeNull();
    });

    test.each(["project", "compatibility"])("%s Cancelled parents deny Add subtask and all create routes without changing history or children", async mode => {
        const parent = (await create({ work_item_type_id: "task" })).body;
        const headers = mode === "compatibility" ? { "x-test-legacy": "1" } : {};
        await request(app).delete(`/api/tasks/${parent.id}`).expect(200);
        const detail = await request(app).get(`/api/tasks/${parent.id}/detail`).set(headers).expect(200);
        const before = (await request(app).get(`/api/tasks/${parent.id}/history`)).body;
        const writes = [];
        for (const route of [`/api/tasks/${parent.id}/subtasks`, "/api/tasks", "/api/tasks/backlog"]) {
            writes.push(await request(app).post(route).set(headers).send({
                title: "Not allowed", work_item_type_id: "subtask", parent_task_id: parent.id,
            }));
        }
        expect({
            capability: detail.body.capabilities.can.canAddSubtask,
            responses: writes.map(response => ({ status: response.status, code: response.body.code })),
        }).toEqual({
            capability: { allowed: false, reason: "CANCELLED_TERMINAL" },
            responses: Array(3).fill({ status: 409, code: "CANCELLED_TERMINAL" }),
        });
        expect((await request(app).get(`/api/tasks/${parent.id}/children`)).body.children).toEqual([]);
        expect((await request(app).get(`/api/tasks/${parent.id}/history`)).body).toEqual(before);
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
        const moveParent = await request(app).post(`/api/tasks/${parent.id}/move-project`).send({ project_id: otherProjectId });
        expect(moveParent.status).toBe(200);
        const movedChild = await request(app).get(`/api/tasks/${subtask.id}/detail`);
        expect(movedChild.body).toMatchObject({ project_id: otherProjectId, sprint_id: null, parent_task_id: parent.id });
        expect(movedChild.body.ticket_key).toMatch(/^TWO-/);
        expect(movedChild.body.key_aliases).toContain(subtask.ticket_key);
    });

    test("parent placement cascades to every subtask with individual history and preserves dates", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
            VALUES (10, 10, 'First', '2026-11-01', '2026-11-14', 'planned'),
                   (11, 10, 'Next', '2026-11-15', '2026-11-28', 'planned')`);
        const parent = (await create({ work_item_type_id: "story", due_date: "2026-12-01" })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({
            title: "Piece", start_date: "2026-11-09", due_date: "2026-12-02",
        })).body;
        for (const sprintId of [10, 11, null]) {
            const moved = await request(app).patch(`/api/tasks/${parent.id}/assign-sprint`).send({ sprint_id: sprintId });
            expect(moved.status).toBe(200);
            for (const item of [parent, child]) {
                const detail = await request(app).get(`/api/tasks/${item.id}/detail`);
                expect(detail.body.sprint_id).toBe(sprintId);
                expect(detail.body.due_date).toBe(item.due_date);
                const history = await request(app).get(`/api/tasks/${item.id}/history`);
                expect(history.body).toEqual(expect.arrayContaining([
                    expect.objectContaining({ field: "sprint", new_value: sprintId == null ? "none" : sprintId === 10 ? "First" : "Next" }),
                ]));
            }
        }
    });

    test("sprint completion places whole parents through current hierarchy with one history entry per member", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
            VALUES (10, 10, 'First', CURRENT_DATE, CURRENT_DATE + 14, 'active'),
                   (11, 10, 'Next', CURRENT_DATE + 15, CURRENT_DATE + 28, 'planned')`);
        const parent = (await create({ work_item_type_id: "story", sprint_id: 10 })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        const completed = await request(app).post("/api/sprints/10/complete").set("x-test-role", "super_admin");
        expect(completed.status).toBe(200);
        expect(completed.body.rolledOver).toBe(2);
        for (const item of [parent, child]) {
            const detail = await request(app).get(`/api/tasks/${item.id}/detail`);
            expect(detail.body.sprint_id).toBe(11);
            const history = await request(app).get(`/api/tasks/${item.id}/history`);
            expect(history.body.filter((entry: any) => entry.field === "sprint" && entry.new_value === "Next")).toHaveLength(1);
        }
    });

    test("backlog pagination counts parents and includes their subtasks, while boards expose the parent key", async () => {
        const parent = (await create({ work_item_type_id: "story", title: "Parent" })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        const backlog = await request(app).get(`/api/tasks/backlog?project_id=10&limit=1`);
        expect(backlog.body).toMatchObject({
            pagination: { total: 1, hasMore: false },
            tasks: [{ id: parent.id, subtasks: [{ id: child.id, is_subtask: true, parent_key: parent.ticket_key }] }],
        });
        const rank = await request(app).patch(`/api/tasks/${child.id}/rank`).send({ beforeId: null, afterId: null });
        expect(rank).toMatchObject({ status: 409, body: { code: "SUBTASK_FOLLOWS_PARENT" } });
        const points = await request(app).put(`/api/tasks/${child.id}`).send({ story_points: 5 });
        expect(points).toMatchObject({ status: 409, body: { code: "INVALID_HIERARCHY" } });
    });

    test.each(["scrum", "kanban", "task_list"])("%s boards expose subtask parent keys and planning backlogs nest families", async type => {
        await pool.query("UPDATE projects SET type = $1, kanban_backlog_enabled = $2 WHERE id = 10", [type, type === "kanban"]);
        const parent = (await create({ work_item_type_id: "story", title: "Parent" })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        if (type !== "task_list") {
            const backlog = await request(app).get("/api/projects/10/backlog");
            expect(backlog.status).toBe(200);
            expect(backlog.body.tickets).toEqual([
                expect.objectContaining({ id: parent.id, subtasks: [expect.objectContaining({ id: child.id })] }),
            ]);
        }
        if (type === "scrum") {
            await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
                VALUES (10, 10, 'Plan', CURRENT_DATE, CURRENT_DATE + 14, 'planned')`);
            expect((await request(app).patch(`/api/tasks/${parent.id}/assign-sprint`).send({ sprint_id: 10 })).status).toBe(200);
        } else if (type === "kanban") {
            await pool.query("UPDATE projects SET kanban_backlog_enabled = FALSE WHERE id = 10");
        }
        const board = await request(app).get(`/api/projects/10/board${type === "scrum" ? "?sprint_id=10" : ""}`);
        expect(board.status).toBe(200);
        expect(board.body.tickets).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: child.id, is_subtask: true, parent_key: parent.ticket_key }),
        ]));
    });

    test.each(["scrum", "kanban", "task_list"])("%s parent detail rolls up live subtask effort, not deleted worklogs", async type => {
        await pool.query("UPDATE projects SET type = $1 WHERE id = 10", [type]);
        const parent = (await create({ work_item_type_id: "story" })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        for (const [id, remaining] of [[parent.id, "30m"], [child.id, "1h 30m"]]) {
            const estimate = await request(app).patch(`/api/tasks/${id}/estimates`).send({ remaining_estimate: remaining });
            expect(estimate.status).toBe(200);
        }
        for (const [id, spent] of [[parent.id, "20m"], [child.id, "40m"]]) {
            const work = await request(app).post(`/api/tasks/${id}/worklogs`).send({
                day_worked: "2026-11-09", time_spent: spent, remaining_mode: "leave",
            });
            expect(work.status).toBe(201);
        }
        const removed = await request(app).post(`/api/tasks/${child.id}/worklogs`).send({
            day_worked: "2026-11-09", time_spent: "10m", remaining_mode: "leave",
        });
        expect(removed.status).toBe(201);
        expect((await request(app).delete(`/api/tasks/${child.id}/worklogs/${removed.body.worklog.id}`)
            .send({ remaining_mode: "leave" })).status).toBe(200);
        const detail = await request(app).get(`/api/tasks/${parent.id}/detail`);
        expect(detail.body).toMatchObject({
            time_spent_minutes: 20, remaining_estimate_minutes: 30,
            effort: { own_time_spent_minutes: 20, total_time_spent_minutes: 60,
                own_remaining_estimate_minutes: 30, total_remaining_estimate_minutes: 120 },
            subtask_summary: { total: 1, done: 0 },
        });
        const childDetail = await request(app).get(`/api/tasks/${child.id}/detail`);
        expect(childDetail.body).toMatchObject({ parent: { ticket_key: parent.ticket_key }, subtask_summary: { total: 0, done: 0 } });
    });

    test("sprint baseline, capacity report and burndown exclude legacy subtask points", async () => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
            VALUES (10, 10, 'First', CURRENT_DATE, CURRENT_DATE + 14, 'planned')`);
        const parent = (await create({ work_item_type_id: "story", sprint_id: 10, story_points: 8 })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        await pool.query("UPDATE tasks SET story_points = 99 WHERE id = $1", [child.id]);
        const started = await request(app).post("/api/sprints/10/start").set("x-test-role", "super_admin");
        expect(started.status).toBe(200);
        const baseline = await request(app).get("/api/sprints/10/baseline");
        expect(baseline.body.baseline.committed_task_ids).toEqual([parent.id]);
        expect(Number(baseline.body.baseline.committed_points)).toBe(8);
        const stats = await request(app).get("/api/sprints/10/stats");
        expect(stats.body.totals).toMatchObject({ tasks: 1, points: 8, remainingPoints: 8 });
        const burndown = await request(app).get("/api/sprints/10/burndown");
        expect(burndown.body.snapshots).toHaveLength(1);
        expect(Number(burndown.body.snapshots[0].total_points)).toBe(8);
        expect(Number(burndown.body.snapshots[0].remaining_points)).toBe(8);
        expect(burndown.body.snapshots[0].open_tasks).toBe(1);
        const preview = await request(app).get("/api/sprints/10/completion-preview");
        expect(preview.status).toBe(200);
        expect(preview.body.movingPoints).toBe(8);
        expect(preview.body.moving).toHaveLength(2);
        await pool.query(`UPDATE tasks SET workflow_state_id =
            (SELECT id FROM workflow_states WHERE project_id = 10 AND key = 'done' LIMIT 1) WHERE id = ANY($1::int[])`, [[parent.id, child.id]]);
        const complete = await request(app).post("/api/sprints/10/complete").set("x-test-role", "super_admin");
        expect(complete.status).toBe(200);
        expect(complete.body.velocity).toBe(8);
    });

    test.each(["placement", "project"])("a child history failure rolls back the entire %s move", async move => {
        await pool.query(`INSERT INTO sprints (id, project_id, name, start_date, end_date, status)
            VALUES (10, 10, 'First', CURRENT_DATE, CURRENT_DATE + 14, 'planned')`);
        const parent = (await create({ work_item_type_id: "story" })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        await pool.query(`CREATE FUNCTION refuse_family_history() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.task_id = ${Number(child.id)} THEN RAISE EXCEPTION 'test history failure'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER refuse_family_history BEFORE INSERT ON task_history FOR EACH ROW EXECUTE FUNCTION refuse_family_history()`);
        try {
            const response = move === "placement"
                ? await request(app).patch(`/api/tasks/${parent.id}/assign-sprint`).send({ sprint_id: 10 })
                : await request(app).post(`/api/tasks/${parent.id}/move-project`).send({ project_id: 20 });
            expect(response.status).toBe(500);
            for (const item of [parent, child]) {
                const detail = await request(app).get(`/api/tasks/${item.id}/detail`);
                expect(detail.body).toMatchObject({ project_id: 10, sprint_id: null, ticket_key: item.ticket_key, key_aliases: [] });
            }
        } finally {
            await pool.query("DROP TRIGGER refuse_family_history ON task_history; DROP FUNCTION refuse_family_history()");
        }
    });

    test.each(["scrum", "kanban", "task_list"])("moving a family to %s maps each state and preserves every key alias", async (type) => {
        await pool.query("UPDATE projects SET type = $1 WHERE id = 20", [type]);
        const parent = (await create({ work_item_type_id: "story" })).body;
        const child = (await request(app).post(`/api/tasks/${parent.id}/subtasks`).send({ title: "Piece" })).body;
        await pool.query(`UPDATE tasks SET workflow_state_id =
            (SELECT id FROM workflow_states WHERE project_id = 10 AND key = 'done' LIMIT 1) WHERE id = $1`, [child.id]);
        const moved = await request(app).post(`/api/tasks/${parent.id}/move-project`).send({ project_id: otherProjectId });
        expect(moved.status).toBe(200);
        for (const item of [parent, child]) {
            const detail = await request(app).get(`/api/tasks/${item.id}/detail`);
            expect(detail.body).toMatchObject({ project_id: 20, sprint_id: null });
            expect(detail.body.key_aliases).toContain(item.ticket_key);
            expect(detail.body.ticket_key).toMatch(/^TWO-/);
            expect(detail.body.workflow_state_key).toBe(item.id === child.id ? "done" : parent.workflow_state_key);
            const resolved = await request(app).get(`/api/tasks/by-key/${item.ticket_key}`);
            expect(resolved.body.id).toBe(item.id);
        }
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
