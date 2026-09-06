export {};

import express from "express";
const request = require("supertest");

let mockRole = "employee";
let mockOrgId: number | null = 3;
let mockFeatureAllowed = true;
const mockQuery = jest.fn();
const mockEncrypt = jest.fn((value: string) => `encrypted:${value}`);
const mockDecrypt = jest.fn((value: string) => value.replace(/^encrypted:/, ""));
const mockMaskAccountNumber = jest.fn((value: string) => `****${value.slice(-4)}`);

const levels: Record<string, number> = { employee: 1, team_lead: 2, manager: 3, hr_admin: 4, super_admin: 5, platform_admin: 6 };

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 11;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = mockRole;
        req.userOrgId = mockOrgId;
        next();
    },
    requireRole: (required: string) => (req: any, res: any, next: any) => {
        if ((levels[req.userRole] || 0) < levels[required]) return res.status(403).json({ error: "Insufficient permissions" });
        next();
    },
    getVisibleUserIds: jest.fn(),
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (req: any, _res: any, next: any) => {
        req.tenant = { id: 7 };
        req.db = { query: mockQuery };
        next();
    },
    requireFeature: () => (_req: any, res: any, next: any) => {
        if (!mockFeatureAllowed) return res.status(403).json({ code: "FEATURE_NOT_AVAILABLE" });
        next();
    },
}));
jest.mock("../utils/attendance", () => ({ calculateAttendance: jest.fn() }));
jest.mock("../utils/encryption", () => ({
    encrypt: (value: string) => mockEncrypt(value),
    decrypt: (value: string) => mockDecrypt(value),
    maskAccountNumber: (value: string) => mockMaskAccountNumber(value),
}));
jest.mock("../utils/salarySlipPdf", () => ({ sendSalarySlipPDF: jest.fn() }));
jest.mock("../services/razorpayPayout", () => ({ getPayoutService: jest.fn() }));
jest.mock("../utils/logger", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const compensationRoutes = require("../routes/compensation");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/compensation", compensationRoutes);
    return app;
}

describe("compensation route characterization", () => {
    beforeEach(() => {
        mockRole = "employee";
        mockOrgId = 3;
        mockFeatureAllowed = true;
        mockQuery.mockReset();
        mockEncrypt.mockClear();
        mockDecrypt.mockClear();
        mockMaskAccountNumber.mockClear();
    });

    test("gates the entire route behind the payroll feature", async () => {
        mockFeatureAllowed = false;

        const res = await request(makeApp()).get("/api/compensation/my-slips");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ code: "FEATURE_NOT_AVAILABLE" });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("keeps employee compensation administration HR-only", async () => {
        const res = await request(makeApp()).get("/api/compensation/employees");

        expect(res.status).toBe(403);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("limits employee salary-slip lists to their own published records", async () => {
        mockQuery.mockResolvedValue({ rows: [{ id: 5, user_id: 11, status: "published" }] });

        const res = await request(makeApp()).get("/api/compensation/salary-slips?user_id=99&status=draft");

        expect(res.status).toBe(200);
        expect(mockQuery.mock.calls[0][0]).toContain("ss.user_id = $2 AND ss.status = 'published'");
        expect(mockQuery.mock.calls[0][1]).toEqual([3, 11]);
    });

    test("denies an employee access to another user's salary slip", async () => {
        mockQuery.mockResolvedValue({ rows: [{ id: 5, user_id: 99, org_id: 3, status: "published" }] });

        const res = await request(makeApp()).get("/api/compensation/salary-slips/5");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Access denied" });
        expect(mockQuery.mock.calls[0][1]).toEqual(["5", 3]);
    });

    test("masks payment credentials instead of returning stored secrets", async () => {
        mockRole = "hr_admin";
        mockQuery.mockResolvedValue({
            rows: [{ id: 2, api_key_id: "encrypted:key_123456", api_key_secret: "encrypted:secret", webhook_secret: "encrypted:hook" }],
        });

        const res = await request(makeApp()).get("/api/compensation/payment-config");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ api_key_id: "****3456", api_key_secret: "********", webhook_secret: "********" });
        expect(res.body.api_key_secret).not.toContain("secret");
        expect(res.body.webhook_secret).not.toContain("hook");
    });

    test("rejects employee access to another user's bank details before querying", async () => {
        const res = await request(makeApp()).get("/api/compensation/bank-details/99");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Access denied" });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("encrypts self-service bank account numbers before persistence", async () => {
        mockQuery.mockResolvedValue({ rows: [], rowCount: 1 });

        const res = await request(makeApp()).post("/api/compensation/my-bank-details").send({
            account_holder_name: "A Reporter",
            account_number: "1234567890",
            ifsc_code: "BANK0001234",
        });

        expect(res.status).toBe(200);
        expect(mockEncrypt).toHaveBeenCalledWith("1234567890");
        expect(mockQuery.mock.calls[0][1]).toEqual([11, 3, "A Reporter", "encrypted:1234567890", "BANK0001234", null, "savings"]);
        expect(JSON.stringify(mockQuery.mock.calls[0][1])).not.toContain('"1234567890"');
    });
});