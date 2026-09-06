export {};

import express from "express";
const request = require("supertest");

let mockRole = "super_admin";
let mockTenantId: number | null = 7;
const mockMasterQuery = jest.fn();
const mockExpireStaleRequests = jest.fn();
const mockGetActiveSession = jest.fn();
const mockGenerateApprovalCode = jest.fn();
const mockHashApprovalCode = jest.fn();
const mockGetImpersonationPolicy = jest.fn();
const mockLogPlatformAction = jest.fn();
const mockSendToUser = jest.fn();
const mockBroadcast = jest.fn();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 11;
    req.username = "tenant-owner";
    req.tenantId = mockTenantId;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = mockRole;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../db", () => ({ masterQuery: (...args: any[]) => mockMasterQuery(...args) }));
jest.mock("../utils/impersonationApproval", () => ({
    generateApprovalCode: () => mockGenerateApprovalCode(),
    hashApprovalCode: (...args: any[]) => mockHashApprovalCode(...args),
    getImpersonationPolicy: () => mockGetImpersonationPolicy(),
    computeEffectiveStatus: (row: any) => row.status,
    expireStaleRequests: () => mockExpireStaleRequests(),
    getActiveSession: (...args: any[]) => mockGetActiveSession(...args),
}));
jest.mock("../utils/platformAudit", () => ({
    logPlatformAction: (...args: any[]) => mockLogPlatformAction(...args),
    updatePlatformAuditLog: jest.fn(),
}));
jest.mock("../utils/ws", () => ({
    sendToUser: (...args: any[]) => mockSendToUser(...args),
    broadcast: (...args: any[]) => mockBroadcast(...args),
}));
jest.mock("../utils/logger", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const platformAccessRoutes = require("../routes/platformAccess");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/platform-access", platformAccessRoutes);
    return app;
}

describe("platform access route characterization", () => {
    beforeEach(() => {
        mockRole = "super_admin";
        mockTenantId = 7;
        mockMasterQuery.mockReset();
        mockExpireStaleRequests.mockReset().mockResolvedValue(undefined);
        mockGetActiveSession.mockReset().mockResolvedValue(null);
        mockGenerateApprovalCode.mockReset().mockReturnValue("042731");
        mockHashApprovalCode.mockReset().mockResolvedValue("bcrypt-hash");
        mockGetImpersonationPolicy.mockReset().mockResolvedValue({ codeTtlMinutes: 15 });
        mockLogPlatformAction.mockReset().mockResolvedValue(undefined);
        mockSendToUser.mockReset();
        mockBroadcast.mockReset();
    });

    test("allows only tenant super admins and HR admins to manage consent", async () => {
        mockRole = "platform_admin";

        const res = await request(makeApp()).get("/api/platform-access");

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/super admins or HR admins/i);
        expect(mockMasterQuery).not.toHaveBeenCalled();
    });

    test("requires a tenant context before reading access requests", async () => {
        mockTenantId = null;

        const res = await request(makeApp()).get("/api/platform-access");

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Tenant context required." });
        expect(mockExpireStaleRequests).not.toHaveBeenCalled();
    });

    test("scopes and clamps the inbox while stripping approval hashes", async () => {
        mockMasterQuery.mockResolvedValue({
            rows: [{ id: 4, tenant_id: 7, status: "pending", approval_code_hash: "never-return-this" }],
            rowCount: 1,
        });
        mockGetActiveSession.mockResolvedValue({ id: 9, tenant_id: 7 });

        const res = await request(makeApp()).get("/api/platform-access?status=pending&limit=999&offset=-5");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({
            requests: [expect.objectContaining({ id: 4, tenant_id: 7, status: "pending" })],
            active_session: { id: 9, tenant_id: 7 },
        });
        expect(res.body.requests[0]).not.toHaveProperty("approval_code_hash");
        expect(mockExpireStaleRequests).toHaveBeenCalledTimes(1);
        expect(mockMasterQuery.mock.calls[0][1]).toEqual([7, "pending", 200, 0]);
        expect(mockGetActiveSession).toHaveBeenCalledWith(7);
    });

    test("returns an approval code once while persisting only its hash and auditing consent", async () => {
        mockMasterQuery
            .mockResolvedValueOnce({ rows: [{ id: 12, tenant_id: 7, requested_by: 81, status: "pending" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        const res = await request(makeApp()).post("/api/platform-access/12/approve");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ message: "Request approved.", approval_code: "042731" });
        expect(mockHashApprovalCode).toHaveBeenCalledWith("042731");
        expect(mockMasterQuery.mock.calls[0][1]).toEqual([12, 7]);
        expect(mockMasterQuery.mock.calls[1][1]).toEqual([11, "tenant-owner", "bcrypt-hash", expect.any(Date), 12]);
        expect(JSON.stringify(mockMasterQuery.mock.calls[1])).not.toContain("042731");
        expect(mockLogPlatformAction).toHaveBeenCalledWith(
            expect.objectContaining({ userId: 81 }),
            "tenant_access_request_approved",
            "tenant_access_request",
            12,
            expect.objectContaining({ approved_by_user_id: 11 }),
            7,
        );
        expect(mockSendToUser).toHaveBeenCalledWith(0, 81, "platform_access_request_approved", expect.objectContaining({ request_id: 12 }));
        expect(mockBroadcast).toHaveBeenCalledWith(7, "platform_access_request_updated", expect.objectContaining({ status: "approved" }));
    });
});