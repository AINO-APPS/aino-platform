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
        }) // loadUserContext
        .mockResolvedValueOnce({ rows: [{ team_id: 1 }], rowCount: 1 }) // loadUserTeamIds
        .mockResolvedValueOnce({ rows: [{ project_ownership: false }], rowCount: 1 }); // loadProjectOwnership
}

describe("API sprint routes", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    describe("GET /api/sprints/:id/board", () => {
        const sprint = {
            id: 10, team_id: 1, project_id: 10, name: "Sprint 10", status: "active",
            start_date: "2026-11-01", end_date: "2026-11-14", org_id: 1,
            team_name: "Alpha",
        };
        const states = [
            { id: 101, key: "todo", name: "To Do", category: "open", sort_order: 1, is_active: true, is_initial: true, wip_limit: 2 },
            { id: 102, key: "progress", name: "In Progress", category: "in_progress", sort_order: 2, is_active: true, is_initial: false, wip_limit: null },
            { id: 103, key: "cancelled", name: "Cancelled", category: "done", sort_order: 3, is_active: true, is_initial: false, wip_limit: null },
        ];
        const tickets = [
            { id: 201, title: "First", user_id: 1, assigned_to: null, org_id: 1, team_id: 1, sprint_id: 10, workflow_state_id: 101 },
            { id: 202, title: "Second", user_id: 1, assigned_to: null, org_id: 1, team_id: 1, sprint_id: 10, workflow_state_id: 101 },
        ];
        const cancelledTicket = {
            id: 203, title: "Cancelled", user_id: 1, assigned_to: null,
            org_id: 1, team_id: 1, sprint_id: 10, workflow_state_id: 103,
        };

        function setupBoardReads(options: {
            wipEnabled?: boolean;
            sprint?: Record<string, any> | null;
            counts?: Array<{ state_id: number; count: string | number }>;
            boardTickets?: any[];
        } = {}) {
            mockQuery.mockReset();
            mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
            mockQuery.mockImplementation(async (query: string) => {
                const sql = String(query);
                if (/SELECT value FROM app_settings/.test(sql)) return { rows: [], rowCount: 0 };
                if (/SELECT token_version FROM users/.test(sql)) return { rows: [{ token_version: 0 }], rowCount: 1 };
                if (/SELECT role, org_id, team_id, department_id, manager_id, is_active FROM users/.test(sql)) {
                    return { rows: [{
                        role: "employee", org_id: 1, team_id: 1, department_id: 1,
                        manager_id: null, is_active: true,
                    }], rowCount: 1 };
                }
                if (/SELECT s\.\*, p\.org_id, t\.name AS team_name/.test(sql)) {
                    return { rows: options.sprint === undefined ? [sprint] : options.sprint ? [options.sprint] : [], rowCount: 1 };
                }
                if (/FROM workflow_states/.test(sql) && /ORDER BY sort_order/.test(sql)) {
                    return { rows: states, rowCount: states.length };
                }
                if (/FROM workflow_transitions/.test(sql)) {
                    return { rows: [{ from_state_id: 101, to_state_id: 102 }, { from_state_id: 101, to_state_id: 103 }], rowCount: 2 };
                }
                if (/SELECT enable_wip_limits FROM projects/.test(sql)) {
                    return { rows: [{ enable_wip_limits: options.wipEnabled ?? true }], rowCount: 1 };
                }
                if (/FROM tasks t/.test(sql) && /workflow_state_key/.test(sql)) {
                    const rows = options.boardTickets ?? tickets;
                    const boardRows = sql.includes("active.key = 'cancelled'")
                        ? rows.filter((ticket) => ticket.workflow_state_id !== 103)
                        : rows;
                    return { rows: boardRows, rowCount: boardRows.length };
                }
                if (/GROUP BY t\.workflow_state_id/.test(sql)) {
                    return { rows: options.counts ?? [{ state_id: 101, count: "2" }, { state_id: 102, count: "0" }], rowCount: 2 };
                }
                if (/SELECT s\.id, s\.team_id, s\.status, t\.org_id FROM sprints/.test(sql)) {
                    return { rows: [sprint], rowCount: 1 };
                }
                if (/FROM workflow_states/.test(sql)) return { rows: states, rowCount: states.length };
                if (/FROM users/.test(sql)) return { rows: [{ id: 1, team_id: 1 }], rowCount: 1 };
                if (/FROM sprints/.test(sql)) return { rows: [sprint], rowCount: 1 };
                return { rows: [], rowCount: 0 };
            });
        }

        test("returns ordered active columns, marks a full WIP column closed, and excludes Cancelled", async () => {
            setupBoardReads({
                counts: [{ state_id: 101, count: "2" }, { state_id: 102, count: "0" }, { state_id: 103, count: "1" }],
                boardTickets: [...tickets, cancelledTicket],
            });

            const res = await request(app).get("/api/sprints/10/board").set("Cookie", authCookie());

            expect(res.status).toBe(200);
            expect(res.body.sprint).toMatchObject({ id: 10, name: "Sprint 10", status: "active" });
            expect(res.body.columns).toEqual([
                { stateId: 101, count: 2, limit: 2, accepting: false },
                { stateId: 102, count: 0, limit: null, accepting: true },
            ]);
            expect(res.body.tickets.map((ticket: any) => ticket.id)).toEqual([201, 202]);
            expect(res.body.tickets.every((ticket: any) => ticket.container === "sprint" && ticket.capabilities)).toBe(true);
            expect(mockQuery.mock.calls.some(([sql]: any[]) =>
                String(sql).includes("active.key = 'cancelled'"))).toBe(true);
        });

        test("accepts tickets when project WIP limits are disabled, even at the configured limit", async () => {
            setupBoardReads({ wipEnabled: false });

            const res = await request(app).get("/api/sprints/10/board").set("Cookie", authCookie());

            expect(res.status).toBe(200);
            expect(res.body.columns[0]).toEqual({ stateId: 101, count: 2, limit: 2, accepting: true });
        });

        test.each([
            ["a sprint in another team", { ...sprint, team_id: 2 }, 403],
            ["a missing sprint", null, 404],
            ["a sprint outside the org", { ...sprint, team_id: 2, org_id: 2 }, 404],
        ])("preserves sprint access behavior for %s", async (_label, accessibleSprint, status) => {
            setupBoardReads({ sprint: accessibleSprint as any });

            const res = await request(app).get("/api/sprints/10/board").set("Cookie", authCookie());

            expect(res.status).toBe(status);
        });
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
            .mockResolvedValueOnce({ rows: [{ id: 20 }], rowCount: 1 }) // team's project
            .mockResolvedValueOnce({ rows: [{ id: 10 }], rowCount: 1 }) // INSERT
            .mockResolvedValueOnce({
                rows: [{ id: 10, project_id: 20, name: "Sprint 1", status: "planned", start_date: "2025-01-01", end_date: "2025-01-14", team_id: 1 }],
                rowCount: 1,
            }); // SELECT by id

        const res = await request(app)
            .post("/api/sprints")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ name: "Sprint 1", start_date: "2025-01-01", end_date: "2025-01-14" });
        expect(res.status).toBe(200);
        expect(res.body.sprint.project_id).toBe(20);
        expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO sprints \(team_id, project_id/.test(String(sql)))).toBe(true);
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
        expect(res.body).toEqual({ sprints: [], currentSprintId: null });
    });

    test.each([
        ["active takes precedence over paused", [
            { id: 21, status: "paused" },
            { id: 22, status: "active" },
        ], 22],
        ["a paused sprint is current when there is no active sprint", [
            { id: 23, status: "paused" },
        ], 23],
        ["planned and completed sprints are never current", [
            { id: 24, status: "planned" },
            { id: 25, status: "completed" },
        ], null],
    ])("%s", async (_description, sprints, currentSprintId) => {
        setupAuth("team_lead");
        mockQuery.mockResolvedValueOnce({ rows: sprints, rowCount: sprints.length });

        const res = await request(app)
            .get("/api/sprints")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.currentSprintId).toBe(currentSprintId);
        expect(res.body.sprints).toEqual(sprints);
    });

    test("an org admin gets the current sprint for the requested team", async () => {
        setupAuth("super_admin");
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 31, status: "paused", team_id: 7 }],
            rowCount: 1,
        });

        const res = await request(app)
            .get("/api/sprints?team_id=7")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.currentSprintId).toBe(31);
        expect(res.body.sprints).toEqual([{ id: 31, status: "paused", team_id: 7 }]);
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
            if (normalized.startsWith("SELECT t.id FROM tasks t")) {
                return { rows: [{ id: before.id }], rowCount: 1 };
            }
            if (normalized.startsWith("SELECT s.id, s.status FROM sprints s")) {
                return { rows: [{ id: 1, status: "active" }], rowCount: 1 };
            }
            if (normalized.startsWith("SELECT * FROM tasks WHERE id = ANY($1::int[])")) {
                return { rows: [before], rowCount: 1 };
            }
            if (normalized.startsWith("SELECT s.* FROM sprints s JOIN projects t ON t.id = s.project_id")) {
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
        expect(mockTxClient.query.mock.calls.some(([sql]) => String(sql).startsWith("DELETE FROM sprints s"))).toBe(true);
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
            .send({ status: "active", end_date: "2026-11-20" });

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
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ status: "planned" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await request(app)
            .put("/api/sprints/1")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ name: "Renamed" });

        expect(res.status).toBe(200);
    });
});

describe("sprint end-date edits", () => {
    const sprint = {
        id: 1,
        team_id: 1,
        status: "active",
        name: "Sprint 1",
        end_date: "2026-11-10",
        paused_at: "2026-11-01T12:00:00.000Z",
    };
    const tickets = [
        { id: 41, org_id: 1, team_id: 1, sprint_id: 1, due_date: "2026-11-10", planned_date: null, pre_sprint_due_date: null },
        { id: 42, org_id: 1, team_id: 1, sprint_id: 1, due_date: "2026-11-08", planned_date: null, pre_sprint_due_date: null },
    ];

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset();
        emitTaskUpdated.mockReset();
    });

    function setupCommittedTransaction() {
        let committed = false;
        mockTransaction.mockImplementation(async (fn: any) => {
            const callbacks: Array<() => unknown> = [];
            const result = await fn(mockTxClient, { afterCommit: (callback: () => unknown) => callbacks.push(callback) });
            committed = true;
            for (const callback of callbacks) await callback();
            return result;
        });
        emitTaskUpdated.mockImplementation(() => {
            expect(committed).toBe(true);
        });
    }

    function setupRetimeQueries(updatedSprint: Record<string, unknown>, newEnd: string) {
        const rows = tickets.map((ticket) => ({ ...ticket }));
        const history: unknown[][] = [];
        mockTxClient.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
            const normalized = sql.replace(/\s+/g, " ").trim();
            if (normalized.startsWith("SELECT s.status FROM sprints s")) {
                return { rows: [{ status: updatedSprint.status ?? "active" }], rowCount: 1 };
            }
            if (normalized.startsWith("SELECT t.* FROM tasks t")) {
                expect(normalized).toContain("t.due_date = $2");
                return {
                    rows: rows
                        .filter((ticket) => ticket.sprint_id === Number(params[0]) && ticket.due_date === params[1])
                        .map((ticket) => ({ ...ticket })),
                    rowCount: 1,
                };
            }
            if (normalized.startsWith("UPDATE tasks SET due_date = $1 WHERE id = $2 RETURNING *")) {
                const row = rows.find((ticket) => ticket.id === Number(params[1]))!;
                row.due_date = String(params[0]);
                return { rows: [{ ...row }], rowCount: 1 };
            }
            if (normalized.startsWith("INSERT INTO task_history")) {
                history.push(params);
                return { rows: [], rowCount: 1 };
            }
            if (normalized.startsWith("UPDATE sprints s SET")) {
                return { rows: [], rowCount: 1 };
            }
            if (normalized.startsWith("UPDATE teams SET sprint_paused")) {
                return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
        });
        return { rows, history, updatedSprint: { ...updatedSprint, end_date: newEnd } };
    }

    test("editing the end date does not change ticket due dates", async () => {
        setupAuth();
        setupCommittedTransaction();
        const { rows, history, updatedSprint } = setupRetimeQueries(sprint, "2026-11-12");
        mockQuery
            .mockResolvedValueOnce({ rows: [sprint], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [updatedSprint], rowCount: 1 });

        const res = await request(app)
            .put("/api/sprints/1")
            .set(CSRF)
            .set("Cookie", authCookie())
            .send({ end_date: "2026-11-12" });

        expect(res.status).toBe(200);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        const txSql = mockTxClient.query.mock.calls.map(([sql]) => String(sql).replace(/\s+/g, " ").trim());
        const gate = txSql.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
        const sprintRead = txSql.findIndex((sql) => sql.startsWith("SELECT s.status FROM sprints s"));
        const sprintUpdateIndex = txSql.findIndex((sql) => sql.startsWith("UPDATE sprints s SET"));
        expect(gate).toBeGreaterThanOrEqual(0);
        expect(gate).toBeLessThan(sprintRead);
        expect(sprintRead).toBeLessThan(sprintUpdateIndex);
        const sprintUpdate = ([sql]: unknown[]) => String(sql).replace(/\s+/g, " ").trim().startsWith("UPDATE sprints s SET");
        expect(mockTxClient.query.mock.calls.some(sprintUpdate)).toBe(true);
        expect(mockQuery.mock.calls.some(sprintUpdate)).toBe(false);
        expect(rows.map((ticket) => ticket.due_date)).toEqual(["2026-11-10", "2026-11-08"]);
        expect(history).toEqual([]);
        expect(emitTaskUpdated).not.toHaveBeenCalled();
    });

    test("resuming a sprint shifts its end without changing ticket due dates", async () => {
        setupAuth();
        setupCommittedTransaction();
        const resumedSprint = {
            ...sprint,
            status: "paused",
            paused_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        };
        const { rows, history, updatedSprint } = setupRetimeQueries(resumedSprint, "2026-11-13");
        mockQuery
            .mockResolvedValueOnce({ rows: [resumedSprint], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [updatedSprint], rowCount: 1 });

        const res = await request(app)
            .post("/api/sprints/1/resume")
            .set(CSRF)
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockTxClient.query.mock.calls.some(([sql]) => String(sql).replace(/\s+/g, " ").trim().startsWith("UPDATE sprints s SET status = 'active'"))).toBe(true);
        expect(rows[0].due_date).toBe("2026-11-10");
        expect(rows[1].due_date).toBe("2026-11-08");
        expect(history).toEqual([]);
        expect(emitTaskUpdated).not.toHaveBeenCalled();
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
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 2, team_id: 1, status: "planned", name: "Sprint 2" }], rowCount: 1 });
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ status: "planned" }], rowCount: 1 })
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
        expect(mockTxClient.query.mock.calls.some(([query]: any[]) => /SET status = 'active'/.test(String(query)))).toBe(false);
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

    test("cumulative flow resolves historical keys within each task's project", async () => {
        setupAuth("team_lead");
        const today = new Date().toISOString().slice(0, 10);
        mockQuery.mockImplementation(async (query: string) => {
            const sql = String(query);
            if (/SELECT token_version FROM users/.test(sql)) return { rows: [{ token_version: 0 }], rowCount: 1 };
            if (/SELECT role, org_id, team_id, department_id, manager_id, is_active FROM users/.test(sql)) {
                return { rows: [{
                    role: "team_lead", org_id: 1, team_id: 1, department_id: null,
                    manager_id: null, is_active: true,
                }], rowCount: 1 };
            }
            if (/SELECT s\.\*, p\.org_id, t\.name AS team_name/.test(sql)) {
                return { rows: [{
                    id: 10, team_id: 1, org_id: 1, status: "active",
                    start_date: today, end_date: today, completed_at: null,
                }], rowCount: 1 };
            }
            if (/FROM tasks t/.test(sql) && /current_key/.test(sql)) {
                return { rows: [{
                    id: 201, project_id: 101, created_at: `${today}T00:00:00.000Z`,
                    current_key: "shared",
                }], rowCount: 1 };
            }
            if (/SELECT project_id, key, category FROM workflow_states/.test(sql)) {
                return { rows: [
                    { project_id: 101, key: "shared", category: "done" },
                    { project_id: 102, key: "shared", category: "open" },
                ], rowCount: 2 };
            }
            return { rows: [], rowCount: 0 };
        });

        const res = await request(app)
            .get("/api/sprints/10/cumulative-flow")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.series).toEqual([
            { date: today, open: 0, in_progress: 0, in_review: 0, done: 1 },
        ]);
    });
});
