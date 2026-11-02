export {};

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn() },
    requestLogger: (req: any, _res: any, next: any) => {
        req.id = "test";
        req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        next();
    },
}));

jest.mock("../utils/mailer", () => ({
    getTransporter: jest.fn(() => null),
    sendMail: jest.fn(),
    notifyByEmail: jest.fn(),
    esc: (s: any) => String(s ?? ""),
}));

jest.mock("../utils/ws", () => ({
    setupWebSocket: jest.fn(),
    sendToUser: jest.fn(),
    broadcast: jest.fn(),
    notifyUser: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../utils/audit", () => ({
    logAction: jest.fn(),
    queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

const mockPlaceTickets: jest.Mock = jest.fn();
jest.mock("../modules/tasks/tasks.placement", () => ({
    placeTickets: (...args: unknown[]) => mockPlaceTickets(...args),
}));

jest.mock("../modules/tasks/tasks.placementEffects", () => ({
    realtimeEffects: () => ({ changed: jest.fn() }),
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");

const mockQuery: jest.Mock = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockTxClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
const mockTransaction: jest.Mock = jest.fn(async (fn: any) => fn(mockTxClient, { afterCommit: jest.fn() }));

jest.mock("../db", () => ({
    pool: { end: jest.fn() },
    query: (...args: any[]) => mockQuery(...args),
    masterQuery: (...args: any[]) => mockQuery(...args),
    masterTransaction: (...args: any[]) => mockTransaction(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
}));

const { app } = require("../index");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };
const ticketA = {
    id: 10, title: "First", user_id: 1, assigned_to: null, org_id: 1, team_id: 1,
    sprint_id: null, planned_date: null, due_date: "2026-11-03",
};
const ticketB = {
    id: 11, title: "Second", user_id: 1, assigned_to: null, org_id: 1, team_id: 1,
    sprint_id: null, planned_date: null, due_date: null,
};

function authCookie() {
    const token = jwt.sign({ id: 1, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

function routeQueries(tasks: any[]) {
    mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
        if (/FROM app_settings/.test(sql)) return { rows: [{ value: "false" }], rowCount: 1 };
        if (/SELECT token_version FROM users/.test(sql)) return { rows: [{ token_version: 0 }], rowCount: 1 };
        if (/SELECT role, org_id, team_id/.test(sql)) {
            return {
                rows: [{ role: "employee", org_id: 1, team_id: 1, department_id: 1, manager_id: null, is_active: true }],
                rowCount: 1,
            };
        }
        if (/FROM tasks WHERE id = ANY/.test(sql)) {
            const wanted = (params?.[0] ?? []) as number[];
            const rows = tasks.filter((task) => wanted.includes(task.id));
            return { rows, rowCount: rows.length };
        }
        if (/FROM sprints s JOIN teams t/.test(sql)) {
            return { rows: [{ id: 50, team_id: 1, end_date: "2026-11-20", name: "Sprint 5" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    });
}

describe("POST /api/tasks/bulk move_to_sprint", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient, { afterCommit: jest.fn() }));
        mockPlaceTickets.mockReset();
    });

    test("places the batch once and maps skipped module results into per-ticket results", async () => {
        routeQueries([ticketA, ticketB]);
        mockPlaceTickets.mockResolvedValue([
            { id: 10, ok: true, task: { ...ticketA, sprint_id: 50, due_date: "2026-11-20" } },
            { id: 11, ok: false, code: "SPRINT_FROZEN", error: "This sprint is completed." },
        ]);

        const res = await request(app)
            .post("/api/tasks/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [10, 11], action: "move_to_sprint", value: 50 });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            requested: 2,
            changed: 1,
            failed: 1,
            results: [
                { id: 10, ok: true, previous: { sprint_id: null } },
                { id: 11, ok: false, code: "SPRINT_FROZEN", error: "This sprint is completed." },
            ],
        });
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockPlaceTickets).toHaveBeenCalledTimes(1);
        expect(mockPlaceTickets.mock.calls[0][0].db).toBe(mockTxClient);
        expect(mockPlaceTickets.mock.calls[0][1]).toEqual([10, 11]);
        expect(mockPlaceTickets.mock.calls[0][2]).toEqual({ sprint: 50 });
    });

    test("returns 500 when the placement transaction fails", async () => {
        routeQueries([ticketA, ticketB]);
        mockPlaceTickets.mockRejectedValue(new Error("database unavailable"));

        const res = await request(app)
            .post("/api/tasks/bulk")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ ids: [10, 11], action: "move_to_sprint", value: 50 });

        expect(res.status).toBe(500);
        expect(res.body).toEqual({ error: "Failed to apply bulk action" });
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockPlaceTickets).toHaveBeenCalledTimes(1);
    });
});
