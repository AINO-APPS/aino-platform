export {};

const jwt = require("jsonwebtoken");

// Ensure JWT_SECRET is set before middleware is loaded
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret";

// Test auth middleware in isolation
jest.mock("../utils/logger", () => ({
    logger: {
        info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn(), debug: jest.fn(),
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    },
}));

const mockQuery: jest.Mock = jest.fn();
jest.mock("../db", () => ({
    query: (...args: any[]) => mockQuery(...args),

    masterQuery: (...args: any[]) => mockQuery(...args),

    masterTransaction: (fn: any) => fn({ query: (...a: any[]) => mockQuery(...a) }),
}));

const authMiddleware = require("../middleware/auth");
const { canManageUser, resolveAssignableTenantRole } = require("../middleware/rbac");

const SECRET = process.env.JWT_SECRET || "test-secret";

function mockReqRes(cookie: any) {
    const req: any = {
        cookies: { token: cookie },
        db: { query: (...args: any[]) => mockQuery(...args) },
    };
    const res: any = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();
    return { req, res, next };
}

describe("authMiddleware", () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    test("returns 401 when no token cookie", async () => {
        const { req, res, next } = mockReqRes(undefined);
        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/no token/i) }));
        expect(next).not.toHaveBeenCalled();
    });

    test("returns 401 for malformed token", async () => {
        const { req, res, next } = mockReqRes("not-a-jwt");
        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test("returns 401 for expired token", async () => {
        const expired = jwt.sign({ id: 1, username: "test", tv: 0 }, SECRET, { expiresIn: "-1s" });
        const { req, res, next } = mockReqRes(expired);
        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/expired/i) }));
    });

    test("returns 401 when user no longer exists", async () => {
        const token = jwt.sign({ id: 999, username: "ghost", tv: 0 }, SECRET, { expiresIn: "1h" });
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const { req, res, next } = mockReqRes(token);
        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/no longer exists/i) }));
    });

    test("returns 401 when token_version mismatch (password was changed)", async () => {
        const token = jwt.sign({ id: 1, username: "test", tv: 0 }, SECRET, { expiresIn: "1h" });
        mockQuery.mockResolvedValueOnce({ rows: [{ token_version: 1 }], rowCount: 1 }); // version bumped
        const { req, res, next } = mockReqRes(token);
        await authMiddleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/session expired/i) }));
    });

    test("calls next() and sets req.userId on valid token", async () => {
        const token = jwt.sign({ id: 42, username: "alice", tv: 0 }, SECRET, { expiresIn: "1h" });
        mockQuery.mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 });
        const { req, res, next } = mockReqRes(token);
        await authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(req.userId).toBe(42);
        expect(req.username).toBe("alice");
    });

    test("rejects a session replaced by a login on another device", async () => {
        const token = jwt.sign({ id: 42, username: "alice", tv: 0, sid: "old-session" }, SECRET, { expiresIn: "1h" });
        mockQuery
            .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const { req, res, next } = mockReqRes(token);

        await authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringMatching(/another device/i) }));
        expect(next).not.toHaveBeenCalled();
    });

    test("rejects and removes a session idle for two days", async () => {
        const token = jwt.sign({ id: 42, username: "alice", tv: 0, sid: "idle-session" }, SECRET, { expiresIn: "1h" });
        mockQuery
            .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ last_activity_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });
        const { req, res, next } = mockReqRes(token);

        await authMiddleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "SESSION_IDLE_EXPIRED" }));
        expect(next).not.toHaveBeenCalled();
    });
});

describe("canManageUser (RBAC)", () => {
    test("super_admin can manage hr_admin", () => {
        expect(canManageUser("super_admin", "hr_admin")).toBe(true);
    });

    test("hr_admin can manage manager", () => {
        expect(canManageUser("hr_admin", "manager")).toBe(true);
    });

    test("manager cannot manage hr_admin", () => {
        expect(canManageUser("manager", "hr_admin")).toBe(false);
    });

    test("employee cannot manage employee (same level)", () => {
        expect(canManageUser("employee", "employee")).toBe(false);
    });

    test("team_lead can manage employee", () => {
        expect(canManageUser("team_lead", "employee")).toBe(true);
    });

    test("employee cannot manage team_lead", () => {
        expect(canManageUser("employee", "team_lead")).toBe(false);
    });
});

describe("resolveAssignableTenantRole", () => {
    const db = { query: jest.fn() };

    beforeEach(() => db.query.mockReset());

    test("resolves a tenant custom role using its configured level", async () => {
        db.query.mockResolvedValue({ rows: [{ role_key: "people_ops", permission_level: 3 }] });
        await expect(resolveAssignableTenantRole(db, 1, "people_ops", 5)).resolves.toEqual({
            roleKey: "people_ops",
            permissionLevel: 3,
        });
    });

    test.each(["super_admin", "platform_admin"])("rejects protected role %s", async (role) => {
        await expect(resolveAssignableTenantRole(db, 1, role, 5)).rejects.toMatchObject({ code: "PROTECTED_ROLE" });
        expect(db.query).not.toHaveBeenCalled();
    });

    test("rejects unknown roles instead of silently assigning employee", async () => {
        db.query.mockResolvedValue({ rows: [{ role_key: "employee", permission_level: 1 }] });
        await expect(resolveAssignableTenantRole(db, 1, "made_up", 5)).rejects.toMatchObject({ code: "INVALID_ROLE" });
    });

    test("supports canonical roles only when a legacy tenant has no catalogue", async () => {
        db.query.mockResolvedValue({ rows: [] });
        await expect(resolveAssignableTenantRole(db, 1, "employee", 4)).resolves.toEqual({
            roleKey: "employee",
            permissionLevel: 1,
        });
    });

    test("rejects roles at the actor's own level", async () => {
        db.query.mockResolvedValue({ rows: [{ role_key: "people_ops", permission_level: 4 }] });
        await expect(resolveAssignableTenantRole(db, 1, "people_ops", 4)).rejects.toMatchObject({ code: "ROLE_HIERARCHY" });
    });
});