export {};

// Suppress pino logs during tests
jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    },
    requestLogger: (req: any, _res: any, next: any) => { req.id = "test"; req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }; next(); },
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
}));

jest.mock("../utils/audit", () => ({
    logAction: jest.fn(),
    queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

jest.mock("../utils/taskNotifications", () => ({
    emitTaskUpdated: jest.fn(),
    notifyTaskAssigned: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");

const mockQuery: jest.Mock = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockTxClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
const mockTransaction: jest.Mock = jest.fn(async (fn: any) => {
    const callbacks: Array<() => unknown> = [];
    const result = await fn(mockTxClient, { afterCommit: (callback: () => unknown) => callbacks.push(callback) });
    for (const callback of callbacks) await callback();
    return result;
});

jest.mock("../db", () => ({
    pool: { end: jest.fn() },
    query: (...args: any[]) => mockQuery(...args),

    masterQuery: (...args: any[]) => mockQuery(...args),

    masterTransaction: (...args: any[]) => mockTransaction(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
    initDB: jest.fn(),
}));

const { app } = require("../index");
const { emitTaskUpdated } = require("../utils/taskNotifications");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

function setupAuth(role = "team_lead", extra: Record<string, any> = {}) {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth
        .mockResolvedValueOnce({
            rows: [{
                role, org_id: 1, team_id: 1, department_id: 1,
                manager_id: null, is_active: true, ...extra,
            }],
            rowCount: 1,
        }); // loadUserContext
}

describe("POST /api/sprints", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app)
            .post("/api/sprints")
            .set(CSRF)
            .send({ name: "Sprint 1", start_date: "2025-01-01", end_date: "2025-01-14" });
        expect(res.status).toBe(401);
    });

    test("returns 403 for non-team_lead role", async () => {
        setupAuth("employee");
        const res = await request(app)
            .post("/api/sprints")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ name: "Sprint 1", start_date: "2025-01-01", end_date: "2025-01-14" });
        expect(res.status).toBe(403);
    });

    test("returns 400 when name is missing", async () => {
        setupAuth("team_lead");
        const res = await request(app)
            .post("/api/sprints")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ start_date: "2025-01-01", end_date: "2025-01-14" });
        expect(res.status).toBe(400);
    });

    test("returns 400 for invalid date format", async () => {
        setupAuth("team_lead");
        const res = await request(app)
            .post("/api/sprints")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ name: "Sprint 1", start_date: "2025/01/01", end_date: "2025-01-14" });
        expect(res.status).toBe(400);
    });

    test("returns 400 for duplicate sprint name in team", async () => {
        setupAuth("team_lead");
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 5 }], rowCount: 1 }); // dup check
        const res = await request(app)
            .post("/api/sprints")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ name: "Sprint 1", start_date: "2025-01-01", end_date: "2025-01-14" });
        expect(res.status).toBe(400);
    });

    test("creates sprint with valid data", async () => {
        setupAuth("team_lead");
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // dup check — no dup
            .mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 }) // INSERT
            .mockResolvedValueOnce({
                rows: [{ id: 10, name: "Sprint 1", status: "planned", start_date: "2025-01-01", end_date: "2025-01-14", team_id: 1 }],
                rowCount: 1,
            }); // SELECT by id

        const res = await request(app)
            .post("/api/sprints")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ name: "Sprint 1", start_date: "2025-01-01", end_date: "2025-01-14" });
        expect(res.status).toBe(200);
    });
});

describe("GET /api/sprints", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/sprints");
        expect(res.status).toBe(401);
    });

    test("returns empty array when no team", async () => {
        // Auth passes but no team_id
        mockQuery
            .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 })
            .mockResolvedValueOnce({
                rows: [{ role: "employee", org_id: 1, team_id: null, department_id: null, manager_id: null, is_active: true }],
                rowCount: 1,
            });
        const res = await request(app)
            .get("/api/sprints")
            .set("Cookie", authCookie());
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ sprints: [] });
    });
});

describe("DELETE /api/sprints/:id", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => {
            const callbacks: Array<() => unknown> = [];
            const result = await fn(mockTxClient, { afterCommit: (callback: () => unknown) => callbacks.push(callback) });
            for (const callback of callbacks) await callback();
            return result;
        });
    });

    test("returns 403 for non-team_lead", async () => {
        setupAuth("employee");
        const res = await request(app)
            .delete("/api/sprints/1")
            .set(CSRF)
            .set("Cookie", authCookie());
        expect(res.status).toBe(403);
    });

    test("places sprint members and deletes the sprint on the transaction client", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 1, team_id: 1, status: "active", name: "Sprint 1" }],
            rowCount: 1,
        });
        const before = {
            id: 42,
            org_id: 1,
            team_id: 1,
            sprint_id: 1,
            planned_date: "2026-03-04",
            due_date: "2026-03-14",
            pre_sprint_due_date: "2026-02-20",
        };
        mockTxClient.query.mockImplementation(async (sql: string) => {
            const normalized = sql.replace(/\s+/g, " ").trim();
            if (normalized.startsWith("SELECT id, status FROM sprints WHERE id = $1 FOR UPDATE")) {
                return { rows: [{ id: 1, status: "active" }], rowCount: 1 };
            }
            if (normalized.startsWith("SELECT id FROM tasks WHERE sprint_id = $1")) {
                return { rows: [{ id: before.id }], rowCount: 1 };
            }
            if (normalized.startsWith("SELECT * FROM tasks WHERE id = ANY($1::int[])")) {
                return { rows: [before], rowCount: 1 };
            }
            if (normalized.startsWith("SELECT s.* FROM sprints s JOIN teams t ON t.id = s.team_id")) {
                return { rows: [{ id: 1, team_id: 1, status: "active", name: "Sprint 1" }], rowCount: 1 };
            }
            if (normalized.startsWith("UPDATE tasks SET sprint_id = NULL")) {
                return {
                    rows: [{ ...before, sprint_id: null, due_date: before.pre_sprint_due_date, pre_sprint_due_date: null }],
                    rowCount: 1,
                };
            }
            return { rows: [], rowCount: 1 };
        });

        const res = await request(app)
            .delete("/api/sprints/1")
            .set(CSRF)
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockTxClient.query.mock.calls.map(([sql]) => String(sql))).toContain("DELETE FROM sprints WHERE id = $1");
        expect(mockQuery.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM sprints"))).toBe(false);
        expect(mockTxClient.query.mock.calls.filter(([sql]) => String(sql).startsWith("INSERT INTO task_history"))).toHaveLength(2);
        expect(emitTaskUpdated).toHaveBeenCalledWith(
            null,
            42,
            "updated",
            expect.any(Array),
            expect.objectContaining({ fields: expect.objectContaining({ sprint_id: null, due_date: "2026-02-20" }) }),
        );
    });
});

describe("PUT /api/sprints/:id", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    /**
     * D11: a completed sprint is immutable. Re-opening it by writing
     * `status: "active"` would resurrect a closed sprint and let its finished
     * work be edited again, so the write is refused outright.
     */
    test("refuses to change a completed sprint", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 1, team_id: 1, status: "completed", name: "Sprint 1" }],
            rowCount: 1,
        });

        const res = await request(app)
            .put("/api/sprints/1")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ status: "active" });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_FROZEN");
    });

    test("still allows editing a planned sprint", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({
                rows: [{ id: 1, team_id: 1, status: "planned", name: "Sprint 1" }],
                rowCount: 1,
            })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({
                rows: [{ id: 1, team_id: 1, status: "planned", name: "Renamed" }],
                rowCount: 1,
            });

        const res = await request(app)
            .put("/api/sprints/1")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ name: "Renamed" });

        expect(res.status).toBe(200);
    });
});
describe("POST /api/sprints/:id/start", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    /**
     * One active sprint per team. Starting a second one used to silently
     * complete the running sprint, stranding its unfinished tickets without
     * the completion/rollover prompt. It is now refused.
     */
    test("refuses to start a sprint while the team already has an active one", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 2, team_id: 1, status: "planned", name: "Sprint 2" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 1, name: "Sprint 1" }], rowCount: 1 });

        const res = await request(app)
            .post("/api/sprints/2/start")
            .set(CSRF)
            .set("Cookie", authCookie());

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_ALREADY_ACTIVE");
        const sql = mockQuery.mock.calls.map((c: any[]) => String(c[0]));
        expect(sql.some((q) => /SET status = 'completed'/.test(q))).toBe(false);
        expect(sql.some((q) => /SET status = 'active'/.test(q))).toBe(false);
    });
});

describe("one active sprint per team on every activation path", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("PUT status=active is refused while another sprint runs", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 2, team_id: 1, status: "planned", name: "Sprint 2" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 1, name: "Sprint 1" }], rowCount: 1 });

        const res = await request(app)
            .put("/api/sprints/2")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ status: "active" });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_ALREADY_ACTIVE");
        expect(mockQuery.mock.calls.map((c: any[]) => String(c[0])).some((q) => /SET status = 'active'/.test(q))).toBe(false);
    });

    test("resume is refused while another sprint runs", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 2, team_id: 1, status: "paused", name: "Sprint 2", end_date: "2026-11-01" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 1, name: "Sprint 1" }], rowCount: 1 });

        const res = await request(app)
            .post("/api/sprints/2/resume")
            .set(CSRF)
            .set("Cookie", authCookie());

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SPRINT_ALREADY_ACTIVE");
        expect(mockQuery.mock.calls.map((c: any[]) => String(c[0])).some((q) => /SET status = 'active'/.test(q))).toBe(false);
    });
});
