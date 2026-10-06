export {};

// Tests for /api/chat — search, conversations, messages

jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        fatal: jest.fn(),
        debug: jest.fn(),
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

// The caller-cancel logic itself is covered in ws.callRinging.test.ts; here we
// only pin the HTTP adapter's delegation.
jest.mock("../utils/wsHandlers/callRinging", () => ({
    ...jest.requireActual("../utils/wsHandlers/callRinging"),
    cancelRingingCall: jest.fn().mockResolvedValue({ callId: 600 }),
}));

jest.mock("../utils/audit", () => ({
    logAction: jest.fn(),
    queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }),
}));

// Force loadUserContext down its deterministic DB path: with the user-context
// cache always missing, every request runs the same `SELECT … is_active FROM
// users` lookup, so the per-test mockQuery chains stay stable (otherwise the
// first group test would warm the cache and the second would skip the user
// lookup, shifting its mock sequence).
jest.mock("../redis", () => {
    const actual = jest.requireActual("../redis");
    return {
        ...actual,
        // Always miss the user-context cache so loadUserContext runs its DB
        // lookup deterministically in every request.
        getUserContext: jest.fn().mockResolvedValue(null),
        setUserContext: jest.fn().mockResolvedValue(undefined),
    };
});

const jwt = require("jsonwebtoken");
const request = require("supertest");

const mockQuery: jest.Mock = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockTxClient = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
const mockTransaction: jest.Mock = jest.fn(async (fn: any) => fn(mockTxClient));

jest.mock("../db", () => ({
    pool: { end: jest.fn() },
    query: (...args: any[]) => mockQuery(...args),

    masterQuery: (...args: any[]) => mockQuery(...args),

    masterTransaction: (...args: any[]) => mockTransaction(...args),
    transaction: (...args: any[]) => mockTransaction(...args),
    initDB: jest.fn(),
}));

const { app } = require("../index");
const redis = require("../redis");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "WorkPulse" };

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

// chat.js uses only `auth` (not loadUserContext)
function setupAuth() {
    mockQuery.mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 });
}

// ─── GET /uploads/.../chat/... ─────────────────────────────────────────────

describe("GET chat attachment", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("denies an authenticated non-participant before static file serving", async () => {
        setupAuth();
        // Participant-authorized attachment lookup returns no matching row.
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .get("/uploads/org_1/chat/private-file.png")
            .set("Cookie", authCookie(3));

        expect(res.status).toBe(403);
        expect(res.body.error).toBe("Forbidden");
        const authorizationCall = mockQuery.mock.calls.find(
            ([sql]: any[]) =>
                typeof sql === "string" &&
                sql.includes("JOIN conversation_participants cp") &&
                sql.includes("m.file_url = $2"),
        );
        expect(authorizationCall).toBeTruthy();
        expect(authorizationCall[1]).toEqual([
            3,
            "/uploads/org_1/chat/private-file.png",
        ]);
    });
});

// ─── GET /api/chat/search ─────────────────────────────────────────────────

describe("GET /api/chat/search", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/chat/search?q=alice");
        expect(res.status).toBe(401);
    });

    test("returns empty array for query shorter than 2 chars", async () => {
        setupAuth();

        const res = await request(app).get("/api/chat/search?q=a").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("returns empty array when user has no org", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ org_id: null }], rowCount: 1 }); // getUserOrg

        const res = await request(app).get("/api/chat/search?q=alice").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    test("returns matching users in same org", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ org_id: 1 }], rowCount: 1 }); // getUserOrg
        const users = [
            {
                id: 2,
                username: "alice",
                full_name: "Alice Smith",
                email: "alice@test.com",
                avatar: null,
                last_seen_at: null,
            },
        ];
        mockQuery.mockResolvedValueOnce({ rows: users, rowCount: 1 });

        const res = await request(app).get("/api/chat/search?q=alice").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].username).toBe("alice");
    });
});

// ─── GET /api/chat/presence ───────────────────────────────────────────────

describe("GET /api/chat/presence", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/chat/presence?userIds=2,3");
        expect(res.status).toBe(401);
    });

    test("returns empty object when userIds is missing", async () => {
        setupAuth();

        const res = await request(app).get("/api/chat/presence").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toEqual({});
    });

    test("returns presence statuses for users in same org", async () => {
        // PR7: /api/chat/presence is now a thin alias over StatusService.
        // The test feeds the repository fixtures the service needs:
        //   1) getUserOrg (route)
        //   2) org-membership filter (route)
        //   3) repo.getUserPrefsBulk
        //   4) repo.getOpenSessionsBulk
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ org_id: 1 }], rowCount: 1 }); // getUserOrg
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 2 }, { id: 3 }],
            rowCount: 2,
        }); // org members filter
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 2,
                    manual_status: null,
                    presence_preference: "auto",
                    status_message: null,
                    status_message_expires_at: null,
                    last_activity_at: new Date(),
                },
                {
                    id: 3,
                    manual_status: null,
                    presence_preference: "auto",
                    status_message: null,
                    status_message_expires_at: null,
                    last_activity_at: new Date(),
                },
            ],
            rowCount: 2,
        }); // getUserPrefsBulk
        const recent = new Date(Date.now() - 60 * 1000); // 1 min ago = online
        mockQuery.mockResolvedValueOnce({
            rows: [
                // Only user 2 has an open session → online
                {
                    user_id: 2,
                    session_key: "s2",
                    device_label: null,
                    connected_at: recent,
                    last_seen_at: recent,
                    disconnected_at: null,
                    activity: null,
                    activity_ref_id: null,
                },
            ],
            rowCount: 1,
        }); // getOpenSessionsBulk

        const res = await request(app).get("/api/chat/presence?userIds=2,3").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body[2].presence).toBe("online");
        expect(res.body[3].presence).toBe("offline");
        expect(res.body[3].userStatus).toBe("offline");
    });

    test("returns work mode from today's clock-in (office/remote)", async () => {
        // Mirrors the presence fixture chain, then adds the 5th query the route
        // now makes for the office/remote badge: today's time_entries per user.
        //   1) getUserOrg  2) org members  3) getUserPrefsBulk
        //   4) getOpenSessionsBulk  5) time_entries (work-mode lookup)
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ org_id: 1 }], rowCount: 1 }); // getUserOrg
        mockQuery.mockResolvedValueOnce({
            rows: [{ id: 2 }, { id: 3 }],
            rowCount: 2,
        }); // org members filter
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 2,
                    manual_status: null,
                    presence_preference: "auto",
                    status_message: null,
                    status_message_expires_at: null,
                    last_activity_at: new Date(),
                },
                {
                    id: 3,
                    manual_status: null,
                    presence_preference: "auto",
                    status_message: null,
                    status_message_expires_at: null,
                    last_activity_at: new Date(),
                },
            ],
            rowCount: 2,
        }); // getUserPrefsBulk
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // getOpenSessionsBulk
        // time_entries: user 2 clocked in (office, still on floor); user 3 clocked
        // out → logged out → no work mode.
        mockQuery.mockResolvedValueOnce({
            rows: [
                { user_id: 2, entry_type: "clock_in", work_mode: "office" },
                { user_id: 3, entry_type: "clock_in", work_mode: "remote" },
                { user_id: 3, entry_type: "clock_out", work_mode: null },
            ],
            rowCount: 3,
        }); // time_entries work-mode lookup

        const res = await request(app).get("/api/chat/presence?userIds=2,3").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        // User 2 is still clocked in from the office → "office".
        expect(res.body[2].workMode).toBe("office");
        // User 3 clocked out → logged out → no work mode surfaced.
        expect(res.body[3].workMode).toBeNull();
    });
});

// ─── GET /api/chat/conversations ───────────────────────────────────────────

describe("GET /api/chat/conversations", () => {
    let unreadCountsSpy: jest.SpyInstance;

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        unreadCountsSpy = jest.spyOn(redis, "getUnreadCounts").mockResolvedValue(null);
    });

    afterEach(() => {
        unreadCountsSpy.mockRestore();
    });

    test("returns group_member_avatars for group conversations", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 10,
                    is_group: true,
                    group_name: "Team Alpha",
                    group_avatar: null,
                    unread_count: 2,
                    group_member_avatars: ["/uploads/a.png", "/uploads/b.png", "/uploads/c.png"],
                },
            ],
            rowCount: 1,
        });
        const res = await request(app).get("/api/chat/conversations").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].is_group).toBe(true);
        expect(res.body[0].group_member_avatars).toEqual([
            "/uploads/a.png",
            "/uploads/b.png",
            "/uploads/c.png",
        ]);
        const sqls = mockQuery.mock.calls
            .map((c: any[]) => c[0])
            .filter((q: unknown): q is string => typeof q === "string");
        expect(sqls.some((q: string) => q.includes("ORDER BY cp3.user_id ASC"))).toBe(true);
        expect(sqls.some((q: string) => q.includes("ORDER BY cp3.id ASC"))).toBe(false);
    });

    test("overlays redis unread counts without altering group avatars", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 11,
                    is_group: true,
                    group_name: "Ops",
                    group_avatar: null,
                    unread_count: 1,
                    group_member_avatars: ["/uploads/o1.png", "/uploads/o2.png"],
                },
            ],
            rowCount: 1,
        });
        unreadCountsSpy.mockResolvedValueOnce({ 11: 7 });

        const res = await request(app).get("/api/chat/conversations").set("Cookie", authCookie());

        expect(res.status).toBe(200);
        expect(res.body[0].unread_count).toBe(7);
        expect(res.body[0].group_member_avatars).toEqual([
            "/uploads/o1.png",
            "/uploads/o2.png",
        ]);
    });
});

// ─── POST /api/chat/conversations ────────────────────────────────────────

describe("POST /api/chat/conversations", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).post("/api/chat/conversations").set(CSRF).send({ userId: 2 });
        expect(res.status).toBe(401);
    });

    test("creates self-chat conversation when userId is self", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, org_id: 1 }], rowCount: 1 }); // self user lookup
        // Existence check now inside transaction
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no existing self-conversation (FOR UPDATE)
            .mockResolvedValueOnce({ rows: [{ id: 50 }], rowCount: 1 }) // INSERT conversation
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT participant

        const res = await request(app)
            .post("/api/chat/conversations")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ userId: 1 });

        expect(res.status).toBe(201);
        expect(res.body.conversationId).toBe(50);
    });

    test("returns existing self-chat if already exists", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, org_id: 1 }], rowCount: 1 }); // self user lookup
        // Existence check now inside transaction
        mockTxClient.query.mockResolvedValueOnce({ rows: [{ conversation_id: 99 }], rowCount: 1 }); // existing self-conv (FOR UPDATE)

        const res = await request(app)
            .post("/api/chat/conversations")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ userId: 1 });

        expect(res.status).toBe(200);
        expect(res.body.conversationId).toBe(99);
    });

    test("returns 400 when one user not found", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, org_id: 1 }], rowCount: 1 }); // only 1 user found

        const res = await request(app)
            .post("/api/chat/conversations")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ userId: 999 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/not found/i);
    });

    test("returns 403 when users are in different orgs", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [
                { id: 1, org_id: 1 },
                { id: 2, org_id: 2 }, // different org
            ],
            rowCount: 2,
        });

        const res = await request(app)
            .post("/api/chat/conversations")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ userId: 2 });

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/same organization/i);
    });

    test("returns existing conversation id when direct chat already exists", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, org_id: 1 }, { id: 2, org_id: 1 }], rowCount: 2 }); // users found
        // Existence check now inside transaction
        mockTxClient.query.mockResolvedValueOnce({ rows: [{ conversation_id: 42 }], rowCount: 1 }); // existing conv (FOR UPDATE)

        const res = await request(app)
            .post("/api/chat/conversations")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ userId: 2 });

        expect(res.status).toBe(200);
        expect(res.body.conversationId).toBe(42);
    });

    test("creates a new conversation when none exists", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, org_id: 1 }, { id: 2, org_id: 1 }], rowCount: 2 }); // users found
        // Existence check now inside transaction
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // no existing conv (FOR UPDATE)
            .mockResolvedValueOnce({ rows: [{ id: 55 }], rowCount: 1 }) // INSERT conversation
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT participants

        const res = await request(app)
            .post("/api/chat/conversations")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ userId: 2 });

        expect(res.status).toBe(201);
        expect(res.body.conversationId).toBe(55);
    });
});

// ─── POST /api/chat/conversations/group ──────────────────────────────────

describe("POST /api/chat/conversations/group", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("returns 401 without auth", async () => {
        const res = await request(app)
            .post("/api/chat/conversations/group")
            .set(CSRF)
            .send({ name: "Dev Team", userIds: [2, 3] });
        expect(res.status).toBe(401);
    });

    test("returns 400 when group name is missing", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ org_id: 1 }], rowCount: 1 }); // getUserOrg

        const res = await request(app)
            .post("/api/chat/conversations/group")
            .set("Cookie", authCookie())
            .set(CSRF)
            .send({ userIds: [2, 3] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/name is required/i);
    });

    test("returns 400 when no additional users provided", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ org_id: 1 }], rowCount: 1 }); // getUserOrg

        const res = await request(app)
            .post("/api/chat/conversations/group")
            .set("Cookie", authCookie())
            .set(CSRF)
            .send({ name: "Team", userIds: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/at least one/i);
    });

    test("creates a group conversation successfully", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ org_id: 1 }], rowCount: 1 }); // getUserOrg
        // all users in same org
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }, { id: 3 }], rowCount: 3 });
        mockTxClient.query
            .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 }) // INSERT conversation
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT participants

        const res = await request(app)
            .post("/api/chat/conversations/group")
            .set("Cookie", authCookie())
            .set(CSRF)
            .send({ name: "Dev Team", userIds: [2, 3] });

        expect(res.status).toBe(201);
        expect(res.body.conversationId).toBe(99);
    });
});

describe("PUT /api/chat/conversations/:id/group", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 403 when requester is not a participant", async () => {
        setupAuth();
        mockQuery
            // loadUserContext: active user (role employee → level 1, no extra
            // tenant_roles query).
            .mockResolvedValueOnce({
                rows: [{ role: "employee", org_id: 1, is_active: true }],
                rowCount: 1,
            })
            // route conversation lookup
            .mockResolvedValueOnce({ rows: [{ id: 10, is_group: true, org_id: 1 }], rowCount: 1 })
            // loadGroupContext: conversation policy row
            .mockResolvedValueOnce({
                rows: [{ is_group: true, created_by: 1, post_policy: "all", add_policy: "admins" }],
                rowCount: 1,
            })
            // loadGroupContext: caller's role — none (not a participant)
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .put("/api/chat/conversations/10/group")
            .set(CSRF)
            .set("Cookie", authCookie(1))
            .send({ removeUserIds: [2] });

        expect(res.status).toBe(403);
    });

    test("removes only users validated in the same org", async () => {
        setupAuth();
        mockQuery
            // 1) loadUserContext: active user (employee → level 1)
            .mockResolvedValueOnce({
                rows: [{ role: "employee", org_id: 1, is_active: true }],
                rowCount: 1,
            })
            // 2) route conversation lookup (SELECT * FROM conversations …)
            .mockResolvedValueOnce({ rows: [{ id: 10, is_group: true, org_id: 1 }], rowCount: 1 })
            // 3) loadGroupContext: conversation policy row
            .mockResolvedValueOnce({
                rows: [{ is_group: true, created_by: 1, post_policy: "all", add_policy: "admins" }],
                rowCount: 1,
            })
            // 4) loadGroupContext: caller's role. Phase 1 RBAC — removing
            //    members is admin-class, so the caller must be owner/admin.
            .mockResolvedValueOnce({ rows: [{ role: "owner" }], rowCount: 1 })
            // 5) actor full_name lookup (for the activity system message)
            .mockResolvedValueOnce({ rows: [{ full_name: "Owner" }], rowCount: 1 })
            // 6) validate removable users in the same org (returns row + role)
            .mockResolvedValueOnce({ rows: [{ id: 2, full_name: "Bob", role: "member" }], rowCount: 1 })
            // 7) DELETE participant
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await request(app)
            .put("/api/chat/conversations/10/group")
            .set(CSRF)
            .set("Cookie", authCookie(1))
            .send({ removeUserIds: [2, 999] });

        expect(res.status).toBe(200);

        // The remove-validation query selects the member's role too so the
        // route can refuse to let an admin remove the owner (Phase 1 RBAC).
        const validateCall = mockQuery.mock.calls.find(
            ([sql]: any[]) =>
                typeof sql === "string" &&
                sql.includes("SELECT u.id, u.full_name, cp.role FROM users u")
        );
        expect(validateCall).toBeTruthy();
        expect(validateCall[1][0]).toEqual([2, 999]);
        expect(validateCall[1][1]).toBe(1);
        expect(validateCall[1][2]).toBe(10);

        const deleteCalls = mockQuery.mock.calls.filter(
            ([sql]: any[]) =>
                typeof sql === "string" &&
                sql.includes(
                    "DELETE FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2"
                )
        );
        expect(deleteCalls).toHaveLength(1);
        expect(deleteCalls[0][1]).toEqual([10, 2]);
    });
});

describe("POST /api/chat/conversations/:id/messages", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("rejects a reply target from another conversation before insertion", async () => {
        setupAuth();
        mockQuery
            // Sender participates in destination conversation.
            .mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 })
            // Group avoids unrelated direct-chat block enforcement.
            .mockResolvedValueOnce({
                rows: [{ is_group: true, group_name: "Team" }],
                rowCount: 1,
            })
            // Reply message is not in the destination conversation.
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post("/api/chat/conversations/10/messages")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ content: "Reply attempt", replyToId: 999 });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/reply target/i);
        expect(
            mockQuery.mock.calls.some(
                ([sql]: any[]) =>
                    typeof sql === "string" &&
                    sql.includes("INSERT INTO messages (conversation_id, sender_id, content, reply_to_id)"),
            ),
        ).toBe(false);
    });

    test("replays a client message id without duplicate fan-out side effects", async () => {
        setupAuth();
        const createdAt = new Date().toISOString();
        mockQuery
            .mockResolvedValueOnce({ rows: [{ ok: 1 }], rowCount: 1 }) // participant
            .mockResolvedValueOnce({ rows: [{ is_group: true, group_name: "Team" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 77, created_at: createdAt, inserted: false }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ full_name: "Sender", avatar: null, username: "sender" }], rowCount: 1 });

        const res = await request(app)
            .post("/api/chat/conversations/10/messages")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ content: "Hello", clientMsgId: "android-123" });

        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ id: 77, client_msg_id: "android-123" });
        const sqlCalls = mockQuery.mock.calls.map(([sql]: any[]) => String(sql));
        expect(sqlCalls.some((sql: string) => sql.includes("UPDATE conversations SET updated_at"))).toBe(false);
        expect(sqlCalls.some((sql: string) => sql.includes("INSERT INTO message_reads"))).toBe(false);
        expect(sqlCalls.some((sql: string) => sql.includes("SELECT user_id FROM conversation_participants"))).toBe(false);
    });
});

describe("POST /api/chat/messages/:id/reactions", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("rejects reactions on deleted messages", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [{ conversation_id: 10, deleted_at: new Date().toISOString() }],
            rowCount: 1,
        });

        const res = await request(app)
            .post("/api/chat/messages/12/reactions")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ emoji: "👍" });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/deleted/i);
    });
});

describe("DELETE /api/chat/messages/:id", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("clears reactions when deleting a message", async () => {
        setupAuth();
        mockQuery
            .mockResolvedValueOnce({
                rows: [{ id: 12, sender_id: 1, conversation_id: 10, deleted_at: null, file_url: null }],
                rowCount: 1,
            })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 2 })
            .mockResolvedValueOnce({ rows: [{ user_id: 1 }, { user_id: 2 }], rowCount: 2 });

        const res = await request(app)
            .delete("/api/chat/messages/12")
            .set("Cookie", authCookie(1))
            .set(CSRF);

        expect(res.status).toBe(200);
        const reactionDeleteCall = mockQuery.mock.calls.find(
            ([sql]: any[]) =>
                typeof sql === "string" &&
                sql.includes("DELETE FROM message_reactions WHERE message_id = $1"),
        );
        expect(reactionDeleteCall).toBeTruthy();
        expect(reactionDeleteCall[1]).toEqual([12]);
    });
});

describe("POST /api/chat/messages/:id/delivered", () => {
    const { sendToUser } = require("../utils/ws");

    // Route by SQL text so middleware lookups (maintenance flag, auth) cannot
    // shift a positional mock sequence.
    function mockDeliveredQueries(updatedRows: number) {
        mockQuery.mockImplementation(async (sql: any) => {
            if (typeof sql !== "string") return { rows: [], rowCount: 0 };
            if (sql.includes("token_version")) return { rows: [{ token_version: 0 }], rowCount: 1 };
            if (sql.startsWith("SELECT m.conversation_id FROM messages m")) {
                return { rows: [{ conversation_id: 10 }], rowCount: 1 };
            }
            if (sql.includes("SET delivered_to")) return { rows: [], rowCount: updatedRows };
            if (sql.startsWith("SELECT user_id FROM conversation_participants WHERE conversation_id = $1")) {
                return { rows: [{ user_id: 1 }, { user_id: 2 }], rowCount: 2 };
            }
            return { rows: [], rowCount: 0 };
        });
    }

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        sendToUser.mockClear();
    });

    test("emits chat_message_delivered to every participant on the first ack", async () => {
        mockDeliveredQueries(1);

        const res = await request(app)
            .post("/api/chat/messages/12/delivered")
            .set("Cookie", authCookie(2))
            .set(CSRF);

        expect(res.status).toBe(200);
        expect(sendToUser).toHaveBeenCalledTimes(2);
        for (const userId of [1, 2]) {
            expect(sendToUser.mock.calls).toContainEqual([
                null,
                userId,
                "chat_message_delivered",
                { messageId: 12, conversationId: 10, userId: 2 },
            ]);
        }
    });

    test("does not emit when the user already acknowledged delivery", async () => {
        mockDeliveredQueries(0);

        const res = await request(app)
            .post("/api/chat/messages/12/delivered")
            .set("Cookie", authCookie(2))
            .set(CSRF);

        expect(res.status).toBe(200);
        expect(sendToUser).not.toHaveBeenCalled();
    });
});

describe("GET /api/chat/conversations/:id/files", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("excludes view-once media from the shared files list", async () => {
        mockQuery.mockImplementation(async (sql: any) => {
            if (typeof sql !== "string") return { rows: [], rowCount: 0 };
            if (sql.includes("token_version")) return { rows: [{ token_version: 0 }], rowCount: 1 };
            if (sql.startsWith("SELECT 1 FROM conversation_participants")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await request(app)
            .get("/api/chat/conversations/10/files")
            .set("Cookie", authCookie(1));

        expect(res.status).toBe(200);
        const filesCall = mockQuery.mock.calls.find(
            ([sql]: any[]) => typeof sql === "string" && sql.includes("m.file_url IS NOT NULL"),
        );
        expect(filesCall).toBeTruthy();
        expect(filesCall[0]).toContain("COALESCE((m.metadata->>'viewOnce')::boolean, false) = false");
        expect(filesCall[0]).toContain("m.created_at > COALESCE(cp.cleared_at, '-infinity'::timestamptz)");
        expect(filesCall[1]).toEqual([10, 1]);
    });
});

describe("POST /api/chat/messages/:id/view", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("forbids the sender from re-opening their own view-once media", async () => {
        mockQuery.mockImplementation(async (sql: any) => {
            if (typeof sql !== "string") return { rows: [], rowCount: 0 };
            if (sql.includes("token_version")) return { rows: [{ token_version: 0 }], rowCount: 1 };
            if (sql.startsWith("SELECT id, conversation_id, sender_id, file_url, metadata FROM messages")) {
                return {
                    rows: [{
                        id: 12,
                        conversation_id: 10,
                        sender_id: 1,
                        file_url: "/uploads/org_1/chat/secret.png",
                        metadata: { viewOnce: true, viewedBy: [] },
                    }],
                    rowCount: 1,
                };
            }
            if (sql.includes("FROM conversation_participants")) return { rows: [{ user_id: 1 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await request(app)
            .post("/api/chat/messages/12/view")
            .set("Cookie", authCookie(1))
            .set(CSRF);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
            error: "You can't view your own view-once media",
            code: "VIEW_ONCE_SENDER",
        });
        expect(res.body.fileUrl).toBeUndefined();
        const claimCall = mockQuery.mock.calls.find(
            ([sql]: any[]) => typeof sql === "string" && sql.includes("'{viewedBy}'"),
        );
        expect(claimCall).toBeUndefined();
    });
});

// ─── Call-history selection and deletion ───────────────────────────────────

describe("GET /api/chat/calls", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth", async () => {
        const res = await request(app).get("/api/chat/calls");
        expect(res.status).toBe(401);
    });

    test("reports the complete selectable count without leaking it into rows", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({
            rows: [
                {
                    id: 500,
                    conversation_id: 10,
                    caller_id: 1,
                    call_type: "audio",
                    status: "ended",
                    created_at: new Date().toISOString(),
                    total_count: 237,
                },
            ],
            rowCount: 1,
        });

        const res = await request(app)
            .get("/api/chat/calls")
            .set("Cookie", authCookie(1));

        expect(res.status).toBe(200);
        expect(res.headers["x-total-count"]).toBe("237");
        expect(res.body).toHaveLength(1);
        expect(res.body[0].id).toBe(500);
        expect(res.body[0]).not.toHaveProperty("total_count");

        const historyQuery = mockQuery.mock.calls.find(
            ([sql]: any[]) =>
                typeof sql === "string" &&
                sql.includes("COUNT(*) OVER()") &&
                sql.includes("LIMIT 100"),
        );
        expect(historyQuery).toBeTruthy();
        expect(historyQuery[1]).toEqual([1]);
    });
});

describe("POST /api/chat/calls/delete", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("rejects an empty selection", async () => {
        setupAuth();

        const res = await request(app)
            .post("/api/chat/calls/delete")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ ids: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/No call ids/i);
    });

    test("deletes an explicit, normalized id subset within participant scope", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 2 });

        const res = await request(app)
            .post("/api/chat/calls/delete")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ ids: [10, "11", 10, -1, "invalid"] });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, deleted: 2 });
        const deleteQuery = mockQuery.mock.calls.find(
            ([sql]: any[]) =>
                typeof sql === "string" &&
                sql.includes("DELETE FROM call_logs") &&
                sql.includes("cl.id = ANY"),
        );
        expect(deleteQuery).toBeTruthy();
        expect(deleteQuery[1]).toEqual([[10, 11], 1]);
        expect(deleteQuery[0]).toContain("cp.user_id = $2");
    });

    test("server-side select-all deletes beyond the loaded 100 without an id payload", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 237 });

        const res = await request(app)
            .post("/api/chat/calls/delete")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ all: true });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, deleted: 237 });
        const deleteQuery = mockQuery.mock.calls.find(
            ([sql]: any[]) =>
                typeof sql === "string" &&
                sql.includes("DELETE FROM call_logs") &&
                !sql.includes("cl.id = ANY"),
        );
        expect(deleteQuery).toBeTruthy();
        expect(deleteQuery[0]).toContain("conversation_participants");
        expect(deleteQuery[0]).toContain("cp.user_id = $1");
        expect(deleteQuery[1]).toEqual([1]);
    });
});

// ─── Per-user clear / delete (Signal parity) ───────────────────────────────

/** Route by SQL text: auth, participant check, then the statement under test. */
function mockParticipantQueries(isParticipant = true) {
    mockQuery.mockImplementation(async (sql: any) => {
        if (typeof sql !== "string") return { rows: [], rowCount: 0 };
        if (sql.includes("token_version")) return { rows: [{ token_version: 0 }], rowCount: 1 };
        if (sql.startsWith("SELECT 1 FROM conversation_participants")) {
            return isParticipant ? { rows: [{ "?column?": 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
    });
}

function sqlCalls(): Array<[string, unknown[]]> {
    return mockQuery.mock.calls.filter(([sql]: any[]) => typeof sql === "string") as Array<[string, unknown[]]>;
}

describe("DELETE /api/chat/conversations/:id/messages (clear for me)", () => {
    const { sendToUser } = require("../utils/ws");

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        sendToUser.mockClear();
    });

    test("sets cleared_at for the requester only, deletes nothing, and syncs only their devices", async () => {
        mockParticipantQueries();

        const res = await request(app)
            .delete("/api/chat/conversations/10/messages")
            .set("Cookie", authCookie(2))
            .set(CSRF);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        const clear = sqlCalls().find(([sql]) => sql.includes("SET cleared_at = NOW()"));
        expect(clear).toBeTruthy();
        expect(clear![0]).toContain("WHERE conversation_id = $1 AND user_id = $2");
        expect(clear![0]).not.toContain("hidden_at");
        expect(clear![1]).toEqual([10, 2]);
        expect(sqlCalls().some(([sql]) => /DELETE FROM messages/i.test(sql))).toBe(false);
        // No group-creator lookup any more: anyone can clear their own view.
        expect(sqlCalls().some(([sql]) => sql.includes("created_by FROM conversations"))).toBe(false);
        expect(sendToUser.mock.calls).toEqual([[null, 2, "chat_cleared", { conversationId: 10 }]]);
    });

    test("rejects a non-participant", async () => {
        mockParticipantQueries(false);

        const res = await request(app)
            .delete("/api/chat/conversations/10/messages")
            .set("Cookie", authCookie(9))
            .set(CSRF);

        expect(res.status).toBe(403);
        expect(sqlCalls().some(([sql]) => sql.includes("cleared_at = NOW()"))).toBe(false);
        expect(sendToUser).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/chat/conversations/:id (delete for me)", () => {
    const { sendToUser } = require("../utils/ws");

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        sendToUser.mockClear();
    });

    test("clears and hides for the requester only without cascading", async () => {
        mockParticipantQueries();

        const res = await request(app)
            .delete("/api/chat/conversations/10")
            .set("Cookie", authCookie(2))
            .set(CSRF);

        expect(res.status).toBe(200);
        const hide = sqlCalls().find(([sql]) => sql.includes("hidden_at = NOW()"));
        expect(hide).toBeTruthy();
        expect(hide![0]).toContain("cleared_at = NOW()");
        expect(hide![1]).toEqual([10, 2]);
        expect(sqlCalls().some(([sql]) => /DELETE FROM conversations/i.test(sql))).toBe(false);
        expect(sendToUser.mock.calls).toEqual([[null, 2, "chat_conv_deleted", { conversationId: 10 }]]);
    });
});

describe("per-user cleared/hidden filtering on reads", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTxClient.query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn(mockTxClient));
    });

    test("conversation list hides cleared previews/unreads and deleted-for-me chats", async () => {
        setupAuth();
        const res = await request(app).get("/api/chat/conversations").set("Cookie", authCookie(2));

        expect(res.status).toBe(200);
        const list = sqlCalls().find(([sql]) => sql.includes("AS unread_count"));
        expect(list).toBeTruthy();
        expect(list![0]).toContain("lm.created_at > COALESCE(cp.cleared_at, '-infinity'::timestamptz)");
        expect(list![0]).toContain("msg.created_at > COALESCE(cp.cleared_at, '-infinity'::timestamptz)");
        expect(list![0]).toContain("WHERE cp.hidden_at IS NULL OR m.created_at > cp.hidden_at");
        expect(list![1]).toEqual([2]);
    });

    test("message pages only return messages after the requester's cleared_at", async () => {
        mockParticipantQueries();

        const res = await request(app)
            .get("/api/chat/conversations/10/messages?before=99&limit=20")
            .set("Cookie", authCookie(2));

        expect(res.status).toBe(200);
        const page = sqlCalls().find(([sql]) => sql.includes("AS starred FROM messages m"));
        expect(page).toBeTruthy();
        expect(page![0]).toContain("cpv.user_id = $1");
        expect(page![0]).toContain("m.created_at > COALESCE(cpv.cleared_at, '-infinity'::timestamptz)");
        expect(page![1]).toEqual([2, 10, 99, 20]);
    });

    test.each([
        ["/api/chat/search-messages?q=hello", "ILIKE $2"],
        ["/api/chat/search-messages?q=hello&convId=10", "ILIKE $2"],
        ["/api/chat/conversations/10/pinned", "m.pinned_at IS NOT NULL"],
        ["/api/chat/starred", "FROM starred_messages sm"],
    ])("%s applies the requester's cleared_at", async (url, marker) => {
        mockQuery.mockImplementation(async (sql: any) => {
            if (typeof sql !== "string") return { rows: [], rowCount: 0 };
            if (sql.includes("token_version")) return { rows: [{ token_version: 0 }], rowCount: 1 };
            if (sql.startsWith("SELECT 1 FROM conversation_participants")) return { rows: [{ "?column?": 1 }], rowCount: 1 };
            if (sql.startsWith("SELECT org_id FROM users")) return { rows: [{ org_id: 1 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });

        const res = await request(app).get(url).set("Cookie", authCookie(2));

        expect(res.status).toBe(200);
        const read = sqlCalls().find(([sql]) => sql.includes(marker));
        expect(read).toBeTruthy();
        expect(read![0]).toContain("m.created_at > COALESCE(cp.cleared_at, '-infinity'::timestamptz)");
        expect(read![1]).toContain(2);
    });

    test("re-opening a direct chat reuses it and un-hides it for the requester", async () => {
        setupAuth();
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1, org_id: 1 }, { id: 2, org_id: 1 }], rowCount: 2 });
        mockTxClient.query.mockResolvedValueOnce({ rows: [{ conversation_id: 42 }], rowCount: 1 });

        const res = await request(app)
            .post("/api/chat/conversations")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ userId: 2 });

        expect(res.status).toBe(200);
        expect(res.body.conversationId).toBe(42);
        const unhide = mockTxClient.query.mock.calls.find(([sql]: any[]) => sql.includes("SET hidden_at = NULL"));
        expect(unhide).toBeTruthy();
        expect(unhide[1]).toEqual([42, 1]);
    });
});

// ─── Call ringing / cancel / single call ───────────────────────────────────

describe("GET /api/chat/calls/:callId", () => {
    const callRow = {
        id: 500, conversation_id: 10, caller_id: 1, call_type: "voice", status: "ringing",
        started_at: null, ended_at: null, duration: null, created_at: "2026-10-06T00:00:00Z",
    };

    function mockCallQueries({ call = callRow as any, isParticipant = true } = {}) {
        mockQuery.mockImplementation(async (sql: any) => {
            if (typeof sql !== "string") return { rows: [], rowCount: 0 };
            if (sql.includes("token_version")) return { rows: [{ token_version: 0 }], rowCount: 1 };
            if (sql.includes("FROM call_logs WHERE id = $1")) return { rows: call ? [call] : [], rowCount: call ? 1 : 0 };
            if (sql.startsWith("SELECT 1 FROM conversation_participants")) {
                return { rows: isParticipant ? [{ "?column?": 1 }] : [], rowCount: isParticipant ? 1 : 0 };
            }
            if (sql.includes("user_presence_sessions")) return { rows: [{ id: 321 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });
    }

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns the snake_case call row to a participant", async () => {
        mockCallQueries();
        const res = await request(app).get("/api/chat/calls/500").set("Cookie", authCookie(2));
        expect(res.status).toBe(200);
        expect(res.body).toEqual(callRow);
        const lookup = sqlCalls().find(([sql]) => sql.includes("FROM call_logs WHERE id = $1"));
        expect(lookup![1]).toEqual([500]);
    });

    test("403 for a non-participant, 404 when missing", async () => {
        mockCallQueries({ isParticipant: false });
        expect((await request(app).get("/api/chat/calls/500").set("Cookie", authCookie(9))).status).toBe(403);
        mockCallQueries({ call: null });
        expect((await request(app).get("/api/chat/calls/501").set("Cookie", authCookie(2))).status).toBe(404);
    });

    test("does not shadow GET /calls/active", async () => {
        mockCallQueries();
        const res = await request(app).get("/api/chat/calls/active").set("Cookie", authCookie(2));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ id: 321 });
        expect(sqlCalls().some(([sql]) => sql.includes("FROM call_logs WHERE id = $1"))).toBe(false);
    });
});

describe("POST /api/chat/calls/:callId/ringing", () => {
    const { sendToUser } = require("../utils/ws");

    function mockRingingQueries({ isParticipant = true, call = { caller_id: 1, status: "ringing" } as any } = {}) {
        mockQuery.mockImplementation(async (sql: any) => {
            if (typeof sql !== "string") return { rows: [], rowCount: 0 };
            if (sql.includes("token_version")) return { rows: [{ token_version: 0 }], rowCount: 1 };
            if (sql.startsWith("SELECT 1 FROM conversation_participants")) {
                return { rows: isParticipant ? [{ "?column?": 1 }] : [], rowCount: isParticipant ? 1 : 0 };
            }
            if (sql.startsWith("SELECT caller_id, status FROM call_logs")) return { rows: call ? [call] : [], rowCount: call ? 1 : 0 };
            if (sql.includes("SET ringing_at")) return { rows: [{ id: 500 }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
        });
    }

    async function postRinging(userId = 2, body: unknown = { conversationId: 10 }) {
        return request(app)
            .post("/api/chat/calls/500/ringing")
            .set("Cookie", authCookie(userId))
            .set(CSRF)
            .send(body as object);
    }

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        sendToUser.mockClear();
    });

    test("forwards call_ringing to the caller", async () => {
        mockRingingQueries();
        const res = await postRinging();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        expect(sendToUser.mock.calls).toEqual([
            [null, 1, "call_ringing", { callId: 500, conversationId: 10, userId: 2 }],
        ]);
    });

    test("reports the status without forwarding once the call is no longer ringing", async () => {
        mockRingingQueries({ call: { caller_id: 1, status: "answered" } });
        const res = await postRinging();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, status: "answered" });
        expect(sendToUser).not.toHaveBeenCalled();
    });

    test("validates participant, callee and existence", async () => {
        mockRingingQueries({ isParticipant: false });
        expect((await postRinging(9)).status).toBe(403);
        mockRingingQueries();
        expect((await postRinging(1)).status).toBe(403); // the caller cannot ack
        mockRingingQueries({ call: null });
        expect((await postRinging()).status).toBe(404);
        mockRingingQueries();
        expect((await postRinging(2, {})).status).toBe(400);
        expect(sendToUser).not.toHaveBeenCalled();
    });
});

describe("POST /api/chat/calls/cancel", () => {
    const { cancelRingingCall } = require("../utils/wsHandlers/callRinging");
    const { sendToUser } = require("../utils/ws");

    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        cancelRingingCall.mockClear();
    });

    test("runs the shared WS call_cancel logic for the caller", async () => {
        setupAuth();
        const res = await request(app)
            .post("/api/chat/calls/cancel")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ conversationId: 10 });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true });
        expect(cancelRingingCall).toHaveBeenCalledWith(expect.anything(), null, 1, 10, sendToUser);
    });

    test("is a no-op success when nothing is ringing, 400 without a conversation", async () => {
        setupAuth();
        cancelRingingCall.mockResolvedValueOnce(null);
        const ok = await request(app)
            .post("/api/chat/calls/cancel")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({ conversationId: 10 });
        expect(ok.status).toBe(200);
        expect(ok.body).toEqual({ ok: true });

        setupAuth();
        const bad = await request(app)
            .post("/api/chat/calls/cancel")
            .set("Cookie", authCookie(1))
            .set(CSRF)
            .send({});
        expect(bad.status).toBe(400);
    });
});
