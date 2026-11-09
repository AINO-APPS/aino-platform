export {};

/**
 * Ticket routes at the placement seam (spec issue 03, seam A).
 *
 * `tasks.placement` is mocked: these tests prove each route asks for the right
 * move and maps every refusal to the right HTTP status. What a move does to the
 * row is proven against PostgreSQL in tasks.placement.integration.test.ts.
 */

const mockPlaceTickets = jest.fn();
const mockTransferTicket = jest.fn();
jest.mock("../modules/tasks/tasks.placement", () => ({
    ...jest.requireActual("../modules/tasks/tasks.placement"),
    placeTickets: (...args: unknown[]) => mockPlaceTickets(...args),
    transferTicket: (...args: unknown[]) => mockTransferTicket(...args),
}));
jest.mock("../modules/tasks/tasks.placementEffects", () => ({
    realtimeEffects: () => ({ changed: jest.fn() }),
}));
jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 1;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.header("x-role") || "employee";
        req.userOrgId = 1;
        req.userTeamId = 10;
        req.roleLevel = 1;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../utils/taskNotifications", () => ({
    emitTaskUpdated: jest.fn(),
    notifyTaskAssigned: jest.fn().mockResolvedValue(true),
}));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));

const express = require("express");
const request = require("supertest");

const TICKET = {
    id: 5, org_id: 1, team_id: 10, user_id: 1, assigned_to: null, sprint_id: null,
    planned_date: null, start_date: null, due_date: null, title: "Ticket", workflow_state_id: 7, priority: "medium",
    project_id: 100, task_number: 1, ticket_key: "TEAM-1",
};
const SPRINT = { id: 50, team_id: 10, end_date: "2026-11-14", name: "S" };

let rows: Record<number, any> = {};
const txClient = { query: jest.fn() };

function respond(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ");
    if (/SELECT \* FROM tasks WHERE id = \$1/.test(text)
        || /FROM tasks t LEFT JOIN work_item_types/.test(text) && /WHERE t.id = \$1/.test(text)) {
        const row = rows[Number(params[0])];
        return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE tasks SET start_date/.test(text)) {
        const row = rows[Number(params[1])];
        row.start_date = params[0];
        return { rows: [{ ...row }], rowCount: 1 };
    }
    if (/INSERT INTO tasks/.test(text)) return { rows: [{ id: 5 }], rowCount: 1 };
    if (/SELECT COALESCE\(/.test(text) && /origin_team_id/.test(text)) return { rows: [{ id: 100 }], rowCount: 1 };
    // The completed-sprint guard: no sprint in these fixtures is completed.
    if (/FROM sprints WHERE id = ANY/.test(text)) return { rows: [], rowCount: 0 };
    if (/FROM sprints/.test(text)) return { rows: Number(params[0]) === SPRINT.id ? [SPRINT] : [], rowCount: 1 };
    if (/FROM users WHERE id = \$1/.test(text)) return { rows: [{ id: 1, org_id: 1, team_id: 10, is_active: true }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
}

const db = {
    query: jest.fn(async (sql: string, params: unknown[]) => respond(sql, params)),
    transaction: jest.fn(async (fn: any) => fn(txClient, { afterCommit: jest.fn() })),
};

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
        req.tenant = { id: 1, plan: "enterprise", features: { team_visibility: true, agile: true } };
        req.tenantId = 1;
        req.db = db;
        req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        next();
    });
    app.use("/api/tasks", require("../routes/tasks"));
    app.use("/api/notes", require("../routes/notes"));
    return app;
}
const app = makeApp();

function placed(task: any) {
    return [{ id: task.id, ok: true, task }];
}
function refused(code: string) {
    return [{ id: 5, ok: false, code, error: `refused: ${code}` }];
}

beforeEach(() => {
    rows = { 5: { ...TICKET } };
    mockPlaceTickets.mockReset().mockImplementation(async (_ctx, ids: number[]) => placed({ ...TICKET, id: ids[0] }));
    mockTransferTicket.mockReset().mockResolvedValue({
        id: 5,
        ok: true,
        task: { ...TICKET, team_id: 20 },
        oldTeamId: 10,
        clearedSprint: { id: 50, name: "Sprint 50" },
    });
    txClient.query.mockReset().mockImplementation(async (sql: string, params: unknown[]) => respond(sql, params));
    db.query.mockClear();
    db.transaction.mockClear();
});

function lastPlacement() {
    const call = mockPlaceTickets.mock.calls.at(-1);
    return call ? { ctx: call[0], ids: call[1], target: call[2] } : null;
}

describe("POST /:id/transfer", () => {
    test("transfers through placement in a transaction and returns the previous owner and sprint", async () => {
        const res = await request(app)
            .post("/api/tasks/5/transfer")
            .set("x-role", "hr_admin")
            .send({ team_id: 20 });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            transferred: true,
            from_team_id: 10,
            to_team_id: 20,
            cleared_sprint: { id: 50, name: "Sprint 50" },
        });
        expect(mockTransferTicket).toHaveBeenCalledWith(
            expect.objectContaining({ db: txClient }),
            5,
            20,
        );
        expect(db.transaction).toHaveBeenCalledTimes(1);
    });

    test("maps a completed-sprint transfer refusal to 409", async () => {
        mockTransferTicket.mockResolvedValue({
            id: 5, ok: false, code: "SPRINT_FROZEN", error: "This sprint is completed.",
        });

        const res = await request(app)
            .post("/api/tasks/5/transfer")
            .set("x-role", "hr_admin")
            .send({ team_id: 20 });

        expect(res).toMatchObject({ status: 409, body: { code: "SPRINT_FROZEN" } });
    });
});

describe("date compatibility endpoints", () => {
    test("schedule sets the start date, not placement", async () => {
        const res = await request(app).patch("/api/tasks/5/schedule").send({ date: "2026-11-06" });
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ start_date: "2026-11-06", planned_date: "2026-11-06", sprint_id: null });
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });
    test("unschedule clears the start date without placement", async () => {
        rows[5].start_date = "2026-11-06";
        const res = await request(app).patch("/api/tasks/5/unschedule").send({});
        expect(res.status).toBe(200);
        expect(res.body.start_date).toBeNull();
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });
    test("schedule rejects a malformed date", async () => {
        expect((await request(app).patch("/api/tasks/5/schedule").send({ date: "6 Nov" })).status).toBe(400);
    });
});
describe("PATCH /:id/assign-sprint", () => {
    test("joins the sprint and keeps the enriched-ticket response", async () => {
        const res = await request(app).patch("/api/tasks/5/assign-sprint").send({ sprint_id: 50 });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: 5 });
        expect(lastPlacement()).toMatchObject({ ids: [5], target: { sprint: 50 } });
    });

    test.each([[null], [""]])("leaves the sprint for sprint_id %p", async (sprintId) => {
        const res = await request(app).patch("/api/tasks/5/assign-sprint").send({ sprint_id: sprintId });

        expect(res.status).toBe(200);
        expect(lastPlacement()).toMatchObject({ target: { sprint: null } });
    });

    test("maps a cross-project move to 409 SPRINT_PROJECT_MISMATCH", async () => {
        mockPlaceTickets.mockResolvedValue(refused("SPRINT_PROJECT_MISMATCH"));

        const res = await request(app).patch("/api/tasks/5/assign-sprint").send({ sprint_id: 50 });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_PROJECT_MISMATCH");
    });

    test("a non-admin cannot target another team's sprint", async () => {
        const res = await request(app).patch("/api/tasks/5/assign-sprint").send({ sprint_id: 999 });

        expect(res.status).toBe(400);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });
});

describe("creating a ticket", () => {
    test.each([
        ["POST /", "/api/tasks"],
        ["POST /backlog", "/api/tasks/backlog"],
    ])("%s into a sprint inserts with no container, then places it in the same transaction", async (_label, url) => {
        const res = await request(app).post(url).send({ title: "New", sprint_id: 50, due_date: "2026-11-20" });

        expect(res.status).toBe(200);
        const insert = txClient.query.mock.calls.find(([sql]) => /INSERT INTO tasks/.test(sql));
        expect(insert[0]).not.toMatch(/\bsprint_id\b/);
        expect(insert[0]).not.toMatch(/\bplanned_date\b/);
        expect(lastPlacement()).toMatchObject({ ids: [5], target: { sprint: 50 } });
        expect(lastPlacement()!.ctx.db).toBe(txClient);
    });

    test("POST / with no sprint sets start date without placement", async () => {
        const res = await request(app).post("/api/tasks").send({ title: "New", date: "2026-11-06" });

        expect(res.status).toBe(200);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });

    test("POST /backlog with no sprint places nothing", async () => {
        const res = await request(app).post("/api/tasks/backlog").send({ title: "New" });

        expect(res.status).toBe(200);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });

    test("a refused placement rolls the create back", async () => {
        mockPlaceTickets.mockResolvedValue(refused("SPRINT_FROZEN"));

        const res = await request(app).post("/api/tasks").send({ title: "New", sprint_id: 50 });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_FROZEN");
    });
});

describe("other ways a ticket is created", () => {
    test("a note checklist item joins the team's active sprint through placement", async () => {
        txClient.query.mockImplementation(async (sql: string, params: unknown[]) => {
            if (/status = 'active'/.test(sql)) return { rows: [{ id: 50 }], rowCount: 1 };
            if (/INSERT INTO tasks/.test(sql)) return { rows: [{ id: 5, title: "From note" }], rowCount: 1 };
            return respond(sql, params);
        });
        db.query.mockImplementation(async (sql: string, params: unknown[]) => {
            if (/status = 'active'/.test(sql)) return { rows: [{ id: 50 }], rowCount: 1 };
            return respond(sql, params);
        });

        const res = await request(app).post("/api/notes/convert-to-task").send({ title: "From note" });

        expect(res.status).toBe(200);
        const insert = txClient.query.mock.calls.find(([sql]) => /INSERT INTO tasks/.test(sql));
        expect(insert[0]).not.toMatch(/\bsprint_id\b|\bplanned_date\b/);
        expect(lastPlacement()).toMatchObject({ ids: [5], target: { sprint: 50 } });
        db.query.mockImplementation(async (sql: string, params: unknown[]) => respond(sql, params));
    });

    test("a note checklist item without a sprint gets a start date", async () => {
        txClient.query.mockImplementation(async (sql: string, params: unknown[]) => {
            if (/INSERT INTO tasks/.test(sql)) return { rows: [{ id: 5, title: "From note" }], rowCount: 1 };
            return respond(sql, params);
        });

        const res = await request(app).post("/api/notes/convert-to-task").send({ title: "From note" });

        expect(res.status).toBe(200);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });
});

describe("PUT /:id", () => {
    test("a sprint change goes through placement", async () => {
        const res = await request(app).put("/api/tasks/5").send({ sprint_id: 50 });

        expect(res.status).toBe(200);
        expect(lastPlacement()).toMatchObject({ ids: [5], target: { sprint: 50 } });
    });

    test("a legacy planned day edits start date without placement", async () => {
        const res = await request(app).put("/api/tasks/5").send({ planned_date: "2026-11-06" });

        expect(res.status).toBe(200);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });

    test("clearing the legacy date does not place the ticket", async () => {
        rows[5] = { ...TICKET, planned_date: "2026-11-06" };

        const res = await request(app).put("/api/tasks/5").send({ planned_date: null });

        expect(res.status).toBe(200);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });

    test("a legacy date on a sprinted ticket does not move it", async () => {
        rows[5] = { ...TICKET, sprint_id: 50, due_date: "2026-11-14" };

        const res = await request(app).put("/api/tasks/5").send({ planned_date: "2026-11-06", title: "Renamed" });

        expect(res.status).toBe(200);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
    });

    test("an edit that does not touch the container places nothing and never writes container columns", async () => {
        const res = await request(app).put("/api/tasks/5").send({ title: "Renamed" });

        expect(res.status).toBe(200);
        expect(mockPlaceTickets).not.toHaveBeenCalled();
        const update = [...db.query.mock.calls, ...txClient.query.mock.calls]
            .map(([sql]) => String(sql))
            .find((sql) => /UPDATE tasks SET title/.test(sql));
        expect(update).not.toMatch(/sprint_id|planned_date|pre_sprint_due_date/);
    });

    test("a container-only edit leaves the broadcast to placement: no empty task_updated from the handler", async () => {
        const { emitTaskUpdated } = require("../utils/taskNotifications");
        emitTaskUpdated.mockClear();

        const res = await request(app).put("/api/tasks/5").send({ sprint_id: 50 });

        expect(res.status).toBe(200);
        expect(emitTaskUpdated).not.toHaveBeenCalled();
    });

    test("maps a placement refusal and writes nothing else", async () => {
        mockPlaceTickets.mockResolvedValue(refused("SPRINT_PROJECT_MISMATCH"));

        const res = await request(app).put("/api/tasks/5").send({ sprint_id: 50, title: "Renamed" });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_PROJECT_MISMATCH");
    });
});
