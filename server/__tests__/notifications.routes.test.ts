export {};

// Tests for /api/notifications — GET, POST /read-all, POST /:id/read, DELETE /:id

jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    },
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
}));

jest.mock("../utils/audit", () => ({
    logAction: jest.fn(),
    queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");

const mockQuery: jest.Mock = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });

jest.mock("../db", () => ({
    pool: { end: jest.fn() },
    query: (...args: any[]) => mockQuery(...args),

    masterQuery: (...args: any[]) => mockQuery(...args),

    masterTransaction: (fn: any) => fn({ query: (...a: any[]) => mockQuery(...a) }),
    transaction: jest.fn(async (fn: any) => fn({ query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) })),
    initDB: jest.fn(),
}));

const { app } = require("../index");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

// notifications.js uses auth + loadUserContext
function setupAuth(role = "employee") {
    mockQuery
        .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ role, org_id: 1, team_id: 1, department_id: 1, manager_id: null, is_active: true }], rowCount: 1 });
}

// ─── GET /api/notifications ────────────────────────────────────────────────

describe("GET /api/notifications", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/notifications");
        expect(res.status).toBe(401);
    });

    test("returns empty notifications list", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 }) // total count
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // notifications query
            .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 }); // unread count

        const res = await request(app)
            .get("/api/notifications")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.notifications).toEqual([]);
        expect(res.body.unread).toBe(0);
    });

    test("returns notifications with correct unread count", async () => {
        setupAuth();
        const rows = [
            { id: 1, title: "Task assigned", body: "Fix bug", is_read: false, created_at: "2024-01-01T10:00:00Z", task_title: "Fix bug" },
            { id: 2, title: "Leave approved", body: null, is_read: true, created_at: "2024-01-01T09:00:00Z", task_title: null },
            { id: 3, title: "Sprint started", body: null, is_read: false, created_at: "2024-01-01T08:00:00Z", task_title: null },
        ];
        mockQuery
            .mockResolvedValueOnce({ rows: [{ count: "3" }], rowCount: 1 }) // total count
            .mockResolvedValueOnce({ rows, rowCount: 3 }) // notifications query
            .mockResolvedValueOnce({ rows: [{ count: "2" }], rowCount: 1 }); // unread count

        const res = await request(app)
            .get("/api/notifications")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.notifications).toHaveLength(3);
        expect(res.body.unread).toBe(2);
    });

    test("applies and clamps pagination", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ count: "125" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [{ count: "0" }], rowCount: 1 });

        const res = await request(app)
            .get("/api/notifications?page=-2&per_page=500")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ total: 125, page: 1, perPage: 100 });
        const listCall = mockQuery.mock.calls.find(([sql]: any[]) => typeof sql === "string" && sql.includes("FROM notifications n"));
        expect(listCall[1]).toEqual([1, 100, 0]);
    });
});

describe("GET /api/notifications/metrics", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns aggregated notification routing metrics", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [{
                total_notifications: 12,
                routing_attempts: 10,
                successful_routes: 9,
                failed_routes: 1,
                deduplicated_count: 3,
                validation_failures: 1,
                delivery_failures: 0,
                delivered_count: 12,
                displayed_count: 11,
                tapped_count: 10,
                route_persisted_count: 10,
                route_consumed_count: 9,
                last_event_at: "2026-07-01T08:00:00.000Z",
                average_latency_ms: 720.5,
                p50_latency_ms: 650,
                p95_latency_ms: 1400,
            }],
            rowCount: 1,
        });

        const res = await request(app)
            .get("/api/notifications/metrics?hours=24")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.windowHours).toBe(24);
        expect(res.body.successRate).toBe(90);
        expect(res.body.counts.routingAttempts).toBe(10);
        expect(res.body.counts.successfulRoutes).toBe(9);
        expect(res.body.latency.p95Ms).toBe(1400);
    });

    test("clamps the metrics window to seven days", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{}], rowCount: 1 });

        const res = await request(app)
            .get("/api/notifications/metrics?hours=999")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.windowHours).toBe(168);
        const metricsCall = mockQuery.mock.calls.find(([sql]: any[]) => typeof sql === "string" && sql.includes("WITH recent AS"));
        expect(metricsCall[1]).toEqual([168]);
    });
});

describe("POST /api/notifications/metrics/events", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
    });

    test("rejects an empty events array", async () => {
        setupAuth();
        const res = await request(app)
            .post("/api/notifications/metrics/events")
            .set("Cookie", authCookie())
            .set(CSRF)
            .send({ events: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/non-empty array/i);
    });

    test("rejects more than 200 metric events", async () => {
        setupAuth();
        const events = Array.from({ length: 201 }, (_, index) => ({
            clientEventId: `evt_${index}`,
            timestamp: Date.now(),
            event: "displayed",
        }));
        const res = await request(app)
            .post("/api/notifications/metrics/events")
            .set("Cookie", authCookie())
            .set(CSRF)
            .send({ events });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/max 200/i);
    });

    test("reports duplicate metric events without failing the batch", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const res = await request(app)
            .post("/api/notifications/metrics/events")
            .set("Cookie", authCookie())
            .set(CSRF)
            .send({ events: [
                { clientEventId: "evt_new", timestamp: Date.now(), event: "displayed" },
                { clientEventId: "evt_duplicate", timestamp: Date.now(), event: "displayed" },
            ] });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, accepted: 2, inserted: 1, duplicates: 1 });
    });

    test("ingests notification metric events", async () => {
        setupAuth();
        const res = await request(app)
            .post("/api/notifications/metrics/events")
            .set("Cookie", authCookie())
            .set(CSRF)
            .send({
                events: [
                    {
                        clientEventId: "evt_1",
                        timestamp: Date.now(),
                        level: "INFO",
                        event: "state_transition_route_consumed",
                        dedupeKey: "msg:123",
                        conversationId: "42",
                        messageId: "123",
                        notificationType: "message",
                        state: "route_consumed",
                        durationMs: 820,
                        source: "app.index",
                        metadata: { path: "/(tabs)/chat" },
                    },
                ],
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.accepted).toBe(1);
        expect(res.body.inserted).toBe(1);
        const insertCall = mockQuery.mock.calls.find((c: any[]) =>
            c[0] && typeof c[0] === "string" && c[0].includes("INSERT INTO notification_metric_events"),
        );
        expect(insertCall).toBeDefined();
        expect(insertCall[1][0]).toBe("evt_1");
        expect(insertCall[1][1]).toBe(1);
    });
});

// ─── POST /api/notifications/read-all ─────────────────────────────────────

describe("POST /api/notifications/read-all", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app)
            .post("/api/notifications/read-all")
            .set(CSRF);
        expect(res.status).toBe(401);
    });

    test("marks all notifications as read", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 5 }); // UPDATE

        const res = await request(app)
            .post("/api/notifications/read-all")
            .set("Cookie", authCookie())
            .set(CSRF);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
    });
});

// ─── POST /api/notifications/:id/read ────────────────────────────────────

describe("POST /api/notifications/:id/read", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app)
            .post("/api/notifications/5/read")
            .set(CSRF);
        expect(res.status).toBe(401);
    });

    test("marks a single notification as read", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE

        const res = await request(app)
            .post("/api/notifications/5/read")
            .set("Cookie", authCookie())
            .set(CSRF);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        // Verify the query was called with the correct notification id and user id
        const updateCall = mockQuery.mock.calls.find((c: any[]) => c[0] && typeof c[0] === "string" && c[0].includes("UPDATE notifications"));
        expect(updateCall).toBeDefined();
        // ID from URL params is parsed to integer
        expect(updateCall[1][0]).toBe(5);
        expect(updateCall[1][1]).toBe(1); // userId
    });

    test("rejects a non-numeric notification ID", async () => {
        setupAuth();
        const res = await request(app)
            .post("/api/notifications/not-a-number/read")
            .set("Cookie", authCookie())
            .set(CSRF);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Invalid notification ID" });
    });
});

// ─── DELETE /api/notifications/:id ────────────────────────────────────────

describe("DELETE /api/notifications/:id", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app)
            .delete("/api/notifications/5")
            .set(CSRF);
        expect(res.status).toBe(401);
    });

    test("deletes a notification", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE

        const res = await request(app)
            .delete("/api/notifications/5")
            .set("Cookie", authCookie())
            .set(CSRF);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        const deleteCall = mockQuery.mock.calls.find((c: any[]) => c[0] && typeof c[0] === "string" && c[0].includes("DELETE FROM notifications"));
        expect(deleteCall).toBeDefined();
        expect(deleteCall[1][0]).toBe(5);
        expect(deleteCall[1][1]).toBe(1); // userId
    });

    test("rejects a non-numeric notification ID", async () => {
        setupAuth();
        const res = await request(app)
            .delete("/api/notifications/not-a-number")
            .set("Cookie", authCookie())
            .set(CSRF);

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Invalid notification ID" });
    });
});

describe("GET /api/notifications/announcements", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns active announcements for the requester organization", async () => {
        setupAuth();
        const rows = [{ id: 4, message: "Maintenance", type: "info", created_at: "2026-09-06T10:00:00.000Z", author: null }];
        mockQuery.mockResolvedValueOnce({ rows, rowCount: 1 });

        const res = await request(app)
            .get("/api/notifications/announcements")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: [{
            ...rows[0], id: "tenant:4", source_id: 4, scope: "tenant",
        }] });
        const announcementCall = mockQuery.mock.calls.find(([sql]: any[]) => typeof sql === "string" && sql.includes("FROM announcements a"));
        expect(announcementCall[1]).toEqual([1]);
    });

    test("merges master global announcements into the tenant feed", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 4, message: "Tenant", type: "info", created_at: "2026-09-06T10:00:00.000Z", author: null }] })
            .mockResolvedValueOnce({ rows: [{ id: 8, message: "Global", type: "urgent", created_at: "2026-09-07T10:00:00.000Z", created_by_name: "Owner" }] });

        const res = await request(app)
            .get("/api/notifications/announcements")
            .set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([
            expect.objectContaining({ id: "platform:8", source_id: 8, scope: "platform", message: "Global", author: "Owner" }),
            expect.objectContaining({ id: "tenant:4", source_id: 4, scope: "tenant", message: "Tenant" }),
        ]);
    });
});