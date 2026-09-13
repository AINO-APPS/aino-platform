export {};

import express from "express";
const request = require("supertest");

let mockIsPlatformUser = true;
let mockTenantId: number | null = null;
let mockRole = "platform_admin";
const mockMasterQuery = jest.fn();
const mockCreateTenant = jest.fn();
const mockLogPlatformAction = jest.fn();
const mockLoadPlanCatalog = jest.fn();

const levels: Record<string, number> = { employee: 1, hr_admin: 4, super_admin: 5, platform_admin: 6 };

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 41;
    req.username = "platform-operator";
    req.isPlatformUser = mockIsPlatformUser;
    req.tenantId = mockTenantId;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = mockRole;
        next();
    },
    requireRole: (required: string) => (req: any, res: any, next: any) => {
        if ((levels[req.userRole] || 0) < levels[required]) return res.status(403).json({ error: "Insufficient permissions" });
        next();
    },
}));
jest.mock("../db", () => ({ masterQuery: (...args: any[]) => mockMasterQuery(...args) }));
jest.mock("../utils/tenantManager", () => ({
    createTenant: (...args: any[]) => mockCreateTenant(...args),
    deleteTenant: jest.fn(),
    suspendTenant: jest.fn(),
    reactivateTenant: jest.fn(),
    getTenantById: jest.fn(),
    getTenantPool: jest.fn(),
    getPoolStats: jest.fn(() => ({})),
    listActiveTenants: jest.fn(),
}));
jest.mock("../utils/platformAudit", () => ({
    logPlatformAction: (...args: any[]) => mockLogPlatformAction(...args),
    updatePlatformAuditLog: jest.fn(),
    queryPlatformLogs: jest.fn(),
}));
jest.mock("../redis", () => ({}));
jest.mock("../middleware/impersonationAudit", () => ({ startSession: jest.fn(), getSession: jest.fn(), endSession: jest.fn() }));
jest.mock("../utils/cookie", () => ({ cookieOptions: jest.fn(() => ({})) }));
jest.mock("../utils/planCatalog", () => ({
    PLANS: {},
    PLAN_KEYS: ["standard", "enterprise"],
    FEATURE_LABELS: { meetings: "Meetings" },
    FEATURE_KEYS: ["meetings"],
    DEFAULT_PLANS: { standard: {} },
    getEffectiveFeatures: jest.fn(),
    getPlanLimits: jest.fn(),
    sanitizeFeatureOverrides: jest.fn(),
    planFeatureDiff: jest.fn(),
    loadPlanCatalog: (...args: any[]) => mockLoadPlanCatalog(...args),
    savePlanCatalog: jest.fn(),
    getPlans: jest.fn(),
}));
jest.mock("../utils/impersonationApproval", () => ({
    generateApprovalCode: jest.fn(), hashApprovalCode: jest.fn(), verifyApprovalCode: jest.fn(),
    getImpersonationPolicy: jest.fn(), updateImpersonationPolicy: jest.fn(), computeEffectiveStatus: jest.fn(),
    expireStaleRequests: jest.fn(), getActiveSession: jest.fn(), hasTenantDataConsent: jest.fn(),
    getOrCreateInspectorUser: jest.fn(),
}));
jest.mock("../utils/platformConfig", () => ({ getPlatformConfig: jest.fn(), updatePlatformConfig: jest.fn() }));
jest.mock("../middleware/maintenanceMode", () => ({ invalidateMaintenanceCache: jest.fn() }));
jest.mock("../services/tenantStorageUsage", () => ({ tenantStorageStatsFields: jest.fn(() => "") }));
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

describe("tenant management route characterization", () => {
    beforeEach(() => {
        mockIsPlatformUser = true;
        mockTenantId = null;
        mockRole = "platform_admin";
        mockMasterQuery.mockReset();
        mockCreateTenant.mockReset();
        mockLogPlatformAction.mockReset().mockResolvedValue(undefined);
        mockLoadPlanCatalog.mockReset();
    });

    test("rejects a tenant identity even when its role is named platform_admin", async () => {
        mockIsPlatformUser = false;
        mockTenantId = 7;

        const res = await request(makeApp()).get("/api/admin/tenants");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({
            error: "A tenantless platform administrator identity is required",
            code: "PLATFORM_IDENTITY_REQUIRED",
        });
        expect(mockMasterQuery).not.toHaveBeenCalled();
    });

    test("rejects non-platform roles before platform identity evaluation reaches a handler", async () => {
        mockRole = "employee";

        const res = await request(makeApp()).get("/api/admin/tenants");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Insufficient permissions" });
        expect(mockMasterQuery).not.toHaveBeenCalled();
    });

    test("validates tenant creation before provisioning", async () => {
        const missing = await request(makeApp()).post("/api/admin/tenants").send({ slug: "acme" });
        const invalidSlug = await request(makeApp()).post("/api/admin/tenants").send({ org_name: "Acme", slug: "Bad_Slug" });
        const invalidPlan = await request(makeApp()).post("/api/admin/tenants").send({ org_name: "Acme", slug: "acme-inc", plan: "unlimited" });

        expect(missing.status).toBe(400);
        expect(invalidSlug.status).toBe(400);
        expect(invalidPlan.status).toBe(400);
        expect(invalidPlan.body.error).toMatch(/standard, enterprise/);
        expect(mockCreateTenant).not.toHaveBeenCalled();
    });

    test("creates only the tenant with stable defaults and writes a platform audit event", async () => {
        mockCreateTenant.mockResolvedValue({ tenant: { id: 17, org_name: "Acme", slug: "acme-inc", plan: "standard" } });

        const res = await request(makeApp()).post("/api/admin/tenants").send({ org_name: "Acme", slug: "acme-inc" });

        expect(res.status).toBe(201);
        expect(res.body.tenant).toMatchObject({ id: 17, slug: "acme-inc", plan: "standard" });
        expect(mockCreateTenant).toHaveBeenCalledWith({
            orgName: "Acme", slug: "acme-inc", plan: "standard", features: {}, maxUsers: null, maxStorageMb: null,
        });
        expect(mockLogPlatformAction).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 41 }), "tenant_created", "tenant", 17,
            { slug: "acme-inc", org_name: "Acme" }, 17,
        );
        expect(mockMasterQuery).not.toHaveBeenCalled();
    });

    test("keeps the literal plan-catalog route ahead of the tenant id route", async () => {
        mockLoadPlanCatalog.mockResolvedValue({ standard: { name: "Standard" } });

        const res = await request(makeApp()).get("/api/admin/tenants/plan-catalog");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            plans: { standard: { name: "Standard" } },
            feature_labels: { meetings: "Meetings" },
            feature_keys: ["meetings"],
        });
        expect(mockLoadPlanCatalog).toHaveBeenCalledTimes(1);
    });

    test("requires platform_owner for linked-principal management", async () => {
        mockMasterQuery.mockResolvedValueOnce({ rows: [{ platform_role: "platform_operator" }], rowCount: 1 });
        const res = await request(makeApp()).get("/api/admin/tenants/platform-users/9/links");
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("PLATFORM_OWNER_REQUIRED");
    });

    test("platform_owner can list a platform user's linked tenant principals", async () => {
        mockMasterQuery
            .mockResolvedValueOnce({ rows: [{ platform_role: "platform_owner" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ platform_user_id: 9, tenant_id: 1, tenant_user_id: 2, org_name: "AINO" }], rowCount: 1 });
        const res = await request(makeApp()).get("/api/admin/tenants/platform-users/9/links");
        expect(res.status).toBe(200);
        expect(res.body.links).toEqual([expect.objectContaining({ tenant_id: 1, tenant_user_id: 2 })]);
    });

    test("creates a master-backed global announcement", async () => {
        const row = { id: 12, message: "Global notice", type: "urgent", is_active: true };
        mockMasterQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

        const res = await request(makeApp())
            .post("/api/admin/tenants/announcements")
            .send({ message: "Global notice", type: "urgent", duration: 24 });

        expect(res.status).toBe(201);
        expect(res.body.data).toEqual(row);
        expect(mockMasterQuery.mock.calls[0][0]).toContain("INSERT INTO platform_announcements");
        expect(mockLogPlatformAction).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 41 }), "create_announcement", "platform_announcement", 12,
            { type: "urgent" },
        );
    });

    test("rejects administrative self password reset", async () => {
        const res = await request(makeApp())
            .post("/api/admin/tenants/platform-users/41/reset-password")
            .send({ new_password: "NewPassword1!" });

        expect(res.status).toBe(400);
        expect(res.body.code).toBe("SELF_PASSWORD_RESET_DENIED");
        expect(mockMasterQuery).not.toHaveBeenCalled();
    });

    test("rejects platform-admin self deactivation", async () => {
        const res = await request(makeApp())
            .put("/api/admin/tenants/platform-users/41/deactivate");

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/yourself/i);
        expect(mockMasterQuery).not.toHaveBeenCalled();
    });
});