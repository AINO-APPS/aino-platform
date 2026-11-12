import { Pool } from "pg";
import { installPgTypeParsers } from "../platform/db/pgTypes";
import { createTestDatabase } from "../test-support/pgTestDatabase";

installPgTypeParsers();
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = Number(req.get("x-test-user") || 1);
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-test-role") || "employee";
        req.userOrgId = Number(req.get("x-test-org") || 1);
        req.userTeamId = Number(req.get("x-test-team") || 1);
        req.roleLevel = req.userRole === "super_admin" ? 4 : 1;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
    getVisibleUserIds: async () => [1, 2],
    ROLE_LEVEL: { employee: 1, manager: 2, super_admin: 4 },
}));
jest.mock("../utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn(), broadcast: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/mailer", () => ({ notifyByEmail: jest.fn(), sendMail: jest.fn() }));
const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
const pgDescribe = url ? describe : describe.skip;
const request = require("supertest");

pgDescribe("ticket worklogs through HTTP (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    beforeAll(async () => {
        database = await createTestDatabase(url!, "worklog_routes");
        pool = new Pool({ connectionString: database.url, max: 4 });
        const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.tenant = { id: 1, features: { team_visibility: true, agile: true } };
            req.tenantId = 1;
            req.projectOwnership = req.get("x-test-project-mode") === "on";
            req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
            req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
            next();
        });
        app.use("/api/tasks", require("../routes/tasks"));
        app.use("/api/tracker", require("../modules/attendance/attendance.routes"));
        app.use('/api/admin', require('../routes/admin'));
    }, 120_000);
    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        await pool.query("TRUNCATE tasks, users, teams, organizations RESTART IDENTITY CASCADE");
        await pool.query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Worklogs', 'worklogs'), (2, 'Other', 'other')");
        await pool.query("INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Alpha'), (2, 1, 'Beta'), (3, 2, 'Other')");
        await pool.query(`INSERT INTO users (id, username, password, full_name, org_id, team_id) VALUES
            (1, 'alice', 'unused', 'Alice', 1, 1), (2, 'bob', 'unused', 'Bob', 1, 2), (3, 'carol', 'unused', 'Carol', 2, 3)`);
        await require("../platform/db/agileDefaults").seedAgileDefaults((sql: string, params: unknown[] = []) => pool.query(sql, params));
    });

    test('ticket14 worklog changes invalidate readers from another project team after commit', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Cross-team forecast' })).body.id;
        const projectId = (await pool.query('SELECT project_id FROM tasks WHERE id=$1', [id])).rows[0].project_id;
        await pool.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,1,'member'),($1,2,'viewer') ON CONFLICT DO NOTHING", [projectId]);
        const sendToUser = require('../utils/ws').sendToUser as jest.Mock;
        sendToUser.mockClear();
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-project-mode', 'on')
            .send({ day_worked: '2026-11-01', time_spent: '30m' });
        expect(saved.status).toBe(201);
        expect(sendToUser).toHaveBeenCalledWith(1, 2, 'task_updated', { taskId: id, action: 'updated' });
        const changes = [
            ['patch', `/api/tasks/${id}/worklogs/${saved.body.worklog.id}`, { time_spent: '45m' }],
            ['delete', `/api/tasks/${id}/worklogs/${saved.body.worklog.id}`, {}],
            ['patch', `/api/tasks/${id}/estimates`, { original_estimate: '2h' }],
        ] as const;
        for (const [method, endpoint, body] of changes) {
            sendToUser.mockClear();
            expect((await request(app)[method](endpoint).set('x-test-project-mode', 'on').send(body)).status).toBe(200);
            expect(sendToUser).toHaveBeenCalledWith(1, 2, 'task_updated', { taskId: id, action: 'updated' });
            expect(sendToUser).not.toHaveBeenCalledWith(1, 3, 'task_updated', expect.anything());
        }
        expect((await request(app).post(`/api/tasks/${id}/worklogs`)
            .send({ day_worked: '2026-11-01', time_spent: '30m' })).status).toBe(201);
        expect(sendToUser).not.toHaveBeenCalledWith(1, 2, 'task_updated', expect.anything());
    });

    test('worklog list includes both persisted estimates, including explicit zero and null', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'List forecast' })).body.id;
        const endpoint = `/api/tasks/${id}/worklogs`;
        expect((await request(app).get(endpoint)).body).toMatchObject({ original_estimate_minutes: null, remaining_estimate_minutes: null });
        await request(app).patch(`/api/tasks/${id}/estimates`).send({ original_estimate: '2h', remaining_estimate: '0m' });
        expect((await request(app).get(endpoint)).body).toMatchObject({ original_estimate_minutes: 120, remaining_estimate_minutes: 0 });
    });

    test('project grants allow cross-team effort but retain viewer, archive and on-behalf restrictions', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Project effort' })).body.id;
        const projectId = (await pool.query('SELECT project_id FROM tasks WHERE id=$1', [id])).rows[0].project_id;
        await pool.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,2,'member')", [projectId]);
        const asMember = (method: 'post' | 'patch', endpoint: string) => request(app)[method](endpoint)
            .set('x-test-project-mode', 'on').set('x-test-user', '2').set('x-test-team', '2');
        const saved = await asMember('post', `/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '30m' });
        expect(saved.status).toBe(201);
        expect((await asMember('patch', `/api/tasks/${id}/estimates`).send({ original_estimate: '2h' })).status).toBe(200);
        await pool.query("UPDATE project_members SET role='project_admin' WHERE project_id=$1 AND user_id=2", [projectId]);
        const behalf = await asMember('post', `/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h', author_id: 1 });
        expect(behalf.status).toBe(201);
        expect(behalf.body.worklog).toMatchObject({ author_id: 1, logged_by_id: 2, canEdit: true, canDelete: true });
        await pool.query("UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=2", [projectId]);
        expect((await asMember('patch', `/api/tasks/${id}/worklogs/${saved.body.worklog.id}`).send({ comment: 'No longer writable' })).status).toBe(403);
        await pool.query('UPDATE projects SET is_archived=TRUE WHERE id=$1', [projectId]);
        const archived = await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-project-mode', 'on')
            .set('x-test-role', 'super_admin').send({ day_worked: '2026-11-01', time_spent: '1h' });
        expect(archived.status).toBe(409);
        expect(archived.body.code).toBe('PROJECT_ARCHIVED');
    });

    test('ticket07 project admins edit and delete another author within their project, with auditable attribution', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Project administration' })).body.id;
        const projectId = (await pool.query('SELECT project_id FROM tasks WHERE id=$1', [id])).rows[0].project_id;
        await pool.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,2,'project_admin')", [projectId]);
        const asAdmin = (method: 'get' | 'post' | 'patch' | 'delete', endpoint: string) => request(app)[method](endpoint)
            .set('x-test-project-mode', 'on').set('x-test-user', '2').set('x-test-team', '2');
        const endpoint = `/api/tasks/${id}/worklogs`;
        const created = await asAdmin('post', endpoint).send({ day_worked: '2026-11-01', time_spent: '1h', author_id: 1 });
        expect(created.status).toBe(201);
        const worklog = created.body.worklog;
        expect(worklog).toMatchObject({ author_id: 1, logged_by_id: 2, minutes: 60, canEdit: true, canDelete: true });
        expect((await asAdmin('get', endpoint)).body.worklogs).toEqual([worklog]);
        const edited = await asAdmin('patch', `${endpoint}/${worklog.id}`).send({ time_spent: '90m', comment: 'Corrected by project admin' });
        expect(edited.status).toBe(200);
        expect(edited.body.worklog).toMatchObject({ author_id: 1, logged_by_id: 2, minutes: 90, canEdit: true, canDelete: true });
        expect(edited.body.ticket.time_spent_minutes).toBe(90);
        const deleted = await asAdmin('delete', `${endpoint}/${worklog.id}`).send({});
        expect(deleted.status).toBe(200);
        expect(deleted.body.ticket.time_spent_minutes).toBe(0);
        expect((await asAdmin('get', endpoint)).body.worklogs).toEqual([]);
        const history = (await asAdmin('get', `/api/tasks/${id}/history`)).body;
        for (const action of ['worklog_added', 'worklog_updated', 'worklog_deleted']) {
            expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ action, user_id: 2 })]));
        }
    });

    test.each(['member', 'viewer'])('ticket07 %s cannot create, edit or delete another person\'s worklog', async role => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Restricted effort' })).body.id;
        const projectId = (await pool.query('SELECT project_id FROM tasks WHERE id=$1', [id])).rows[0].project_id;
        await pool.query('INSERT INTO project_members (project_id,user_id,role) VALUES ($1,2,$2)', [projectId, role]);
        const endpoint = `/api/tasks/${id}/worklogs`;
        const saved = await request(app).post(endpoint).send({ day_worked: '2026-11-01', time_spent: '30m' });
        const asActor = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => request(app)[method](path)
            .set('x-test-project-mode', 'on').set('x-test-user', '2').set('x-test-team', '2');
        expect((await asActor('get', endpoint)).body.worklogs[0]).toMatchObject({ canEdit: false, canDelete: false });
        expect((await asActor('post', endpoint).send({ day_worked: '2026-11-01', time_spent: '1h', author_id: 1 })).status).toBe(403);
        expect((await asActor('patch', `${endpoint}/${saved.body.worklog.id}`).send({ time_spent: '1h' })).status).toBe(403);
        expect((await asActor('delete', `${endpoint}/${saved.body.worklog.id}`).send({})).status).toBe(403);
        expect((await request(app).get(endpoint)).body.time_spent_minutes).toBe(30);
    });

    test('ticket07 project admin privilege is limited to the ticket project and organization', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Scoped effort' })).body.id;
        const projectId = (await pool.query('SELECT project_id FROM tasks WHERE id=$1', [id])).rows[0].project_id;
        const otherProject = (await pool.query(
            "INSERT INTO projects (org_id,key,name,created_by) VALUES (1,'OTHER','Other project',1) RETURNING id",
        )).rows[0].id;
        await pool.query("INSERT INTO project_members (project_id,user_id,role) VALUES ($1,2,'project_admin'),($2,2,'member')", [otherProject, projectId]);
        const endpoint = `/api/tasks/${id}/worklogs`;
        const saved = (await request(app).post(endpoint).send({ day_worked: '2026-11-01', time_spent: '30m' })).body.worklog;
        const asAdmin = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => request(app)[method](path)
            .set('x-test-project-mode', 'on').set('x-test-user', '2').set('x-test-team', '2');
        expect((await asAdmin('get', endpoint)).body.worklogs[0]).toMatchObject({ canEdit: false, canDelete: false });
        expect((await asAdmin('post', endpoint).send({ day_worked: '2026-11-01', time_spent: '1h', author_id: 1 })).status).toBe(403);
        expect((await asAdmin('patch', `${endpoint}/${saved.id}`).send({ time_spent: '1h' })).status).toBe(403);
        expect((await asAdmin('delete', `${endpoint}/${saved.id}`).send({})).status).toBe(403);
        const foreign = (method: 'post' | 'patch' | 'delete', path: string) => request(app)[method](path)
            .set('x-test-project-mode', 'on').set('x-test-user', '3').set('x-test-org', '2').set('x-test-team', '3').set('x-test-role', 'super_admin');
        expect((await foreign('post', endpoint).send({ day_worked: '2026-11-01', time_spent: '1h', author_id: 3 })).status).toBe(404);
        expect((await foreign('patch', `${endpoint}/${saved.id}`).send({ comment: 'Foreign' })).status).toBe(404);
        expect((await foreign('delete', `${endpoint}/${saved.id}`).send({})).status).toBe(404);
    });

    test.each(['super_admin', 'hr_admin', 'platform_admin'])('ticket07 %s retains on-behalf CRUD in project mode without project grants', async role => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Org administration' })).body.id;
        const endpoint = `/api/tasks/${id}/worklogs`;
        const admin = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => request(app)[method](path)
            .set('x-test-project-mode', 'on').set('x-test-user', '2').set('x-test-team', '2').set('x-test-role', role);
        const saved = await admin('post', endpoint).send({ day_worked: '2026-11-01', time_spent: '30m', author_id: 1 });
        expect(saved.status).toBe(201);
        expect(saved.body.worklog).toMatchObject({ author_id: 1, logged_by_id: 2, canEdit: true, canDelete: true });
        expect((await admin('patch', `${endpoint}/${saved.body.worklog.id}`).send({ time_spent: '1h' })).status).toBe(200);
        expect((await admin('delete', `${endpoint}/${saved.body.worklog.id}`).send({})).status).toBe(200);
    });

    test('ticket07 team-derived project admins can mutate others, but cannot after their grant is downgraded or project archived', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Team project administration' })).body.id;
        const projectId = (await pool.query('SELECT project_id FROM tasks WHERE id=$1', [id])).rows[0].project_id;
        await pool.query("INSERT INTO project_members (project_id,team_id,role) VALUES ($1,2,'project_admin')", [projectId]);
        const endpoint = `/api/tasks/${id}/worklogs`;
        const admin = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => request(app)[method](path)
            .set('x-test-project-mode', 'on').set('x-test-user', '2').set('x-test-team', '2');
        const saved = await admin('post', endpoint).send({ day_worked: '2026-11-01', time_spent: '30m', author_id: 1 });
        expect(saved.status).toBe(201);
        const worklogPath = `${endpoint}/${saved.body.worklog.id}`;
        expect((await admin('patch', worklogPath).send({ time_spent: '1h' })).status).toBe(200);
        await pool.query("UPDATE project_members SET role='member' WHERE project_id=$1 AND team_id=2", [projectId]);
        expect((await admin('get', endpoint)).body.worklogs[0]).toMatchObject({ canEdit: false, canDelete: false });
        expect((await admin('patch', worklogPath).send({ comment: 'Downgraded' })).status).toBe(403);
        expect((await admin('delete', worklogPath).send({})).status).toBe(403);
        await pool.query("UPDATE project_members SET role='project_admin' WHERE project_id=$1 AND team_id=2", [projectId]);
        await pool.query('UPDATE projects SET is_archived=TRUE WHERE id=$1', [projectId]);
        expect((await admin('get', endpoint)).body.worklogs[0]).toMatchObject({ canEdit: false, canDelete: false });
        for (const role of ['employee', 'super_admin']) {
            for (const [method, target, body] of [
                ['post', endpoint, { day_worked: '2026-11-01', time_spent: '1h', author_id: 1 }],
                ['patch', worklogPath, { comment: 'Archived' }], ['delete', worklogPath, {}],
            ] as const) {
                const denied = await admin(method, target).set('x-test-role', role).send(body);
                expect(denied.status).toBe(409);
                expect(denied.body.code).toBe('PROJECT_ARCHIVED');
            }
        }
    });

    test('repository mutations cannot target a ticket or worklog in another org', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Scoped effort' })).body.id;
        await request(app).patch(`/api/tasks/${id}/estimates`).send({ original_estimate: '2h' });
        const row = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '30m' })).body.worklog;
        const db = { query: (sql: string, params: unknown[]) => pool.query(sql, params) };
        const estimates = require('../modules/tasks/tasks.estimateRepository');
        const worklogs = require('../modules/tasks/tasks.worklogRepository');
        await estimates.writeEstimates(db, id, 999, 999, 2);
        await estimates.writeRemaining(db, id, 888, 2);
        expect(await worklogs.lockWorklog(db, id, row.id, 2)).toBeUndefined();
        await worklogs.updateWorklog(db, row.id, { day_worked: '2026-11-02' }, 999, id, 2);
        await worklogs.softDeleteWorklog(db, row.id, id, 2);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body).toMatchObject({ original_estimate_minutes: 120, remaining_estimate_minutes: 90 });
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([row]);
    });

    test('sets duration estimates, seeds an empty forecast, clears explicitly and preserves the legacy alias', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Forecast' })).body.id;
        const endpoint = `/api/tasks/${id}/estimates`;
        const saved = await request(app).patch(endpoint).send({ original_estimate: '2h' });
        expect(saved.status).toBe(200);
        expect(saved.body.ticket).toMatchObject({ original_estimate_minutes:120, remaining_estimate_minutes:120 });
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body).toMatchObject({ original_estimate_minutes:120, remaining_estimate_minutes:120, capabilities:{can:{canEditEstimate:{allowed:true}}} });
        expect((await request(app).patch(endpoint).send({ remaining_estimate: '0m' })).body.ticket.remaining_estimate_minutes).toBe(0);
        expect((await request(app).patch(endpoint).send({ original_estimate: '3h' })).body.ticket.remaining_estimate_minutes).toBe(0);
        expect((await request(app).patch(endpoint).send({ original_estimate:'', remaining_estimate:'' })).body.ticket).toMatchObject({ original_estimate_minutes:null, remaining_estimate_minutes:null });
        const history = await request(app).get(`/api/tasks/${id}/history`);
        expect(history.body.some((row:any) => row.action === 'estimate_changed')).toBe(true);
    });
    test.each([
        ['auto',90,60,90,120], ['set',45,45,45,45], ['leave',120,120,120,120],
    ])('%s forecast applies atomically through add, edit up/down and delete', async (mode,added,up,down,removed) => {
        const id=(await request(app).post('/api/tasks/backlog').send({title:'Forecast modes'})).body.id;
        await request(app).patch(`/api/tasks/${id}/estimates`).send({original_estimate:'2h'});
        const choice={remaining_mode:mode,...(mode==='set'?{remaining_estimate:'45m'}:{})};
        const saved=await request(app).post(`/api/tasks/${id}/worklogs`).send({day_worked:'2026-11-01',time_spent:'30m',...choice});
        expect(saved.status).toBe(201);
        expect(saved.body.ticket.remaining_estimate_minutes).toBe(added);
        const endpoint=`/api/tasks/${id}/worklogs/${saved.body.worklog.id}`;
        const edited=await request(app).patch(endpoint).send({time_spent:'1h',...choice});
        expect(edited.status).toBe(200);
        expect(edited.body.ticket.remaining_estimate_minutes).toBe(up);
        expect((await request(app).patch(endpoint).send({time_spent:'30m',...choice})).body.ticket.remaining_estimate_minutes).toBe(down);
        expect((await request(app).delete(endpoint).send(choice)).body.ticket.remaining_estimate_minutes).toBe(removed);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body).toMatchObject({remaining_estimate_minutes:removed,time_spent_minutes:0});
    });
    test.each(['task_history','audit_logs'])('estimate writes roll back if %s fails and do not emit realtime', async table => {
        const id=(await request(app).post('/api/tasks/backlog').send({title:'Atomic estimate'})).body.id;
        const messages:unknown[]=[];
        const send=require('../utils/ws').sendToUser;
        send.mockImplementation((...args:unknown[])=>messages.push(args));
        await pool.query(`CREATE FUNCTION reject_estimate() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test estimate failure'; END $$;
            CREATE TRIGGER reject_estimate BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_estimate()`);
        try {
            expect((await request(app).patch(`/api/tasks/${id}/estimates`).send({original_estimate:'2h'})).status).toBe(500);
            expect((await request(app).get(`/api/tasks/${id}/detail`)).body).toMatchObject({original_estimate_minutes:null,remaining_estimate_minutes:null});
            expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((row:any)=>row.action==='estimate_changed')).toEqual([]);
            expect((await request(app).get(`/api/admin/audit-logs?entity_id=${id}&action=estimate_changed`).set('x-test-role','super_admin')).body.total).toBe(0);
            expect(messages).toEqual([]);
        } finally { await pool.query(`DROP TRIGGER reject_estimate ON ${table}; DROP FUNCTION reject_estimate()`);send.mockReset(); }
    });

    test('estimate history, audit and team realtime expose only committed forecasts',async()=>{
        const id=(await request(app).post('/api/tasks/backlog').send({title:'Committed estimates'})).body.id;
        await pool.query('UPDATE users SET team_id=1 WHERE id=2');
        const messages:Array<{userId:number;event:string;payload:any;visible:Promise<any>}>=[];
        const send=require('../utils/ws').sendToUser;
        send.mockImplementation((_tenant:number,userId:number,event:string,payload:any)=>messages.push({userId,event,payload,
            visible:request(app).get(`/api/tasks/${id}/detail`).then((r:any)=>r.body)}));
        try {
            const result=await request(app).patch(`/api/tasks/${id}/estimates`).send({original_estimate:'2h',remaining_estimate:'45m'});
            expect(result.status).toBe(200);
            expect(messages.map(({userId,event,payload})=>({userId,event,payload}))).toEqual([
                {userId:1,event:'task_updated',payload:{taskId:id,action:'updated'}},{userId:2,event:'task_updated',payload:{taskId:id,action:'updated'}}]);
            for(const message of messages)expect(await message.visible).toMatchObject({original_estimate_minutes:120,remaining_estimate_minutes:45});
            const history=(await request(app).get(`/api/tasks/${id}/history`)).body.find((row:any)=>row.action==='estimate_changed');
            expect(JSON.parse(history.old_value)).toEqual({original_estimate_minutes:null,remaining_estimate_minutes:null});
            expect(JSON.parse(history.new_value)).toEqual({original_estimate_minutes:120,remaining_estimate_minutes:45});
            const audit=(await request(app).get(`/api/admin/audit-logs?entity_id=${id}&action=estimate_changed`).set('x-test-role','super_admin')).body;
            expect(audit.total).toBe(1);
            expect(JSON.parse(audit.logs[0].details).after).toEqual({original_estimate_minutes:120,remaining_estimate_minutes:45});
        }finally{send.mockReset();}
    });

    test('estimate endpoint rejects invalid fields, foreign actors and frozen/cancelled work',async()=>{
        const id=(await request(app).post('/api/tasks/backlog').send({title:'Guarded forecasts'})).body.id;
        const endpoint=`/api/tasks/${id}/estimates`;
        for(const input of [{},{original_estimate:'abc'},{original_estimate:null},{remaining_estimate:'-1h'},{estimated_minutes:120}])
            expect((await request(app).patch(endpoint).send(input)).status).toBe(400);
        expect((await request(app).patch(endpoint).set('x-test-user','2').set('x-test-team','2').send({original_estimate:'1h'})).status).toBe(403);
        expect((await request(app).patch(endpoint).set('x-test-org','2').set('x-test-role','super_admin').send({original_estimate:'1h'})).status).toBe(404);
        await pool.query("INSERT INTO sprints(id,team_id,name,status,start_date,end_date) VALUES(50,1,'Frozen','completed','2026-10-01','2026-10-14')");
        await pool.query('UPDATE tasks SET sprint_id=50 WHERE id=$1',[id]);
        expect((await request(app).patch(endpoint).send({original_estimate:'1h'})).status).toBe(409);
        await pool.query("INSERT INTO workflow_states(org_id,key,name,category,is_terminal) VALUES(1,'cancelled','Cancelled','done',TRUE) ON CONFLICT DO NOTHING");
        await pool.query("UPDATE tasks SET sprint_id=NULL,workflow_state_id=(SELECT id FROM workflow_states WHERE org_id=1 AND key='cancelled') WHERE id=$1",[id]);
        expect((await request(app).patch(endpoint).send({original_estimate:'1h'})).status).toBe(403);
    });

    test('default auto preserves null, clamps overruns and returns deleted effort', async () => {
        const id=(await request(app).post('/api/tasks/backlog').send({title:'Default forecast'})).body.id;
        const saved=await request(app).post(`/api/tasks/${id}/worklogs`).send({day_worked:'2026-11-01',time_spent:'1h'});
        expect(saved.body.ticket.remaining_estimate_minutes).toBeNull();
        await request(app).patch(`/api/tasks/${id}/estimates`).send({remaining_estimate:'10m'});
        const endpoint=`/api/tasks/${id}/worklogs/${saved.body.worklog.id}`;
        expect((await request(app).patch(endpoint).send({time_spent:'2h'})).body.ticket.remaining_estimate_minutes).toBe(0);
        expect((await request(app).delete(endpoint)).body.ticket.remaining_estimate_minutes).toBe(120);
    });

    test('invalid remaining inputs preserve work and forecasts', async () => {
        const id=(await request(app).post('/api/tasks/backlog').send({title:'Invalid forecast'})).body.id;
        await request(app).patch(`/api/tasks/${id}/estimates`).send({original_estimate:'2h'});
        const original=(await request(app).post(`/api/tasks/${id}/worklogs`).send({day_worked:'2026-11-01',time_spent:'30m'})).body.worklog;
        for(const input of [{remaining_mode:'invalid'},{remaining_mode:null},{remaining_mode:'set'},{remaining_mode:'set',remaining_estimate:'-1h'},
            {remaining_mode:'leave',remaining_estimate:'1h'},{remaining_estimate:'1h'}]) {
            for(const method of ['post','patch','delete']) {
                const result=await request(app)[method](`/api/tasks/${id}/worklogs${method==='post'?'':`/${original.id}`}`)
                    .send({... (method==='post'?{day_worked:'2026-11-01',time_spent:'30m'}:method==='patch'?{time_spent:'1h'}:{}),...input});
                expect(result.status).toBe(400);
                expect(result.body.code).toBe('INVALID_ESTIMATE');
            }
        }
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([original]);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body.remaining_estimate_minutes).toBe(90);
    });

    test("lists newest work first, excludes deleted work, and enforces existing ticket visibility", async () => {
        const created = await request(app).post('/api/tasks/backlog').send({ title: 'Read worklogs' });
        const id = created.body.id;
        await pool.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, minutes, comment, created_at, deleted_at) VALUES
            ($1, 1, 1, '2026-10-01', 30, 'Earlier', '2026-11-03T09:00:00Z', NULL),
            ($1, 1, 1, '2026-11-02', 45, 'Newest day', '2026-11-02T09:00:00Z', NULL),
            ($1, 1, 1, '2026-11-02', 15, 'Later entry', '2026-11-02T10:00:00Z', NULL),
            ($1, 1, 1, '2026-11-03', 99, 'Deleted', NOW(), NOW())`, [id]);
        const visible = await request(app).get(`/api/tasks/${id}/worklogs`);
        expect(visible.status).toBe(200);
        expect(visible.body.time_spent_minutes).toBe(90);
        expect(visible.body.worklogs.map((w: any) => w.comment)).toEqual(['Later entry', 'Newest day', 'Earlier']);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body).toMatchObject({ time_spent_minutes: 90 });
        const tracker = await request(app).get('/api/tracker/task-time?from=2026-11-02&to=2026-11-03');
        expect(tracker.body).toEqual([{ date: '2026-11-02', minutes: 60, entries: [
            { task_id: id, title: 'Read worklogs', ticket_key: 'GEN-1', date: '2026-11-02', minutes: 60 },
        ] }]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-team', '2')).status).toBe(403);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-org', '2').set('x-test-role', 'super_admin')).status).toBe(404);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-team', '2').set('x-test-role', 'super_admin')).status).toBe(200);
        expect((await request(app).get('/api/tasks/99999/worklogs')).status).toBe(404);
    });

    test('approved leave on an old day warns after saving the worklog', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Leave work' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', 'approved')");
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1h' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['ON_LEAVE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('day total across tickets warns above worked attendance, excluding breaks and deleted work', async () => {
        const first = (await request(app).post('/api/tasks/backlog').send({ title: 'First work' })).body.id;
        const second = (await request(app).post('/api/tasks/backlog').send({ title: 'Second work' })).body.id;
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES
            (1, 'clock_in', '2020-01-15T09:00:00Z'), (1, 'break_start', '2020-01-15T10:00:00Z'),
            (1, 'break_end', '2020-01-15T10:30:00Z'), (1, 'clock_out', '2020-01-15T11:00:00Z')`);
        await pool.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, minutes, deleted_at) VALUES
            ($1, 1, 1, '2020-01-15', 1000, NOW()), ($1, 2, 1, '2020-01-15', 1000, NULL),
            ($1, 1, 1, '2020-01-14', 1000, NULL)`, [first]);
        const atLimit = await request(app).post(`/api/tasks/${first}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '90m' });
        expect(atLimit.body.warnings).toEqual([]);
        const saved = await request(app).post(`/api/tasks/${second}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
        expect((await request(app).get(`/api/tasks/${second}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test.each(['pending', 'rejected', 'revoked', 'withdraw_pending'])('non-approved leave (%s) and no attendance do not warn or prevent saving', async status => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Unconfirmed leave' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', $1)", [status]);
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '3d' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual([]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('approved leave on a future day still warns without a recent-date window', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Future leave' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2099-01-15', 'planned', 'approved')");
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2099-01-15', time_spent: '1h' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['ON_LEAVE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('attendance follows the author local day, sums split shifts, and ignores rejected entries', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Local shifts' })).body.id;
        await pool.query('UPDATE users SET timezone_offset = -330 WHERE id = 1');
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp, approval_status) VALUES
            (1, 'clock_in', '2020-01-15T18:45:00Z', 'approved'), (1, 'clock_out', '2020-01-15T19:15:00Z', 'approved'),
            (1, 'clock_in', '2020-01-16T03:30:00Z', 'approved'), (1, 'clock_out', '2020-01-16T04:00:00Z', 'approved'),
            (1, 'clock_in', '2020-01-16T05:00:00Z', 'rejected'), (1, 'clock_out', '2020-01-16T15:00:00Z', 'rejected')`);
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-16', time_spent: '61m' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
    });

    test('an open historical clock-in uses the existing end-of-local-day attendance summary', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Open shift' })).body.id;
        await pool.query("INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES (1, 'clock_in', '2020-01-15T23:00:00Z')");
        const atLimit = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '60m' });
        expect(atLimit.body.warnings).toEqual([]);
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toHaveLength(2);
    });

    test('both warnings can be returned and warning read failures never roll back or fail a saved worklog', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Advisory only' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', 'approved')");
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES
            (1, 'clock_in', '2020-01-15T09:00:00Z'), (1, 'clock_out', '2020-01-15T10:00:00Z')`);
        const first = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '2h' });
        expect(first.status).toBe(201);
        expect(first.body.warnings).toEqual(['ON_LEAVE', 'EXCEEDS_ATTENDANCE']);
        await pool.query('ALTER TABLE leaves RENAME TO unavailable_leaves');
        try {
            const second = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
            expect(second.status).toBe(201);
            expect(second.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
            expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toHaveLength(2);
            await pool.query('ALTER TABLE time_entries RENAME TO unavailable_attendance');
            try {
                const third = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '1m' });
                expect(third.status).toBe(201);
                expect(third.body.warnings).toEqual([]);
                expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toHaveLength(3);
                const warn = require('../utils/logger').logger.warn;
                for (const operation of ['approved_leave', 'attendance_comparison']) {
                    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error), tenant_id: 1,
                        org_id: 1, author_id: 1, day_worked: '2020-01-15', operation }), expect.any(String));
                }
            } finally { await pool.query('ALTER TABLE unavailable_attendance RENAME TO time_entries'); }
        } finally { await pool.query('ALTER TABLE unavailable_leaves RENAME TO leaves'); }
    });

    test('editing the day recomputes leave warnings for the saved date, and moving off leave clears them', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Correct worked day' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', 'approved')");
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-14', time_spent: '1h' })).body.worklog;
        const endpoint = `/api/tasks/${id}/worklogs/${original.id}`;
        const onLeave = await request(app).patch(endpoint).send({ day_worked: '2020-01-15' });
        expect(onLeave.status).toBe(200);
        expect(onLeave.body.warnings).toEqual(['ON_LEAVE']);
        expect(onLeave.body.worklog).toMatchObject({ id: original.id, day_worked: '2020-01-15', minutes: 60 });
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([onLeave.body.worklog]);
        const corrected = await request(app).patch(endpoint).send({ day_worked: '2020-01-14' });
        expect(corrected.status).toBe(200);
        expect(corrected.body.warnings).toEqual([]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([corrected.body.worklog]);
    });

    test('editing duration compares the new day aggregate across tickets without counting the replaced duration twice', async () => {
        const first = (await request(app).post('/api/tasks/backlog').send({ title: 'Shared day effort' })).body.id;
        const second = (await request(app).post('/api/tasks/backlog').send({ title: 'Correct effort' })).body.id;
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES
            (1, 'clock_in', '2020-01-15T09:00:00Z'), (1, 'clock_out', '2020-01-15T10:00:00Z')`);
        await request(app).post(`/api/tasks/${first}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '30m' });
        const original = (await request(app).post(`/api/tasks/${second}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '30m' })).body.worklog;
        const endpoint = `/api/tasks/${second}/worklogs/${original.id}`;
        const over = await request(app).patch(endpoint).send({ time_spent: '31m' });
        expect(over.status).toBe(200);
        expect(over.body.warnings).toEqual(['EXCEEDS_ATTENDANCE']);
        expect((await request(app).get(`/api/tasks/${second}/worklogs`)).body.worklogs).toEqual([over.body.worklog]);
        const atLimit = await request(app).patch(endpoint).send({ time_spent: '30m' });
        expect(atLimit.status).toBe(200);
        expect(atLimit.body.warnings).toEqual([]);
        expect((await request(app).get(`/api/tasks/${second}/worklogs`)).body.worklogs).toEqual([atLimit.body.worklog]);
    });

    test('edit warnings follow the saved author rather than logged-by identity', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Authored effort' })).body.id;
        await pool.query('UPDATE users SET team_id = 1, timezone_offset = -330 WHERE id = 2');
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (2, '2020-01-16', 'planned', 'approved')");
        await pool.query(`INSERT INTO time_entries (user_id, entry_type, timestamp) VALUES
            (2, 'clock_in', '2020-01-15T18:45:00Z'), (2, 'clock_out', '2020-01-15T19:15:00Z')`);
        const worklogId = (await pool.query(`INSERT INTO task_worklogs (task_id, author_id, logged_by_id, day_worked, minutes)
            VALUES ($1, 2, 1, '2020-01-15', 30) RETURNING id`, [id])).rows[0].id;
        const endpoint = `/api/tasks/${id}/worklogs/${worklogId}`;
        const saved = await request(app).patch(endpoint).set('x-test-user', '2').send({ day_worked: '2020-01-16', time_spent: '31m' });
        expect(saved.status).toBe(200);
        expect(saved.body.warnings).toEqual(['ON_LEAVE', 'EXCEEDS_ATTENDANCE']);
        expect(saved.body.worklog).toMatchObject({ author_id: 2, logged_by_id: 1, day_worked: '2020-01-16', minutes: 31 });
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2')).body.worklogs).toEqual([saved.body.worklog]);
        const noAttendance = await request(app).patch(endpoint).set('x-test-user', '2').send({ day_worked: '2020-01-17' });
        expect(noAttendance.status).toBe(200);
        expect(noAttendance.body.warnings).toEqual([]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2')).body.worklogs).toEqual([noAttendance.body.worklog]);
    });

    test('warning read failures after edits never roll back the correction or turn the saved response into an error', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Durable correction' })).body.id;
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2020-01-15', time_spent: '30m' })).body.worklog;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (1, '2020-01-15', 'planned', 'approved')");
        await pool.query('ALTER TABLE time_entries RENAME TO unavailable_attendance');
        try {
            const saved = await request(app).patch(`/api/tasks/${id}/worklogs/${original.id}`).send({ time_spent: '2h' });
            expect(saved.status).toBe(200);
            expect(saved.body.warnings).toEqual(['ON_LEAVE']);
            expect(saved.body.worklog.minutes).toBe(120);
            expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
            await pool.query('ALTER TABLE leaves RENAME TO unavailable_leaves');
            try {
                const corrected = await request(app).patch(`/api/tasks/${id}/worklogs/${original.id}`).send({ comment: 'Still saved' });
                expect(corrected.status).toBe(200);
                expect(corrected.body.warnings).toEqual([]);
                expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([corrected.body.worklog]);
                expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((entry: any) => entry.action === 'worklog_updated')).toHaveLength(2);
            } finally { await pool.query('ALTER TABLE unavailable_leaves RENAME TO leaves'); }
        } finally { await pool.query('ALTER TABLE unavailable_attendance RENAME TO time_entries'); }
    });

    test.each([['auto', 90, 60, 120], ['set', 45, 45, 45], ['leave', 120, 120, 120]])(
        'admin author changes and %s remaining choices preserve attribution and saved-author warnings', async (mode, added, edited, deleted) => {
            const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Behalf forecast' })).body.id;
            await request(app).patch(`/api/tasks/${id}/estimates`).send({ original_estimate: '2h' });
            await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (2, '2026-11-01', 'planned', 'approved')");
            const choice = { remaining_mode: mode, ...(mode === 'set' ? { remaining_estimate: '45m' } : {}) };
            const saved = await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-role', 'hr_admin')
                .send({ day_worked: '2026-11-01', time_spent: '30m', author_id: 2, ...choice });
            expect(saved.status).toBe(201);
            expect(saved.body).toMatchObject({ worklog: { author_id: 2, logged_by_id: 1 },
                ticket: { time_spent_minutes: 30, remaining_estimate_minutes: added }, warnings: ['ON_LEAVE'] });
            const endpoint = `/api/tasks/${id}/worklogs/${saved.body.worklog.id}`;
            const changed = await request(app).patch(endpoint).set('x-test-user', '2').set('x-test-role', 'hr_admin')
                .send({ author_id: 1, time_spent: '1h', ...choice });
            expect(changed.status).toBe(200);
            expect(changed.body).toMatchObject({ worklog: { author_id: 1, logged_by_id: 1 },
                ticket: { time_spent_minutes: 60, remaining_estimate_minutes: edited }, warnings: [] });
            const denied = await request(app).patch(endpoint).send({ author_id: 2, ...choice });
            expect(denied.status).toBe(403);
            expect(denied.body.code).toBe('WORKLOG_FOR_OTHERS_DENIED');
            expect((await request(app).get(`/api/tasks/${id}/detail`)).body.remaining_estimate_minutes).toBe(edited);
            const removed = await request(app).delete(endpoint).set('x-test-user', '2').set('x-test-role', 'hr_admin').send(choice);
            expect(removed.status).toBe(200);
            expect(removed.body.ticket).toMatchObject({ time_spent_minutes: 0, remaining_estimate_minutes: deleted });
        });

    test('an HR admin logs work for a same-org member with separate author and logged-by attribution', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Behalf effort' })).body.id;
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-role', 'hr_admin')
            .send({ day_worked: '2026-11-01', time_spent: '1h', author_id: 2 });
        expect(saved.status).toBe(201);
        expect(saved.body).toMatchObject({ worklog: { author_id: 2, logged_by_id: 1,
            author: { id: 2, full_name: 'Bob' }, logged_by: { id: 1, full_name: 'Alice' } },
            ticket: { time_spent_minutes: 60 } });
        const visible = await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-role', 'hr_admin');
        expect(visible.body.worklogs[0]).toEqual(saved.body.worklog);
        const history = (await request(app).get(`/api/tasks/${id}/history`)).body;
        expect(history.find((h: any) => h.action === 'worklog_added')).toMatchObject({ user_id: 1 });
    });

    test.each([2, 1, null, '2', 0])('a member supplying author_id %j gets 403 even for self or malformed values', async author_id => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Author denied' })).body.id;
        const result = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h', author_id });
        expect(result.status).toBe(403);
        expect(result.body).toMatchObject({ code: 'WORKLOG_FOR_OTHERS_DENIED' });
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body).toMatchObject({ worklogs: [], time_spent_minutes: 0 });
        expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((h: any) => h.action === 'worklog_added')).toEqual([]);
    });

    test.each([3, 99999, 0, -1, 1.5, '2', null, true, {}, [], 2147483648])('an admin cannot use invalid or foreign author_id %j', async author_id => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Validate author' })).body.id;
        const result = await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-role', 'hr_admin')
            .send({ day_worked: '2026-11-01', time_spent: '1h', author_id });
        expect(result.status).toBe(400);
        expect(result.body.code).toBe('INVALID_WORKLOG');
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([]);
    });

    test.each(['hr_admin', 'super_admin', 'platform_admin'])('%s edits and deletes another author’s worklog without becoming its logger', async role => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Admin correction' })).body.id;
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h', comment: 'Original' })).body.worklog;
        const endpoint = `/api/tasks/${id}/worklogs/${original.id}`;
        const listed = await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-team', '2').set('x-test-role', role);
        expect(listed.body.worklogs[0]).toMatchObject({ canEdit: true, canDelete: true });
        const edited = await request(app).patch(endpoint).set('x-test-user', '2').set('x-test-team', '2').set('x-test-role', role)
            .send({ day_worked: '2026-11-02', time_spent: '30m', start_time: '10:15', comment: 'Admin correction' });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({ worklog: { author_id: 1, logged_by_id: 1, minutes: 30,
            day_worked: '2026-11-02', start_time: '10:15:00', comment: 'Admin correction' }, ticket: { time_spent_minutes: 30 } });
        const removed = await request(app).delete(endpoint).set('x-test-user', '2').set('x-test-team', '2').set('x-test-role', role);
        expect(removed.status).toBe(200);
        expect(removed.body.ticket.time_spent_minutes).toBe(0);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([]);
        const history = (await request(app).get(`/api/tasks/${id}/history`)).body;
        for (const action of ['worklog_updated', 'worklog_deleted']) expect(history.find((h: any) => h.action === action)).toMatchObject({ user_id: 2 });
    });

    test('admin can change a worklog author, validates the same-org person and retains the original logger', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Correct author' })).body.id;
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' })).body.worklog;
        const endpoint = `/api/tasks/${id}/worklogs/${original.id}`;
        for (const author_id of [1, 2, null, '2']) {
            const denied = await request(app).patch(endpoint).send({ author_id });
            expect(denied.status).toBe(403);
            expect(denied.body.code).toBe('WORKLOG_FOR_OTHERS_DENIED');
        }
        for (const author_id of [3, 99999, 0, 1.5, null, '2']) {
            const invalid = await request(app).patch(endpoint).set('x-test-role', 'hr_admin').send({ author_id });
            expect(invalid.status).toBe(400);
            expect(invalid.body.code).toBe('INVALID_WORKLOG');
        }
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([original]);
        const changed = await request(app).patch(endpoint).set('x-test-role', 'hr_admin').send({ author_id: 2 });
        expect(changed.status).toBe(200);
        expect(changed.body.worklog).toMatchObject({ author_id: 2, logged_by_id: 1, minutes: 60,
            author: { full_name: 'Bob' }, logged_by: { full_name: 'Alice' }, canEdit: true, canDelete: true });
        await pool.query('UPDATE users SET team_id = 1 WHERE id = 2');
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs[0]).toMatchObject({ canEdit: false, canDelete: false });
        const byAuthor = await request(app).patch(endpoint).set('x-test-user', '2').send({ comment: 'My time' });
        expect(byAuthor.status).toBe(200);
        expect(byAuthor.body.worklog).toMatchObject({ author_id: 2, logged_by_id: 1 });
        const history = (await request(app).get(`/api/tasks/${id}/history`)).body;
        const correction = history.find((h: any) => h.action === 'worklog_updated' && h.user_id === 1);
        expect(JSON.parse(correction.old_value)).toMatchObject({ author_id: 1, logged_by_id: 1 });
        expect(JSON.parse(correction.new_value)).toMatchObject({ author_id: 2, logged_by_id: 1 });
    });

    test('behalf create and author corrections compute warnings for the saved author, not the admin or previous author', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Author warnings' })).body.id;
        await pool.query("INSERT INTO leaves (user_id, date, leave_type, status) VALUES (2, '2026-11-01', 'planned', 'approved')");
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-role', 'hr_admin')
            .send({ day_worked: '2026-11-01', time_spent: '1h', author_id: 2 });
        expect(saved.status).toBe(201);
        expect(saved.body.warnings).toEqual(['ON_LEAVE']);
        const endpoint = `/api/tasks/${id}/worklogs/${saved.body.worklog.id}`;
        const reassigned = await request(app).patch(endpoint).set('x-test-role', 'hr_admin').send({ author_id: 1 });
        expect(reassigned.status).toBe(200);
        expect(reassigned.body.worklog).toMatchObject({ author_id: 1, logged_by_id: 1 });
        expect(reassigned.body.warnings).toEqual([]);
        const returned = await request(app).patch(endpoint).set('x-test-role', 'hr_admin').send({ author_id: 2 });
        expect(returned.status).toBe(200);
        expect(returned.body.warnings).toEqual(['ON_LEAVE']);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body.time_spent_minutes).toBe(60);
    });

    test('worklog capabilities are server-decided for the author or an org admin', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Own effort' })).body.id;
        await pool.query('UPDATE users SET team_id = 1 WHERE id = 2');
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' });
        expect(saved.body.worklog).toMatchObject({ canEdit: true, canDelete: true });
        for (const role of ['employee', 'super_admin']) {
            const other = await request(app).get(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-role', role);
            expect(other.status).toBe(200);
            expect(other.body.worklogs[0]).toMatchObject({ canEdit: role === 'super_admin', canDelete: role === 'super_admin' });
        }
    });

    test('author corrects every worklog field while another member is forbidden', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Correct effort' })).body.id;
        await pool.query('UPDATE organizations SET work_hours_per_day = 7 WHERE id = 1');
        await pool.query('UPDATE users SET team_id = 1 WHERE id = 2');
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', start_time: '09:00', time_spent: '1h', comment: 'First' })).body.worklog;
        const endpoint = `/api/tasks/${id}/worklogs/${original.id}`;
        for (const role of ['employee', 'manager']) {
            expect((await request(app).patch(endpoint).set('x-test-user', '2').set('x-test-role', role).send({ comment: 'Not mine' })).status).toBe(403);
        }
        const edited = await request(app).patch(endpoint).send({ day_worked: '2026-11-02', start_time: '10:30', time_spent: '1d', comment: 'Corrected' });
        expect(edited.status).toBe(200);
        expect(edited.body).toMatchObject({ worklog: { id: original.id, author_id: 1, logged_by_id: 1, canEdit: true, canDelete: true,
            day_worked: '2026-11-02', start_time: '10:30:00', minutes: 420, comment: 'Corrected', created_at: original.created_at },
            ticket: { id, time_spent_minutes: 420 }, warnings: [] });
        const commentOnly = await request(app).patch(endpoint).send({ comment: null });
        expect(commentOnly.status).toBe(200);
        expect(commentOnly.body.worklog).toMatchObject({ minutes: 420, day_worked: '2026-11-02', start_time: '10:30:00', comment: null });
        expect((await request(app).patch(endpoint).send({ start_time: null })).body.worklog.start_time).toBeNull();
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body.time_spent_minutes).toBe(420);
        expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((h: any) => h.action === 'worklog_updated')).toHaveLength(3);
        const audit = (await request(app).get(`/api/admin/audit-logs?entity_id=${id}&action=worklog_updated`).set('x-test-role', 'super_admin')).body;
        expect(audit).toMatchObject({ total: 3, logs: expect.arrayContaining([expect.objectContaining({ actor_id: 1 })]) });
    });

    test('author soft-deletes work, excluding it from list, ticket and daily totals but preserving history', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Remove mistake' })).body.id;
        await pool.query('UPDATE users SET team_id = 1 WHERE id = 2');
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h', comment: 'Mistake' })).body.worklog;
        await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '30m', comment: 'Keep' });
        const endpoint = `/api/tasks/${id}/worklogs/${original.id}`;
        for (const role of ['employee', 'manager']) {
            expect((await request(app).delete(endpoint).set('x-test-user', '2').set('x-test-role', role)).status).toBe(403);
        }
        const deleted = await request(app).delete(endpoint);
        expect(deleted.status).toBe(200);
        expect(deleted.body).toMatchObject({ ticket: { id, time_spent_minutes: 30 } });
        const list = (await request(app).get(`/api/tasks/${id}/worklogs`)).body;
        expect(list).toMatchObject({ time_spent_minutes: 30, worklogs: [{ comment: 'Keep' }] });
        expect(list.worklogs).toHaveLength(1);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body.time_spent_minutes).toBe(30);
        expect((await request(app).get('/api/tracker/task-time?from=2026-11-01&to=2026-11-01')).body[0].minutes).toBe(30);
        const history = (await request(app).get(`/api/tasks/${id}/history`)).body;
        const removed = history.find((h: any) => h.action === 'worklog_deleted');
        expect(JSON.parse(removed.old_value)).toMatchObject({ id: original.id, minutes: 60, comment: 'Mistake' });
        expect(JSON.parse(removed.new_value)).toMatchObject({ id: original.id, deleted_at: expect.any(String) });
        expect(history.filter((h: any) => h.action === 'worklog_added')).toHaveLength(2);
        expect((await request(app).get(`/api/admin/audit-logs?entity_id=${id}&action=worklog_deleted`).set('x-test-role', 'super_admin')).body.total).toBe(1);
        expect((await request(app).delete(endpoint)).status).toBe(404);
        expect((await request(app).patch(endpoint).send({ comment: 'Cannot resurrect' })).status).toBe(404);
    });

    test('edit/delete remain own-author actions after Done or Cancelled and reject bad input without mutation', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Validate corrections' })).body.id;
        const otherId = (await request(app).post('/api/tasks/backlog').send({ title: 'Other ticket' })).body.id;
        const worklog = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h', comment: 'Keep' })).body.worklog;
        const endpoint = `/api/tasks/${id}/worklogs/${worklog.id}`;
        for (const fields of [{}, { day_worked: '2026-02-30' }, { day_worked: null }, { start_time: '25:00' }, { comment: 123 }, { unknown_field: 2 }]) {
            const result = await request(app).patch(endpoint).send(fields);
            expect(result.status).toBe(400);
            expect(result.body.code).toBe('INVALID_WORKLOG');
        }
        for (const time_spent of ['abc', '0m', '-1h', '', null]) {
            const result = await request(app).patch(endpoint).send({ time_spent });
            expect(result.status).toBe(400);
            expect(result.body.code).toBe('INVALID_DURATION');
        }
        expect((await request(app).delete(endpoint).send({ unsupported: true })).status).toBe(400);
        for (const method of ['patch', 'delete']) {
            expect((await request(app)[method](`/api/tasks/${otherId}/worklogs/${worklog.id}`).send({ comment: 'No' })).status).toBe(404);
            expect((await request(app)[method](endpoint).set('x-test-org', '2').send({ comment: 'No' })).status).toBe(404);
            expect((await request(app)[method](`/api/tasks/${id}/worklogs/99999`).send({ comment: 'No' })).status).toBe(404);
        }
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([worklog]);
        expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((h: any) => ['worklog_updated', 'worklog_deleted'].includes(h.action))).toEqual([]);
        await pool.query("UPDATE tasks SET workflow_state_id = (SELECT id FROM workflow_states WHERE org_id = 1 AND key = 'done') WHERE id = $1", [id]);
        expect((await request(app).patch(endpoint).send({ comment: 'After Done' })).status).toBe(200);
        await pool.query("INSERT INTO workflow_states (org_id, key, name, category, is_terminal) VALUES (1, 'cancelled', 'Cancelled', 'done', TRUE) ON CONFLICT DO NOTHING");
        await pool.query("UPDATE tasks SET workflow_state_id = (SELECT id FROM workflow_states WHERE org_id = 1 AND key = 'cancelled') WHERE id = $1", [id]);
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs[0]).toMatchObject({ canEdit: true, canDelete: true });
        expect((await request(app).patch(endpoint).send({ comment: 'After cancellation' })).status).toBe(200);
        expect((await request(app).delete(endpoint)).status).toBe(200);
    });

    test.each(['patch', 'delete'])('%s publishes committed worklog changes and durable audit/history', async method => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Committed correction' })).body.id;
        await pool.query('UPDATE users SET team_id = 1 WHERE id = 2');
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' })).body.worklog;
        const received: Array<{ userId: number; event: string; payload: any; visible: Promise<any> }> = [];
        const send = require('../utils/ws').sendToUser;
        send.mockImplementation((_tenant: number, userId: number, event: string, payload: any) => {
            received.push({ userId, event, payload, visible: request(app).get(`/api/tasks/${id}/worklogs`).then((r: any) => r.body) });
        });
        try {
            const result = await request(app)[method](`/api/tasks/${id}/worklogs/${original.id}`).send(method === 'patch' ? { time_spent: '30m' } : {});
            expect(result.status).toBe(200);
            expect(received.map(({ userId, event, payload }) => ({ userId, event, payload }))).toEqual([
                { userId: 1, event: 'task_updated', payload: { taskId: id, action: 'updated' } },
                { userId: 2, event: 'task_updated', payload: { taskId: id, action: 'updated' } },
            ]);
            for (const message of received) {
                const visible = await message.visible;
                expect(visible.time_spent_minutes).toBe(method === 'patch' ? 30 : 0);
                expect(visible.worklogs).toEqual(method === 'patch' ? [result.body.worklog] : []);
            }
        } finally { send.mockReset(); }
    });

    test.each([['patch', 'task_history'], ['patch', 'audit_logs'], ['delete', 'task_history'], ['delete', 'audit_logs']])('%s rolls back when %s fails, without announcing changes', async (method, table) => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Atomic correction' })).body.id;
        await request(app).patch(`/api/tasks/${id}/estimates`).send({ original_estimate: '2h' });
        const original = (await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' })).body.worklog;
        const messages: unknown[] = [];
        const send = require('../utils/ws').sendToUser;
        send.mockImplementation((...message: unknown[]) => messages.push(message));
        await pool.query(`CREATE FUNCTION reject_correction() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'test record failure'; END $$;
            CREATE TRIGGER reject_correction BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION reject_correction()`);
        try {
            expect((await request(app)[method](`/api/tasks/${id}/worklogs/${original.id}`).send(method === 'patch' ? { time_spent: '30m' } : {})).status).toBe(500);
            expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body).toMatchObject({ worklogs: [original], time_spent_minutes: 60, original_estimate_minutes: 120, remaining_estimate_minutes: 60 });
            expect((await request(app).get(`/api/tasks/${id}/detail`)).body.remaining_estimate_minutes).toBe(60);
            const action = method === 'patch' ? 'worklog_updated' : 'worklog_deleted';
            expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((h: any) => h.action === action)).toEqual([]);
            expect((await request(app).get(`/api/admin/audit-logs?entity_id=${id}&action=${action}`).set('x-test-role', 'super_admin')).body.total).toBe(0);
            expect(messages).toEqual([]);
        } finally {
            await pool.query(`DROP TRIGGER reject_correction ON ${table}; DROP FUNCTION reject_correction()`);
            send.mockReset();
        }
    });

    test('invalid route identifiers are refused without a database error', async () => {
        for (const method of ['patch', 'delete']) {
            for (const path of ['/api/tasks/no/worklogs/1', '/api/tasks/1/worklogs/no', '/api/tasks/1/worklogs/0', '/api/tasks/1/worklogs/1.5']) {
                expect((await request(app)[method](path).send({ comment: 'No' })).status).toBe(400);
            }
        }
    });

    test("logs work through HTTP with org durations, visible history and refreshed ticket totals", async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Manual work' })).body.id;
        await pool.query('UPDATE organizations SET work_hours_per_day = 7 WHERE id = 1');
        const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({
            day_worked: '2026-11-01', start_time: '09:30', time_spent: '1d 30m', comment: 'Wrap-up',
        });
        expect(saved.status).toBe(201);
        expect(saved.body).toMatchObject({ worklog: { task_id: id, author_id: 1, logged_by_id: 1,
            day_worked: '2026-11-01', start_time: '09:30:00', minutes: 450, comment: 'Wrap-up', author: { full_name: 'Alice' } },
            ticket: { id, time_spent_minutes: 450 }, warnings: [] });
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.worklogs).toEqual([saved.body.worklog]);
        expect((await request(app).get(`/api/tasks/${id}/detail`)).body.time_spent_minutes).toBe(450);
        expect((await request(app).get(`/api/tasks/${id}/history`)).body).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: 'worklog_added', field: 'worklog', new_value: expect.any(String) }),
        ]));
    });

    test('invalid durations and fields save nothing; Done allows work and Cancelled refuses it', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Validate effort' })).body.id;
        for (const duration of ['abc', '0m', '-2h', '']) {
            const response = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: duration });
            expect(response.status).toBe(400);
            expect(response.body.code).toBe('INVALID_DURATION');
        }
        for (const fields of [{ day_worked: '2026-02-30' }, { start_time: '25:00' }, { comment: 123 }, { unknown_field: 2 }]) {
            expect((await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h', ...fields })).status).toBe(400);
        }
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body).toMatchObject({ worklogs: [], time_spent_minutes: 0 });
        expect((await request(app).get(`/api/tasks/${id}/history`)).body.filter((h: any) => h.action === 'worklog_added')).toEqual([]);
        expect((await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-org', '2').send({ day_worked: '2026-11-01', time_spent: '1h' })).status).toBe(404);
        expect((await request(app).post(`/api/tasks/${id}/worklogs`).set('x-test-user', '2').set('x-test-team', '2').send({ day_worked: '2026-11-01', time_spent: '1h' })).status).toBe(403);
        await pool.query("UPDATE tasks SET workflow_state_id = (SELECT id FROM workflow_states WHERE org_id = 1 AND key = 'done') WHERE id = $1", [id]);
        const done = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' });
        expect(done.status).toBe(201);
        expect(done.body.worklog).toMatchObject({ minutes: 60, start_time: null, comment: null });
        await pool.query("INSERT INTO workflow_states (org_id, key, name, category, is_terminal) VALUES (1, 'cancelled', 'Cancelled', 'done', TRUE) ON CONFLICT DO NOTHING");
        await pool.query("UPDATE tasks SET workflow_state_id = (SELECT id FROM workflow_states WHERE org_id = 1 AND key = 'cancelled') WHERE id = $1", [id]);
        const cancelled = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '1h' });
        expect(cancelled.status).toBe(403);
        expect(cancelled.body.code).toBe('WORKLOG_CANCELLED');
        expect((await request(app).get(`/api/tasks/${id}/worklogs`)).body.time_spent_minutes).toBe(60);
    });

    test('audit and history commit with work; realtime recipients can read the committed entry', async () => {
        const id = (await request(app).post('/api/tasks/backlog').send({ title: 'Auditable work' })).body.id;
        await pool.query('UPDATE users SET team_id = 1 WHERE id = 2');
        const received: Array<{ userId: number; event: string; payload: any; visible: Promise<any> }> = [];
        const send = require('../utils/ws').sendToUser;
        send.mockImplementation((_tenant: number, userId: number, event: string, payload: any) => {
            received.push({ userId, event, payload, visible: request(app).get(`/api/tasks/${id}/worklogs`).then((r: any) => r.body) });
        });
        try {
            const saved = await request(app).post(`/api/tasks/${id}/worklogs`).send({ day_worked: '2026-11-01', time_spent: '45m' });
            expect(saved.status).toBe(201);
            expect(received.map(({ userId, event, payload }) => ({ userId, event, payload }))).toEqual([
                { userId: 1, event: 'task_updated', payload: { taskId: id, action: 'updated' } },
                { userId: 2, event: 'task_updated', payload: { taskId: id, action: 'updated' } },
            ]);
            for (const message of received) expect((await message.visible).worklogs).toEqual([saved.body.worklog]);
            const audit = await request(app).get(`/api/admin/audit-logs?entity_type=task&entity_id=${id}&action=worklog_added`).set('x-test-role', 'super_admin');
            expect(audit.status).toBe(200);
            expect(audit.body).toMatchObject({ total: 1, logs: [{ actor_id: 1, org_id: 1 }] });
            expect(JSON.parse(audit.body.logs[0].details)).toMatchObject({ id: saved.body.worklog.id, minutes: 45 });
        } finally { send.mockReset(); }
    });


});
