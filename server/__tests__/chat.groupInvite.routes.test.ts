export {};

// HTTP adapters for group invite links, join requests, the group photo and
// the active group-call lookup (modules/chat/chat.group-invite.routes.ts).

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
jest.mock("../utils/mailer", () => ({ getTransporter: jest.fn(() => null), sendMail: jest.fn(), notifyByEmail: jest.fn(), esc: (s: any) => String(s ?? "") }));
jest.mock("../utils/ws", () => ({ setupWebSocket: jest.fn(), sendToUser: jest.fn(), broadcast: jest.fn() }));
// The single-DB test harness has no tenant; upload keys require one, so pin it.
jest.mock("../utils/uploadPath", () => {
    const actual = jest.requireActual("../utils/uploadPath");
    return {
        ...actual,
        getUploadKey: (_t: unknown, org: number, kind: string, name: string) => actual.getUploadKey(7, org, kind, name),
        getUploadUrl: (_t: unknown, org: number, kind: string, name: string) => actual.getUploadUrl(7, org, kind, name),
    };
});
jest.mock("../utils/audit", () => ({ logAction: jest.fn(), queryLogs: jest.fn().mockResolvedValue({ rows: [], total: 0 }) }));
jest.mock("../redis", () => ({
    ...jest.requireActual("../redis"),
    getUserContext: jest.fn().mockResolvedValue(null),
    setUserContext: jest.fn().mockResolvedValue(undefined),
}));
const mockPut = jest.fn().mockResolvedValue(undefined);
const mockDelete = jest.fn().mockResolvedValue(undefined);
jest.mock("../platform/storage", () => ({
    ...jest.requireActual("../platform/storage"),
    getStorage: () => ({ put: mockPut, delete: mockDelete }),
}));

/** Rows keyed by a distinctive SQL fragment; anything unmatched returns no rows. */
let table: Array<[string, any[]]> = [];
const mockQuery: jest.Mock = jest.fn(async (sql: string) => {
    const hit = table.find(([fragment]) => typeof sql === "string" && sql.includes(fragment));
    return { rows: hit ? hit[1] : [], rowCount: hit ? Math.max(hit[1].length, 1) : 0 };
});
jest.mock("../db", () => ({
    pool: { end: jest.fn() },
    query: (...args: any[]) => mockQuery(...args),
    masterQuery: (...args: any[]) => mockQuery(...args),
    masterTransaction: jest.fn(),
    transaction: jest.fn(),
    initDB: jest.fn(),
}));

const jwt = require("jsonwebtoken");
const request = require("supertest");
const { app } = require("../index");
const { sendToUser } = require("../utils/ws");

const SECRET = process.env.JWT_SECRET || "test-secret";
const CSRF = { "X-Requested-With": "AINO" };
const cookie = (userId: number, tenantId?: number) =>
    `token=${jwt.sign({ id: userId, username: "u", tv: 0, ...(tenantId ? { tenant_id: tenantId } : {}) }, SECRET, { expiresIn: "1h" })}`;

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWx";
const base: Array<[string, any[]]> = [
    ["token_version", [{ token_version: 0 }]],
    ["is_active FROM users", [{ role: "employee", org_id: 1, is_active: true }]],
    ["COALESCE(post_policy", [{ is_group: true, created_by: 1, post_policy: "all", add_policy: "admins" }]],
    ["FROM conversations WHERE id = $1 AND is_group", [{ id: 10, name: "Design", org_id: 1, invite_enabled: true, invite_requires_approval: false, invite_token: TOKEN }]],
];
const asRole = (role: string | null): Array<[string, any[]]> => [
    ["SELECT role FROM conversation_participants", role ? [{ role }] : []],
];

beforeEach(() => {
    mockQuery.mockClear();
    mockPut.mockClear();
    (sendToUser as jest.Mock).mockClear();
});

describe("group link management", () => {
    test("members cannot read or change the link", async () => {
        table = [...asRole("member"), ...base];
        const get = await request(app).get("/api/chat/conversations/10/invite-link").set("Cookie", cookie(2));
        expect(get.status).toBe(403);
        const put = await request(app).put("/api/chat/conversations/10/invite-link").set(CSRF).set("Cookie", cookie(2)).send({ enabled: false });
        expect(put.status).toBe(403);
        expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("SET invite_enabled"))).toBe(false);
    });

    test("an admin can read the link", async () => {
        table = [...asRole("admin"), ["COUNT(*)::int AS c FROM conversation_join_requests", [{ c: 2 }]], ...base];
        const res = await request(app).get("/api/chat/conversations/10/invite-link").set("Cookie", cookie(2));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ enabled: true, token: TOKEN, requiresApproval: false, pendingRequests: 2 });
    });
});

describe("joining via link", () => {
    test("a malformed token is a 404", async () => {
        table = base;
        const res = await request(app).get("/api/chat/invite/bad!").set("Cookie", cookie(2));
        expect(res.status).toBe(404);
    });

    test("an unknown token (e.g. from another tenant) is a 404", async () => {
        table = base;
        const res = await request(app).post("/api/chat/invite/ZZZZZZZZZZZZZZZZZZZZZZZZ/join").set(CSRF).set("Cookie", cookie(2));
        expect(res.status).toBe(404);
    });

    test("joining an open link adds the user and announces it", async () => {
        table = [
            ["FROM conversations WHERE invite_token = $1", [{ id: 10, org_id: 1, invite_enabled: true, invite_requires_approval: false, invite_token: TOKEN }]],
            ["FROM users WHERE id = $1 AND org_id = $2 AND is_active", [{ id: 2, full_name: "Bea", avatar: null }]],
            ["INSERT INTO conversation_participants", [{}]],
            ...base,
        ];
        const res = await request(app).post(`/api/chat/invite/${TOKEN}/join`).set(CSRF).set("Cookie", cookie(2));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ conversationId: 10, pending: false });
        expect(sendToUser).toHaveBeenCalledWith(null, 2, "chat_group_added", { conversationId: 10 });
    });

    test("an approval link queues a request and pings the admins", async () => {
        table = [
            ["FROM conversations WHERE invite_token = $1", [{ id: 10, org_id: 1, invite_enabled: true, invite_requires_approval: true, invite_token: TOKEN }]],
            ["FROM users WHERE id = $1 AND org_id = $2 AND is_active", [{ id: 2, full_name: "Bea", avatar: null }]],
            ["INSERT INTO conversation_join_requests", [{}]],
            ["role IN ('owner', 'admin')", [{ user_id: 1 }]],
            ...base,
        ];
        const res = await request(app).post(`/api/chat/invite/${TOKEN}/join`).set(CSRF).set("Cookie", cookie(2));
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ conversationId: 10, pending: true });
        expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO conversation_participants"))).toBe(false);
        expect(sendToUser).toHaveBeenCalledWith(null, 1, "chat_group_join_request", { conversationId: 10, userId: 2, userName: "Bea" });
    });
});

describe("group photo", () => {
    const png = Buffer.from("89504e470d0a1a0a", "hex");

    test("members cannot change the photo", async () => {
        table = [...asRole("member"), ...base];
        const res = await request(app).post("/api/chat/conversations/10/avatar").set(CSRF).set("Cookie", cookie(2))
            .attach("avatar", png, { filename: "a.png", contentType: "image/png" });
        expect(res.status).toBe(403);
        expect(mockPut).not.toHaveBeenCalled();
    });

    test("non-image uploads are rejected", async () => {
        table = [...asRole("owner"), ...base];
        const res = await request(app).post("/api/chat/conversations/10/avatar").set(CSRF).set("Cookie", cookie(1))
            .attach("avatar", Buffer.from("%PDF"), { filename: "a.pdf", contentType: "application/pdf" });
        expect(res.status).toBe(400);
        expect(mockPut).not.toHaveBeenCalled();
    });

    test("a planted foreign avatar value is never deleted on replace", async () => {
        mockDelete.mockClear();
        table = [...asRole("admin"), ["SELECT avatar FROM conversations", [{ avatar: "/uploads/tenant_9/org_3/branding/logo_x.png" }]], ...base];
        const res = await request(app).post("/api/chat/conversations/10/avatar").set(CSRF).set("Cookie", cookie(2))
            .attach("avatar", png, { filename: "a.png", contentType: "image/png" });
        expect(res.status).toBe(200);
        expect(mockDelete).not.toHaveBeenCalled();
    });

    test("replacing our own previous group photo deletes it", async () => {
        mockDelete.mockClear();
        const previous = "/uploads/tenant_7/org_1/avatars/group_0123456789abcdef0123456789abcdef.jpg";
        table = [...asRole("admin"), ["SELECT avatar FROM conversations", [{ avatar: previous }]], ...base];
        const res = await request(app).post("/api/chat/conversations/10/avatar").set(CSRF).set("Cookie", cookie(2, 7))
            .attach("avatar", png, { filename: "a.png", contentType: "image/png" });
        expect(res.status).toBe(200);
        expect(mockDelete).toHaveBeenCalledWith("tenant_7/org_1/avatars/group_0123456789abcdef0123456789abcdef.jpg");
    });

    test("PUT /group refuses to point the avatar at an arbitrary object", async () => {
        table = [
            ...asRole("owner"),
            ["SELECT * FROM conversations WHERE id = $1 AND is_group = TRUE", [{ id: 10, is_group: true, org_id: 1 }]],
            ...base,
        ];
        const res = await request(app).put("/api/chat/conversations/10/group").set(CSRF).set("Cookie", cookie(1))
            .send({ avatar: "/uploads/tenant_9/org_3/branding/logo_x.png" });
        expect(res.status).toBe(400);
        expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE conversations SET avatar"))).toBe(false);
    });

    test("an admin's upload is stored and becomes the group photo", async () => {
        table = [...asRole("admin"), ["SELECT avatar FROM conversations", [{ avatar: null }]], ...base];
        const res = await request(app).post("/api/chat/conversations/10/avatar").set(CSRF).set("Cookie", cookie(2))
            .attach("avatar", png, { filename: "a.png", contentType: "image/png" });
        expect(res.status).toBe(200);
        expect(res.body.avatar).toMatch(/\/avatars\/group_[^/]+\.png$/);
        expect(mockPut).toHaveBeenCalledTimes(1);
        const update = mockQuery.mock.calls.find(([sql]) => String(sql).includes("UPDATE conversations SET avatar"));
        expect(update[1]).toEqual([res.body.avatar, 10]);
    });
});

describe("active group call", () => {
    test("204 when nothing is running", async () => {
        table = [...asRole("member"), ...base];
        const res = await request(app).get("/api/chat/conversations/10/active-call").set("Cookie", cookie(2));
        expect(res.status).toBe(204);
    });

    test("returns the live roster", async () => {
        table = [
            ...asRole("member"),
            ["m.is_huddle = TRUE AND m.status = 'active'", [{ id: 7, meeting_code: "ABC-DEFG-HJK", settings: { callType: "video" }, created_by: 1, started_at: null }]],
            ["mp.status = 'joined'", [{ id: 1, full_name: "Ana", avatar: null }]],
            ...base,
        ];
        const res = await request(app).get("/api/chat/conversations/10/active-call").set("Cookie", cookie(2));
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ meetingCode: "ABC-DEFG-HJK", callType: "video", participants: [{ id: 1, fullName: "Ana" }] });
    });
});
