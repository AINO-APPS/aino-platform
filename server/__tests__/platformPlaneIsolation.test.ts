export {};

/**
 * PLATFORM PLANE ISOLATION — PR-A / item A8.
 *
 * Guards the invariant introduced by ADR-012: the Platform Console holds
 * PLATFORM facts about a tenant (name, plan, seat count, db size, storage) and
 * never tenant-private data (user rows / PII, business-activity metrics) —
 * for EVERY tenant, including the default (AINO) tenant.
 *
 * Before PR-A, `hasTenantDataConsent()` short-circuited on `is_default`, so
 * every platform_users account had permanent, unapproved, unaudited read
 * access to AINO's employee directory. These tests fail if that regresses.
 *
 * Unlike tenants.routes.characterization.test.ts, the consent helper is NOT
 * mocked here — the real gate runs against a stubbed master DB so the wiring
 * between route and gate is exercised, not just the route's shape.
 */

import express from "express";
const request = require("supertest");

const DEFAULT_TENANT = { id: 1, slug: "aino", org_name: "AINO", is_default: true, db_name: "wp_aino", db_host: null, plan: "enterprise" };
const CUSTOMER_TENANT = { id: 7, slug: "acme", org_name: "Acme", is_default: false, db_name: "wp_acme", db_host: null, plan: "standard" };

const PLATFORM_ADMIN_ID = 41;

// Rows returned by the master DB stub for the access-request lookup.
let mockAccessRequestRows: any[] = [];
// The tenant the route resolves.
let mockTenant: any = DEFAULT_TENANT;

const mockLogPlatformAction = jest.fn();
const mockTenantQuery = jest.fn();

// ── Master DB: only the consent lookup and user_directory count matter here ──
const mockMasterQuery = jest.fn(async (sql: string) => {
    if (/tenant_access_requests/i.test(sql)) return { rows: mockAccessRequestRows, rowCount: mockAccessRequestRows.length };
    if (/user_directory/i.test(sql)) return { rows: [{ count: "12" }], rowCount: 1 };
    if (/pg_database_size/i.test(sql)) return { rows: [{ size: "1048576" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
});

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = PLATFORM_ADMIN_ID;
    req.username = "platform-operator";
    req.isPlatformUser = true;
    req.tenantId = null;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => { req.userRole = "platform_admin"; next(); },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

// The consent helper reads the master DB through ../db.
jest.mock("../db", () => ({ masterQuery: (...a: any[]) => mockMasterQuery(...(a as [string])) }));
jest.mock("../services/masterDatabase", () => ({ masterQuery: (...a: any[]) => mockMasterQuery(...(a as [string])) }));

jest.mock("../utils/tenantManager", () => ({
    createTenant: jest.fn(), deleteTenant: jest.fn(), suspendTenant: jest.fn(), reactivateTenant: jest.fn(),
    getTenantById: jest.fn(async () => mockTenant),
    getTenantPool: jest.fn(async () => ({ query: (...a: any[]) => mockTenantQuery(...a), transaction: jest.fn() })),
    getPoolStats: jest.fn(() => ({})),
    listActiveTenants: jest.fn(),
}));
jest.mock("../utils/platformAudit", () => ({
    logPlatformAction: (...a: any[]) => mockLogPlatformAction(...a),
    updatePlatformAuditLog: jest.fn(),
    queryPlatformLogs: jest.fn(),
}));
jest.mock("../redis", () => ({ del: jest.fn() }));
jest.mock("../middleware/impersonationAudit", () => ({ startSession: jest.fn(), getSession: jest.fn(), endSession: jest.fn() }));
jest.mock("../utils/cookie", () => ({ cookieOptions: jest.fn(() => ({})) }));
jest.mock("../utils/planCatalog", () => ({
    PLANS: {}, PLAN_KEYS: ["standard"], FEATURE_LABELS: {}, FEATURE_KEYS: [], DEFAULT_PLANS: {},
    getEffectiveFeatures: jest.fn(() => ({})), getPlanLimits: jest.fn(), sanitizeFeatureOverrides: jest.fn(),
    planFeatureDiff: jest.fn(), loadPlanCatalog: jest.fn(), savePlanCatalog: jest.fn(), getPlans: jest.fn(),
}));
jest.mock("../utils/platformConfig", () => ({ getPlatformConfig: jest.fn(), updatePlatformConfig: jest.fn() }));
jest.mock("../middleware/maintenanceMode", () => ({ invalidateMaintenanceCache: jest.fn() }));
jest.mock("../services/tenantStorageUsage", () => ({ tenantStorageStatsFields: jest.fn(async () => ({})) }));
jest.mock("../utils/logger", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const tenantRoutes = require("../routes/tenants");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/admin/tenants", tenantRoutes);
    return app;
}

/** Simulate an approved, live, unrevoked session owned by the calling admin. */
function grantLiveSession(tenantId: number, requestedBy = PLATFORM_ADMIN_ID) {
    mockAccessRequestRows = [{ id: 500, tenant_id: tenantId, requested_by: requestedBy }];
}

beforeEach(() => {
    mockAccessRequestRows = [];
    mockTenant = DEFAULT_TENANT;
    mockMasterQuery.mockClear();
    mockTenantQuery.mockReset();
    mockLogPlatformAction.mockReset().mockResolvedValue({ rows: [{ id: 1 }] });
});

describe("GET /:id/users — tenant user directory", () => {
    test("DEFAULT tenant is denied without an approved session", async () => {
        const res = await request(makeApp()).get("/api/admin/tenants/1/users");

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("TENANT_USER_DATA_RESTRICTED");
        // No tenant database was ever touched.
        expect(mockTenantQuery).not.toHaveBeenCalled();
    });

    test("customer tenant is denied without an approved session", async () => {
        mockTenant = CUSTOMER_TENANT;

        const res = await request(makeApp()).get("/api/admin/tenants/7/users");

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("TENANT_USER_DATA_RESTRICTED");
        expect(mockTenantQuery).not.toHaveBeenCalled();
    });

    test("DEFAULT tenant is allowed with an approved session, and the READ is audited", async () => {
        grantLiveSession(DEFAULT_TENANT.id);
        mockTenantQuery
            .mockResolvedValueOnce({ rows: [{ count: "2" }] })                       // COUNT(*)
            .mockResolvedValueOnce({ rows: [{ id: 1, username: "amal" }, { id: 2, username: "bea" }] });

        const res = await request(makeApp()).get("/api/admin/tenants/1/users");

        expect(res.status).toBe(200);
        expect(res.body.users).toHaveLength(2);

        // Access Transparency: reading tenant PII must leave an audit record.
        const readCall = mockLogPlatformAction.mock.calls
            .find((c: any[]) => c[1] === "platform_tenant_user_read");
        expect(readCall).toBeDefined();
        expect(readCall![5]).toBe(DEFAULT_TENANT.id);   // tenantId argument
    });

    test("another admin's live session does not grant this admin access", async () => {
        grantLiveSession(DEFAULT_TENANT.id, 999);

        const res = await request(makeApp()).get("/api/admin/tenants/1/users");

        expect(res.status).toBe(403);
        expect(mockTenantQuery).not.toHaveBeenCalled();
    });
});

describe("GET /:id/stats — platform facts vs tenant activity", () => {
    test("DEFAULT tenant hides activity metrics without a session, but keeps platform facts", async () => {
        mockTenantQuery.mockResolvedValue({ rows: [{ count: "5" }] });

        const res = await request(makeApp()).get("/api/admin/tenants/1/stats");

        expect(res.status).toBe(200);
        // Tenant-private: withheld.
        expect(res.body.activity_restricted).toBe(true);
        expect(res.body.task_count).toBeNull();
        expect(res.body.message_count).toBeNull();
        // Platform facts: still available — billing and limits depend on them.
        expect(res.body).toHaveProperty("user_count");
        expect(res.body).toHaveProperty("db_size_bytes");
    });

    test("activity metrics appear once a session is approved", async () => {
        grantLiveSession(DEFAULT_TENANT.id);
        mockTenantQuery.mockResolvedValue({ rows: [{ count: "5" }] });

        const res = await request(makeApp()).get("/api/admin/tenants/1/stats");

        expect(res.status).toBe(200);
        expect(res.body.activity_restricted).toBe(false);
        expect(res.body.task_count).toBe(5);
    });
});

describe("PUT /:tenantId/users/:userId/deactivate", () => {
    test("DEFAULT tenant mutation is denied without an approved session", async () => {
        const res = await request(makeApp()).put("/api/admin/tenants/1/users/3/deactivate");

        expect(res.status).toBe(403);
        expect(res.body.code).toBe("TENANT_USER_DATA_RESTRICTED");
        expect(mockTenantQuery).not.toHaveBeenCalled();
    });
});
