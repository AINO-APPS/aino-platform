import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { installPgTypeParsers } from "../platform/db/pgTypes";

installPgTypeParsers();
jest.setTimeout(120_000);
let mockDb: any;
jest.mock("../db", () => ({ masterQuery: (sql: string, params: unknown[]) => mockDb.query(sql, params) }));
jest.mock("../utils/tenantManager", () => ({ getTenantPool: async () => mockDb }));
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 1;
    req.tenant = { id: Number(req.get("x-tenant") || 1), slug: "default" };
    req.tenantId = req.tenant.id;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-role") || "super_admin";
        req.userOrgId = 1;
        req.userTeamId = 1;
        next();
    },
    requireRole: () => (req: any, res: any, next: any) =>
        req.userRole === "employee" ? res.sendStatus(403) : next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
    ROLE_LEVEL: { super_admin: 5, hr_admin: 4 },
}));
jest.mock("../redis", () => ({
    invalidateOrgConfig: jest.fn(), invalidateUserContext: jest.fn(),
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
const mockError = jest.fn();
jest.mock("../utils/logger", () => ({
    logger: { error: (...args: unknown[]) => mockError(...args), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const describePg = process.env.TASKS_SCHEMA_TEST_DATABASE_URL ? describe : describe.skip;
describePg("Service Desk project HTTP routes (PostgreSQL)", () => {
    const request = require("supertest");
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let app: any;
    const submit = () => request(app).post("/api/service-desk/tickets")
        .send({ title: "Customer issue", ticket_type: "bug", priority: "critical" });
    const detail = () => request(app).get("/api/tasks/1/detail");

    beforeAll(async () => {
        database = await createTestDatabase(process.env.TASKS_SCHEMA_TEST_DATABASE_URL!, "service_desk_project");
        pool = new Pool({ connectionString: database.url, max: 3 });
        const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
        mockDb = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
        await require("../platform/db/tenantSchema").initTenantSchema(mockDb.query);
        const migrations = await require("../platform/db/migrations").runTenantMigrations(mockDb.query, { label: "service_desk_project" });
        expect(migrations.failed).toEqual([]);
        await pool.query(`CREATE TABLE tenants (
            id integer PRIMARY KEY, db_name text, db_host text, slug text, org_name text,
            is_default boolean, status text);
            INSERT INTO tenants VALUES (1, 'platform', 'localhost', 'default', 'Platform', true, 'active');
            CREATE TABLE service_desk_tickets (
                id serial PRIMARY KEY, tenant_id integer, submitted_by_user_id integer,
                submitted_by_name text, submitted_by_email text, ticket_type text, title text,
                description text, priority text, status text DEFAULT 'open', assigned_to text,
                admin_notes text, resolved_at timestamptz, created_at timestamptz DEFAULT now(),
                updated_at timestamptz DEFAULT now())`);
        const express = require("express");
        app = express();
        app.use(express.json());
        app.use((req: any, _res: any, next: any) => {
            req.db = mockDb;
            req.log = { error: mockError, warn: jest.fn(), info: jest.fn() };
            next();
        });
        app.use("/api/service-desk", require("../routes/serviceDesk"));
        app.use("/api/org", require("../routes/organization"));
        app.use("/api/tasks", require("../routes/tasks/detail"));
    }, 120_000);

    afterAll(async () => { await pool?.end(); await database?.drop(); });
    beforeEach(async () => {
        mockError.mockClear();
        await pool.query("TRUNCATE organizations, users, teams, projects, tasks, service_desk_tickets RESTART IDENTITY CASCADE");
        await pool.query(`INSERT INTO organizations (id, name, slug) VALUES (1, 'Platform', 'platform'), (2, 'Other', 'other');
            INSERT INTO teams (id, org_id, name) VALUES (1, 1, 'Support');
            INSERT INTO users (id, username, password, full_name, email, role, org_id, team_id)
            VALUES (1, 'admin', 'x', 'Admin', 'admin@example.test', 'super_admin', 1, 1)`);
        await require("../platform/db/agileDefaults").seedAgileDefaults(mockDb.query);
        await pool.query(`INSERT INTO workflow_states
            (org_id, project_id, key, name, category, color, sort_order, is_initial, is_terminal)
            SELECT s.org_id, p.id, s.key, s.name, s.category, s.color, s.sort_order, s.is_initial, s.is_terminal
            FROM workflow_states s JOIN projects p ON p.org_id = s.org_id AND p.is_general
            WHERE s.project_id IS NULL`);
        await pool.query(`INSERT INTO projects (id, org_id, key, name, origin_team_id)
            VALUES (100, 1, 'SUP', 'Support', 1), (101, 2, 'OTHER', 'Other', NULL),
                (102, 1, 'OLD', 'Archived', NULL);
            UPDATE projects SET is_archived = TRUE WHERE id = 102`);
    });

    test("configured project is saved and used with a numbered key and its initial state", async () => {
        const saved = await request(app).put("/api/org/settings").send({ service_desk_project_id: 100 });
        expect(saved.status).toBe(200);
        expect(saved.body.service_desk_project_id).toBe(100);
        const current = await request(app).get("/api/org/current");
        expect(current.body.service_desk_project_id).toBe(100);
        expect((await submit()).status).toBe(201);
        const copy = await detail();
        expect(copy.status).toBe(200);
        expect(copy.body).toMatchObject({ project_id: 100, task_number: 1, ticket_key: "SUP-1" });
        expect(copy.body.workflow_state_key).toBe("pending");
    });

    test("all customer statuses sync one way, bypass transitions and record the system actor", async () => {
        await request(app).put("/api/org/settings").send({ service_desk_project_id: 100 });
        await pool.query(`DELETE FROM workflow_transitions WHERE project_id = 100;
            UPDATE workflow_states SET sort_order = -1 WHERE project_id = 100 AND key = 'cancelled';
            INSERT INTO workflow_states (org_id, project_id, key, name, category, sort_order)
            VALUES (1, 100, 'triage', 'Triage', 'in_progress', 0),
                   (1, 100, 'finished', 'Finished', 'done', 0)`);
        expect((await submit()).status).toBe(201);
        for (const [status, key] of [
            ["in_progress", "triage"], ["acknowledged", "pending"],
            ["resolved", "finished"], ["open", "pending"], ["closed", "finished"],
        ]) {
            const updated = await request(app).patch("/api/service-desk/tickets/1").send({ status });
            expect(updated.status).toBe(200);
            expect(mockError.mock.calls).toEqual([]);
            expect((await detail()).body.workflow_state_key).toBe(key);
        }
        const history = await request(app).get("/api/tasks/1/history");
        expect(history.status).toBe(200);
        expect(history.body).toHaveLength(5);
        expect(history.body).toEqual(expect.arrayContaining([
            expect.objectContaining({ action: "service_desk_sync", actor_type: "system", user_id: null, new_value: "triage" }),
        ]));
    });

    test.each([false, true])("delete preserves the copy and its history (already done: %s)", async (done) => {
        expect((await submit()).status).toBe(201);
        if (done) {
            expect((await request(app).patch("/api/service-desk/tickets/1").send({ status: "resolved" })).status).toBe(200);
        }
        expect((await request(app).delete("/api/service-desk/tickets/1")).status).toBe(200);
        expect(mockError.mock.calls).toEqual([]);
        const copy = await detail();
        expect(copy.status).toBe(200);
        expect(copy.body.workflow_state_key).toBe(done ? "done" : "cancelled");
        const history = await request(app).get("/api/tasks/1/history");
        expect(history.body).toEqual(expect.arrayContaining([
            expect.objectContaining({
                action: "service_desk_deleted", actor_type: "system", user_id: null,
                new_value: expect.stringContaining("Service Desk ticket #1 deleted"),
            }),
        ]));
        expect((await request(app).get("/api/service-desk/tickets/1")).status).toBe(404);
    });

    test("clearing the setting uses General, never the creator's team project", async () => {
        await request(app).put("/api/org/settings").send({ service_desk_project_id: 100 });
        const cleared = await request(app).put("/api/org/settings").send({ service_desk_project_id: null });
        expect(cleared.status).toBe(200);
        expect(cleared.body.service_desk_project_id).toBeNull();
        expect((await submit()).status).toBe(201);
        expect(mockError.mock.calls).toEqual([]);
        const copy = await detail();
        expect(copy.status).toBe(200);
        expect(copy.body).toMatchObject({ ticket_key: "GEN-1", task_number: 1, workflow_state_key: "pending" });
        expect(copy.body.project_id).not.toBe(100);
    });

    test("rejects foreign, archived and invalid project settings", async () => {
        for (const id of [101, 102, 999, -1, 0, "100", 1.5, {}]) {
            const response = await request(app).put("/api/org/settings").send({ service_desk_project_id: id });
            expect(response.status).toBe(400);
        }
        expect((await request(app).get("/api/org/current")).body.service_desk_project_id).toBeNull();
    });

    test("cancelled copies never sync again", async () => {
        expect((await submit()).status).toBe(201);
        await pool.query(`UPDATE tasks SET workflow_state_id =
            (SELECT id FROM workflow_states WHERE project_id = tasks.project_id AND key = 'cancelled')
            WHERE id = 1`);
        for (const status of ["in_progress", "resolved", "acknowledged", "closed", "open"]) {
            expect((await request(app).patch("/api/service-desk/tickets/1").send({ status })).status).toBe(200);
        }
        expect((await detail()).body.workflow_state_key).toBe("cancelled");
        expect((await request(app).get("/api/tasks/1/history")).body).toEqual([]);
    });

    test("a real database copy failure is logged and a cross-tenant submission still returns 201", async () => {
        await pool.query(`CREATE OR REPLACE FUNCTION reject_service_desk_copy() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'copy unavailable'; END $$;
            CREATE TRIGGER reject_service_desk_copy BEFORE INSERT ON tasks
            FOR EACH ROW EXECUTE FUNCTION reject_service_desk_copy()`);
        try {
            const response = await request(app).post("/api/service-desk/tickets").set("x-tenant", "7")
                .send({ title: "Customer issue", ticket_type: "bug" });
            expect(response.status).toBe(201);
            expect(response.body.tenant_id).toBe(7);
            expect(mockError).toHaveBeenCalledWith(
                expect.objectContaining({ err: expect.objectContaining({ message: "copy unavailable" }) }),
                "Failed to create backlog task for service desk ticket",
            );
            const ticket = await request(app).get(`/api/service-desk/tickets/${response.body.id}`).set("x-tenant", "7");
            expect(ticket.status).toBe(200);
        } finally {
            await pool.query("DROP TRIGGER reject_service_desk_copy ON tasks");
        }
    });
});
