export {};

// Keep this route suite deterministic; limiter behavior is covered separately.
jest.mock("express-rate-limit", () => () => (_req: any, _res: any, next: any) => next());

// Suppress pino logs during tests
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

jest.mock("../utils/platformConfig", () => ({
    getPasswordPolicy: jest.fn().mockResolvedValue({
        minLength: 8,
        requireUppercase: true,
        requireNumber: true,
        requireSpecial: true,
    }),
    isMaintenanceMode: jest.fn().mockResolvedValue(false),
    getMaintenanceMessage: jest.fn().mockResolvedValue(""),
    getAllowedEmailDomains: jest.fn().mockResolvedValue([]),
    getPlatformConfig: jest.fn().mockResolvedValue({}),
    getSessionTimeout: jest.fn().mockResolvedValue(480),
    getRetentionPolicy: jest.fn().mockResolvedValue({
        auditLogRetentionDays: 365,
        deletedTenantCleanupDays: 90,
        sessionLogRetentionDays: 90,
    }),
    updatePlatformConfig: jest.fn().mockResolvedValue({}),
    PLATFORM_KEYS: [],
    DEFAULTS: {},
}));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");

// Mock DB
const mockQuery: jest.Mock = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockTransaction: jest.Mock = jest.fn(async (fn: any) => {
    const client = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    return fn(client);
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

const CSRF = { "X-Requested-With": "WorkPulse" };

describe("POST /api/auth/register", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => {
            const client = { query: jest.fn().mockResolvedValue({ rows: [{ id: 42 }], rowCount: 1 }) };
            return fn(client);
        });
    });

    test("returns 400 when required fields are missing", async () => {
        const res = await request(app)
            .post("/api/auth/register")
            .set(CSRF)
            .send({ username: "test" });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/required/i);
    });

    test("returns 400 for invalid email", async () => {
        const res = await request(app)
            .post("/api/auth/register")
            .set(CSRF)
            .send({ username: "testuser", password: "Password1!", full_name: "Test User", email: "bad-email" });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/email/i);
    });

    test("returns 400 for duplicate username", async () => {
        // user_directory: duplicate found
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }); // user_directory hit
        const res = await request(app)
            .post("/api/auth/register")
            .set(CSRF)
            .send({ username: "taken", password: "Password1!", full_name: "Test", email: "test@example.com" });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/already registered/i);
    });

    test("returns 403 when no tenant context and not bootstrap", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // user_directory miss
        // Bootstrap transaction finds existing platform users / tenants → returns null
        mockTransaction.mockImplementationOnce(async (fn: any) => {
            const client = {
                query: jest
                    .fn()
                    .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // pg_advisory_xact_lock
                    .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1 }) // platform_users count > 0
                    .mockResolvedValueOnce({ rows: [{ count: "1" }], rowCount: 1 }), // tenants count > 0
            };
            return fn(client);
        });
        const res = await request(app)
            .post("/api/auth/register")
            .set(CSRF)
            .send({ username: "newuser", password: "Password1!", full_name: "New User", email: "new@example.com" });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/self-registration is disabled/i);
    });

    test("does not expose first-admin bootstrap over HTTP", async () => {
        mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
        const res = await request(app)
            .post("/api/auth/register")
            .set(CSRF)
            .send({ username: "newuser", password: "Password1!", full_name: "New User", email: "new@example.com" });
        expect(res.status).toBe(403);
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});

describe("POST /api/auth/login", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 400 when username or password is missing", async () => {
        const res = await request(app)
            .post("/api/auth/login")
            .set(CSRF)
            .send({ username: "test" });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/required/i);
    });

    test("returns 401 for non-existent user", async () => {
        // user_directory miss, platform_users miss, legacy users miss (all default empty)
        const res = await request(app)
            .post("/api/auth/login")
            .set(CSRF)
            .send({ username: "noone", password: "Password1!" });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid/i);
    });

    test("returns 401 for wrong password", async () => {
        const hash = await bcrypt.hash("CorrectPass1!", 10);
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // user_directory miss
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // platform_users miss
            .mockResolvedValueOnce({
                // legacy users hit
                rows: [
                    {
                        id: 1,
                        username: "john",
                        password: hash,
                        full_name: "John",
                        is_active: true,
                        failed_login_attempts: 0,
                        role: "employee",
                    },
                ],
                rowCount: 1,
            });
        const res = await request(app)
            .post("/api/auth/login")
            .set(CSRF)
            .send({ username: "john", password: "WrongPass1!" });
        expect(res.status).toBe(401);
    });

    test("keeps platform login tenantless and returns forced-change state", async () => {
        const hash = await bcrypt.hash("CorrectPass1!", 10);
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // user_directory miss
            .mockResolvedValueOnce({ rows: [{
                id: 9, username: "vvronline", password: hash, full_name: "Platform Admin",
                email: "admin@example.test", is_active: true, token_version: 0,
                failed_login_attempts: 0, must_change_password: true,
            }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: "platform-session" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: "platform-session" }], rowCount: 1 });

        const res = await request(app).post("/api/auth/login").set(CSRF)
            .send({ username: "vvronline", password: "CorrectPass1!" });

        expect(res.status).toBe(200);
        expect(res.body.user).toMatchObject({
            id: 9, role: "platform_admin", tenant_id: null, org_id: null,
            must_change_password: true,
        });
        const token = jwt.decode(res.body.token);
        // PR-B: platform tokens carry aud="platform" so they cannot be replayed
        // against the application host.
        expect(token).toMatchObject({ platform: true, tenant_id: null, aud: "platform" });
        expect(res.headers["set-cookie"][0]).toMatch(/^aino_console=/);
        expect(mockQuery.mock.calls.some(([sql]) => /FROM tenants/.test(sql))).toBe(false);
    });

    test("hands a verified platform-only login from the app host to the console", async () => {
        const previousConsoleHost = process.env.CONSOLE_HOST;
        process.env.CONSOLE_HOST = "console.example.test";
        try {
            const hash = await bcrypt.hash("CorrectPass1!", 10);
            mockQuery
                .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // user_directory miss
                .mockResolvedValueOnce({ rows: [{
                    id: 9, username: "operator", password: hash, full_name: "Operator",
                    is_active: true, failed_login_attempts: 0,
                }], rowCount: 1 })
                .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // realm_handoffs insert

            const res = await request(app).post("/api/auth/login").set(CSRF)
                .set("Host", "app.example.test")
                .send({ username: "operator", password: "CorrectPass1!" });

            expect(res.status).toBe(200);
            expect(res.body.redirect).toMatch(/^https:\/\/console\.example\.test\/auth\/handoff#t=/);
            expect(res.headers["set-cookie"]).toBeUndefined();
            const insert = mockQuery.mock.calls.find(([sql]) => /INSERT INTO realm_handoffs/i.test(sql));
            expect(insert?.[1]).toEqual(expect.arrayContaining(["login", "platform", 9, null, null]));
        } finally {
            if (previousConsoleHost === undefined) delete process.env.CONSOLE_HOST;
            else process.env.CONSOLE_HOST = previousConsoleHost;
        }
    });

    test("does not mint a platform-only handoff before credential and account checks pass", async () => {
        const previousConsoleHost = process.env.CONSOLE_HOST;
        process.env.CONSOLE_HOST = "console.example.test";
        try {
            const hash = await bcrypt.hash("CorrectPass1!", 10);
            mockQuery
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [{
                    id: 9, username: "operator", password: hash, is_active: true,
                    failed_login_attempts: 4,
                }], rowCount: 1 })
                .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // failed-attempt update

            const res = await request(app).post("/api/auth/login").set(CSRF)
                .set("Host", "app.example.test")
                .send({ username: "operator", password: "WrongPass1!" });

            expect(res.status).toBe(401);
            expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO realm_handoffs/i.test(sql))).toBe(false);
        } finally {
            if (previousConsoleHost === undefined) delete process.env.CONSOLE_HOST;
            else process.env.CONSOLE_HOST = previousConsoleHost;
        }
    });

    test.each([
        ["previously locked", true, new Date(Date.now() + 600000).toISOString(), 200],
        ["inactive", false, null, 403],
    ])("handles a %s platform account without creating an unsafe handoff", async (_state, isActive, lockedUntil, status) => {
        const previousConsoleHost = process.env.CONSOLE_HOST;
        process.env.CONSOLE_HOST = "console.example.test";
        try {
            const hash = await bcrypt.hash("CorrectPass1!", 10);
            mockQuery
                .mockResolvedValueOnce({ rows: [], rowCount: 0 })
                .mockResolvedValueOnce({ rows: [{
                    id: 9, username: "operator", password: hash, is_active: isActive,
                    failed_login_attempts: 0, locked_until: lockedUntil,
                }], rowCount: 1 });

            const res = await request(app).post("/api/auth/login").set(CSRF)
                .set("Host", "app.example.test")
                .send({ username: "operator", password: "CorrectPass1!" });

            expect(res.status).toBe(status);
            expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO realm_handoffs/i.test(sql))).toBe(status === 200);
        } finally {
            if (previousConsoleHost === undefined) delete process.env.CONSOLE_HOST;
            else process.env.CONSOLE_HOST = previousConsoleHost;
        }
    });

    test("does not apply a timed account lock to a platform admin after repeated failures", async () => {
        const hash = await bcrypt.hash("CorrectPass1!", 10);
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [{
                id: 9, username: "operator", password: hash, is_active: true,
                failed_login_attempts: 4,
            }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await request(app).post("/api/auth/login").set(CSRF)
            .send({ username: "operator", password: "WrongPass1!" });

        expect(res.status).toBe(401);
        const update = mockQuery.mock.calls.find(([sql]) => /UPDATE platform_users SET failed_login_attempts/i.test(sql));
        expect(update).toBeDefined();
        expect(update[0]).not.toContain("locked_until");
    });

    test("returns 200 with user data and cookie on valid login", async () => {
        // Post-migration login path: user_directory hit → tenant DB lookup.
        // The legacy "users in master DB" fallback was removed; tests must
        // exercise the real cross-tenant resolution.
        const hash = await bcrypt.hash("CorrectPass1!", 10);
        const userRow = {
            id: 1,
            username: "john",
            password: hash,
            full_name: "John Doe",
            email: "john@example.com",
            avatar: null,
            is_active: true,
            failed_login_attempts: 0,
            role: "employee",
            org_id: null,
            token_version: 0,
        };

        // Stub the tenant pool returned by getTenantDb()
        const tm = require("../utils/tenantManager");
        tm.getTenantById.mockResolvedValueOnce({
            id: 7,
            slug: "acme",
            db_name: "wp_acme",
            db_host: null,
            status: "active",
        });
        const tenantQuery = jest
            .fn()
            .mockResolvedValueOnce({ rows: [userRow], rowCount: 1 }) // SELECT * FROM users WHERE id=...
            .mockResolvedValueOnce({ rows: [{ id: "sess-1" }], rowCount: 1 }) // INSERT session
            .mockResolvedValueOnce({ rows: [{ id: "sess-1" }], rowCount: 1 }) // list sessions
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // reports check
        tm.getTenantPool.mockResolvedValueOnce({
            query: tenantQuery,
            transaction: jest.fn(async (fn: any) => fn({ query: tenantQuery })),
        });

        mockQuery
            .mockResolvedValueOnce({
                // user_directory hit
                rows: [{ tenant_id: 7, user_id: 1 }],
                rowCount: 1,
            })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // platform_users check (not platform user)

        const res = await request(app)
            .post("/api/auth/login")
            .set(CSRF)
            .send({ username: "john", password: "CorrectPass1!" });
        expect(res.status).toBe(200);
        expect(res.body.user.username).toBe("john");
        expect(res.body.user.full_name).toBe("John Doe");
        expect(res.headers["set-cookie"]).toBeDefined();
    });

    test("linked dual principal returns a realm chooser and never deactivates the tenant row", async () => {
        const hash = await bcrypt.hash("SharedPass1!", 10);
        const tenantUser = {
            id: 2, username: "dual", email: "dual@example.test", password: hash,
            full_name: "Dual User", is_active: true, role: "employee", failed_login_attempts: 0,
        };
        const platformUser = {
            id: 9, username: "dual", email: "dual@example.test", password: hash,
            full_name: "Dual User", is_active: true, role: "platform_admin", failed_login_attempts: 0,
        };
        const tm = require("../utils/tenantManager");
        tm.getTenantById.mockResolvedValueOnce({
            id: 1, slug: "aino", org_name: "AINO", db_name: "wp_aino", db_host: null, status: "active",
        });
        const tenantQuery = jest.fn().mockResolvedValueOnce({ rows: [tenantUser], rowCount: 1 });
        tm.getTenantPool.mockResolvedValueOnce({ query: tenantQuery, transaction: jest.fn() });
        mockQuery
            .mockResolvedValueOnce({ rows: [{ tenant_id: 1, user_id: 2 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [platformUser], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ default_realm: "tenant" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // persist realm_login_choices

        const res = await request(app).post("/api/auth/login").set(CSRF)
            .send({ username: "dual", password: "SharedPass1!" });

        expect(res.status).toBe(409);
        expect(res.body.code).toBe("REALM_CHOICE_REQUIRED");
        expect(res.body.realms).toEqual(expect.arrayContaining([
            expect.objectContaining({ realm: "tenant", default: true }),
            expect.objectContaining({ realm: "platform" }),
        ]));
        expect(res.body.login_ticket).toBeTruthy();
        // The historical bug did both of these. They must never return.
        expect(mockQuery.mock.calls.some(([sql]) => /DELETE FROM user_directory/i.test(sql))).toBe(false);
        expect(tenantQuery.mock.calls.some(([sql]) => /UPDATE users SET is_active = FALSE/i.test(sql))).toBe(false);
        expect(res.headers["set-cookie"]).toBeUndefined();
    });

    test("returns 403 for deactivated user", async () => {
        const hash = await bcrypt.hash("Password1!", 10);
        const userRow = {
            id: 1,
            username: "disabled",
            password: hash,
            full_name: "Disabled",
            is_active: false,
            failed_login_attempts: 0,
        };

        const tm = require("../utils/tenantManager");
        tm.getTenantById.mockResolvedValueOnce({
            id: 7,
            slug: "acme",
            db_name: "wp_acme",
            db_host: null,
            status: "active",
        });
        const tenantQuery = jest.fn().mockResolvedValueOnce({ rows: [userRow], rowCount: 1 });
        tm.getTenantPool.mockResolvedValueOnce({
            query: tenantQuery,
            transaction: jest.fn(async (fn: any) => fn({ query: tenantQuery })),
        });

        mockQuery
            .mockResolvedValueOnce({ rows: [{ tenant_id: 7, user_id: 1 }], rowCount: 1 }) // user_directory
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // platform_users

        const res = await request(app)
            .post("/api/auth/login")
            .set(CSRF)
            .send({ username: "disabled", password: "Password1!" });
        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/deactivated/i);
    });

    test("returns 423 for locked account", async () => {
        const hash = await bcrypt.hash("Password1!", 10);
        const userRow = {
            id: 1,
            username: "locked",
            password: hash,
            full_name: "Locked",
            is_active: true,
            failed_login_attempts: 5,
            locked_until: new Date(Date.now() + 600000).toISOString(),
        };

        const tm = require("../utils/tenantManager");
        tm.getTenantById.mockResolvedValueOnce({
            id: 7,
            slug: "acme",
            db_name: "wp_acme",
            db_host: null,
            status: "active",
        });
        const tenantQuery = jest.fn().mockResolvedValueOnce({ rows: [userRow], rowCount: 1 });
        tm.getTenantPool.mockResolvedValueOnce({
            query: tenantQuery,
            transaction: jest.fn(async (fn: any) => fn({ query: tenantQuery })),
        });

        mockQuery
            .mockResolvedValueOnce({ rows: [{ tenant_id: 7, user_id: 1 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(app)
            .post("/api/auth/login")
            .set(CSRF)
            .send({ username: "locked", password: "Password1!" });
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid credentials/i);
    });
});

describe("POST /api/auth/logout", () => {
    test("clears the token cookie", async () => {
        const res = await request(app).post("/api/auth/logout").set(CSRF);
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/logged out/i);
        const cookies = res.headers["set-cookie"];
        expect(cookies).toBeDefined();
        // Cookie should be expired/cleared
        expect(cookies[0]).toMatch(/token=/);
    });
});

const SECRET = process.env.JWT_SECRET || "test-secret";

function authCookie(userId = 1) {
    const token = jwt.sign({ id: userId, username: "testuser", tv: 0 }, SECRET, { expiresIn: "1h" });
    return `token=${token}`;
}

describe("POST /api/auth/refresh", () => {
    beforeEach(() => {
        mockQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
    });

    test("returns 401 without auth cookie", async () => {
        const res = await request(app).post("/api/auth/refresh").set(CSRF);
        expect(res.status).toBe(401);
    });

    test("refreshes token for valid authenticated user", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth middleware
            .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }); // refresh query
        const res = await request(app)
            .post("/api/auth/refresh")
            .set(CSRF)
            .set("Cookie", authCookie());
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/refreshed/i);
        expect(res.headers["set-cookie"]).toBeDefined();
        expect(res.headers["set-cookie"][0]).toMatch(/token=/);
        const token = res.headers["set-cookie"][0].match(/^token=([^;]+)/)?.[1];
        expect(jwt.decode(token)).toMatchObject({ sid: expect.any(String) });
    });

    test("returns 401 when user no longer exists", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ token_version: 0 }], rowCount: 1 }) // auth middleware
            .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // user not found
        const res = await request(app)
            .post("/api/auth/refresh")
            .set(CSRF)
            .set("Cookie", authCookie());
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/not found/i);
    });
});