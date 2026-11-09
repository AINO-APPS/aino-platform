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
(databaseUrl ? describe : describe.skip)("project type controls and lifecycle (PostgreSQL)", () => {
    const request = require("supertest");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "project_types");
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
            req.tenant = { id: 1, plan: "enterprise", features: { agile: req.get("x-agile") !== "off", team_visibility: true } };
            req.tenantId = 1;
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/sprints", require("../routes/sprints"));
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/projects", require("../routes/projects"));
        app.use("/api/agile", require("../routes/agile"));
        app.use("/api/sprints", require("../routes/sprintBaseline"));
        app.use("/api/sprints", require("../routes/sprintCompletion"));
        app.use("/api/organization", require("../routes/organization"));
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        await pool.query("TRUNCATE tasks, sprints, projects, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug, project_ownership) VALUES (1, 'Planning', 'planning', TRUE)");
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params as any[]));
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Team'), (2, 1, 'Other')");
        await pool.query("INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES (1, 'planner', 'x', 'Planner', 1, 1)");
        await pool.query(`INSERT INTO projects (id, org_id, key, name, type, origin_team_id) VALUES
            (10, 1, 'ONE', 'One', 'scrum', 1), (20, 1, 'TWO', 'Two', 'scrum', NULL), (30, 1, 'HIDE', 'Hidden', 'scrum', 2)`);
        await pool.query("INSERT INTO project_members (project_id, team_id, role) VALUES (10, 1, 'member'), (20, 1, 'member')");
    });

    test.each([['scrum', ['backlog', 'sprint', 'reports']], ['kanban', ['board']], ['task_list', ['list', 'board', 'calendar']]])('creates %s with server-decided planning', async (type, tabs) => {
        const result = await request(app).post('/api/projects').send({ key: 'NEW', name: 'New project', type });
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ type, planTabs: tabs, availableTypes: ['scrum', 'kanban', 'task_list'], capabilities: { canChangeType: true } });
        const read = await request(app).get(`/api/projects/${result.body.id}`);
        expect(read.body.type).toBe(type);
        expect(read.body.planTabs).toEqual(tabs);
    });
    test('without agile only Task list creation is available, including the default', async () => {
        for (const type of ['scrum', 'kanban']) {
            const result = await request(app).post('/api/projects').set('x-agile', 'off').send({ key: 'NEW', name: 'New', type });
            expect(result.status).toBe(403);
            expect(result.body.code).toBe('PROJECT_TYPE_NOT_AVAILABLE');
        }
        const created = await request(app).post('/api/projects').set('x-agile', 'off').send({ key: 'NEW', name: 'New' });
        expect(created.body).toMatchObject({ type: 'task_list', availableTypes: ['task_list'] });
        const existing = await request(app).get('/api/projects/10').set('x-agile', 'off');
        expect(existing.body).toMatchObject({ type: 'scrum', hasSprints: true, planTabs: ['backlog', 'sprint', 'reports'] });
    });
    test('project admins change type; members and viewers cannot', async () => {
        for (const role of ['member', 'viewer']) {
            await pool.query('UPDATE project_members SET role = $1 WHERE project_id = 10', [role]);
            const refused = await request(app).put('/api/projects/10').send({ type: 'kanban' });
            expect(refused.status).toBe(403);
            expect((await request(app).get('/api/projects/10')).body.capabilities.canChangeType).toBe(false);
        }
        await pool.query("UPDATE project_members SET role = 'project_admin' WHERE project_id = 10");
        const changed = await request(app).put('/api/projects/10').send({ type: 'kanban', name: 'Flow' });
        expect(changed.status).toBe(200);
        expect(changed.body).toMatchObject({ type: 'kanban', name: 'Flow', planTabs: ['board'] });
        expect((await request(app).get('/api/projects/10')).body.type).toBe('kanban');
    });
    test.each(['planned', 'active', 'paused'])('leaving Scrum refuses %s sprints without partial settings changes', async (status) => {
        await pool.query("UPDATE project_members SET role = 'project_admin' WHERE project_id = 10");
        await pool.query("INSERT INTO sprints (project_id, name, start_date, end_date, status) VALUES (10, 'Open', '2026-11-01', '2026-11-14', $1)", [status]);
        const changed = await request(app).put('/api/projects/10').send({ type: 'task_list', name: 'Must not save' });
        expect(changed.status).toBe(409);
        expect(changed.body.code).toBe('PROJECT_HAS_OPEN_SPRINTS');
        const read = await request(app).get('/api/projects/10');
        expect(read.body).toMatchObject({ type: 'scrum', name: 'One', changeableTypes: ['scrum'] });
    });
    test('completed history allows changes, flag loss allows unchanged Scrum settings and Task list conversion', async () => {
        await pool.query("UPDATE project_members SET role = 'project_admin' WHERE project_id = 10");
        await pool.query("INSERT INTO sprints (project_id, name, start_date, end_date, status) VALUES (10, 'Past', '2026-11-01', '2026-11-14', 'completed')");
        const same = await request(app).put('/api/projects/10').set('x-agile', 'off').send({ type: 'scrum', name: 'Renamed' });
        expect(same.status).toBe(200);
        const unavailable = await request(app).put('/api/projects/10').set('x-agile', 'off').send({ type: 'kanban' });
        expect(unavailable.status).toBe(403);
        const changed = await request(app).put('/api/projects/10').set('x-agile', 'off').send({ type: 'task_list' });
        expect(changed.body.type).toBe('task_list');
    });
    test('invalid types and archived projects cannot be changed', async () => {
        await pool.query("UPDATE project_members SET role = 'project_admin' WHERE project_id = 10");
        expect((await request(app).put('/api/projects/10').send({ type: 'invalid' })).status).toBe(400);
        await pool.query('UPDATE projects SET is_archived = TRUE WHERE id = 10');
        const changed = await request(app).put('/api/projects/10').send({ type: 'kanban' });
        expect(changed.status).toBe(409);
        expect(changed.body.code).toBe('PROJECT_ARCHIVED');
    });

    test('existing Scrum sprints work without agile; non-Scrum sprint routes refuse', async () => {
        const created = await request(app).post('/api/sprints').set('x-agile', 'off').send({ project_id: 10, name: 'Keep working', start_date: '2026-11-01', end_date: '2026-11-14' });
        expect(created.status).toBe(200);
        const list = await request(app).get('/api/sprints?project_id=10').set('x-agile', 'off');
        expect(list.body.sprints.map((sprint: any) => sprint.id)).toContain(created.body.sprint.id);
        await pool.query("UPDATE projects SET type = 'kanban' WHERE id = 20");
        for (const result of [
            await request(app).get('/api/sprints?project_id=20'),
            await request(app).post('/api/sprints').send({ project_id: 20, name: 'Invalid', start_date: '2026-11-01', end_date: '2026-11-14' }),
        ]) {
            expect(result.status).toBe(409);
            expect(result.body.code).toBe('PROJECT_HAS_NO_SPRINTS');
        }
    });

    test('non-Scrum tickets deny sprint placement but remain writable without agile', async () => {
        await pool.query("UPDATE projects SET type = 'task_list' WHERE id = 20");
        const created = await request(app).post('/api/tasks/backlog').set('x-agile', 'off').send({ project_id: 20, title: 'Plain work' });
        expect(created.status).toBe(200);
        expect(created.body.capabilities.can.edit.allowed).toBe(true);
        expect(created.body.capabilities.can.placeInSprint).toEqual({ allowed: false, reason: 'PROJECT_HAS_NO_SPRINTS' });
    });

    test('every project response carries tabs and role capabilities, including archived lists and Kanban backlog', async () => {
        await pool.query("UPDATE projects SET type = 'kanban', kanban_backlog_enabled = TRUE WHERE id = 20");
        await pool.query("UPDATE project_members SET role = 'project_admin' WHERE project_id = 10");
        await pool.query('UPDATE projects SET is_archived = TRUE WHERE id = 10');
        for (const path of ['/api/projects?include_archived=1', '/api/projects?include_archived=1&paginate=1']) {
            const result = await request(app).get(path).set('x-agile', 'off');
            expect(result.status).toBe(200);
            const projects = result.body.projects ?? result.body;
            expect(projects.find((project: any) => project.id === 20)).toMatchObject({ planTabs: ['backlog', 'board'], hasBacklog: true, hasSprints: false });
            expect(projects.find((project: any) => project.id === 10)).toMatchObject({ capabilities: { canChangeType: false }, changeableTypes: [] });
        }
        const options = await request(app).get('/api/projects/types').set('x-agile', 'off');
        expect(options.body).toEqual({ defaultType: 'task_list', availableTypes: ['task_list'] });
    });
    test('Scrum board, configuration and ticket sprint join/edit stay available after agile loss', async () => {
        const sprint = await request(app).post('/api/sprints').send({ project_id: 10, name: 'Sprint', start_date: '2026-11-01', end_date: '2026-11-14' });
        const id = sprint.body.sprint.id;
        const board = await request(app).get('/api/sprints/' + id + '/board').set('x-agile', 'off');
        expect(board.status).toBe(200);
        const config = await request(app).get('/api/agile/config?project_id=10').set('x-agile', 'off');
        expect(config.status).toBe(200);
        const created = await request(app).post('/api/tasks/backlog').set('x-agile', 'off').send({ project_id: 10, title: 'Scrum work', sprint_id: id });
        expect(created.status).toBe(200);
        expect(created.body.sprint_id).toBe(id);
        const edited = await request(app).put('/api/tasks/' + created.body.id).set('x-agile', 'off').send({ title: 'Still works', sprint_id: id });
        expect(edited.status).toBe(200);
        expect(edited.body.sprint_id).toBe(id);
    });
    test('completed sprint history on a non-Scrum project cannot reopen or serve sprint surfaces', async () => {
        await pool.query("INSERT INTO sprints (id, project_id, name, start_date, end_date, status) VALUES (99, 20, 'Past', '2026-11-01', '2026-11-14', 'completed')");
        await pool.query("UPDATE projects SET type = 'task_list' WHERE id = 20");
        for (const path of ['/api/sprints/99/board', '/api/sprints/99/baseline', '/api/sprints/99/completion-preview', '/api/tasks/available-sprints?project_id=20']) {
            const result = await request(app).get(path);
            expect(result.status).toBe(409);
            expect(result.body.code).toBe('PROJECT_HAS_NO_SPRINTS');
        }
    });
    test('migration can run twice without changing project choices or sprint history', async () => {
        const fs = require('fs');
        const path = require('path');
        const sql = fs.readFileSync(path.join(__dirname, '../platform/db/migrations/0028_project_type_lifecycle.sql'), 'utf8');
        await pool.query("UPDATE projects SET type = 'kanban', kanban_backlog_enabled = TRUE WHERE id = 20");
        const before = (await request(app).get('/api/projects/20')).body;
        await pool.query(sql);
        await pool.query(sql);
        expect((await request(app).get('/api/projects/20')).body).toEqual(before);
    });

    test('concurrent sprint creation and leaving Scrum never strand an open sprint', async () => {
        await pool.query("UPDATE project_members SET role = 'project_admin' WHERE project_id = 10");
        const [change, create] = await Promise.all([
            request(app).put('/api/projects/10').send({ type: 'task_list' }),
            request(app).post('/api/sprints').send({ project_id: 10, name: 'Concurrent', start_date: '2026-11-01', end_date: '2026-11-14' }),
        ]);
        expect([change.status, create.status].sort()).toEqual([200, 409]);
        const project = await request(app).get('/api/projects/10');
        if (project.body.type === 'scrum') {
            expect(change.body.code).toBe('PROJECT_HAS_OPEN_SPRINTS');
            expect((await request(app).get('/api/sprints?project_id=10')).body.sprints).toHaveLength(1);
        } else expect(create.body.code).toBe('PROJECT_HAS_NO_SPRINTS');
    });
});
