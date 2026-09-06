export {};

import express from "express";
const request = require("supertest");

let mockFeatureAllowed = true;
let mockRole = "employee";
let mockAuthCalls = 0;
const mockQuery = jest.fn();
const mockTransaction = jest.fn();
const mockTxQuery = jest.fn();
const mockLogAction = jest.fn();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    mockAuthCalls++;
    req.userId = 11;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = mockRole;
        req.userOrgId = 3;
        next();
    },
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (req: any, _res: any, next: any) => {
        req.tenant = { id: 7, plan: "enterprise" };
        req.tenantId = 7;
        req.db = { query: mockQuery, transaction: mockTransaction };
        next();
    },
    requireFeature: () => (_req: any, res: any, next: any) => {
        if (!mockFeatureAllowed) return res.status(403).json({ code: "FEATURE_NOT_AVAILABLE" });
        next();
    },
}));
jest.mock("../middleware/agileEditor", () => ({
    isAgileEditorRole: (role: string) => ["super_admin", "hr_admin", "manager", "team_lead", "scrum_master"].includes(role),
}));
jest.mock("../utils/audit", () => ({ logAction: (...args: any[]) => mockLogAction(...args) }));

const customFieldsRoutes = require("../routes/customFields");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/custom-fields", customFieldsRoutes);
    return app;
}

describe("custom-field route characterization", () => {
    beforeEach(() => {
        mockFeatureAllowed = true;
        mockRole = "employee";
        mockAuthCalls = 0;
        mockQuery.mockReset();
        mockTxQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn({ query: mockTxQuery }));
        mockLogAction.mockReset();
    });

    test("checks the subscription feature before authentication", async () => {
        mockFeatureAllowed = false;

        const res = await request(makeApp()).get("/api/custom-fields");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ code: "FEATURE_NOT_AVAILABLE" });
        expect(mockAuthCalls).toBe(0);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("allows employees to list active definitions", async () => {
        mockQuery.mockResolvedValue({ rows: [{ id: 1, key: "customer_tier", is_active: true }], rowCount: 1 });

        const res = await request(makeApp()).get("/api/custom-fields");

        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: 1, key: "customer_tier", is_active: true }]);
        expect(mockQuery.mock.calls[0][0]).toContain("is_active = TRUE");
    });

    test("blocks employees from the administrative definition list", async () => {
        const res = await request(makeApp()).get("/api/custom-fields/all");

        expect(res.status).toBe(403);
        expect(res.body.error).toMatch(/Insufficient permissions/i);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("validates create input before querying", async () => {
        mockRole = "manager";

        const missingLabel = await request(makeApp()).post("/api/custom-fields").send({ field_type: "text" });
        const invalidType = await request(makeApp()).post("/api/custom-fields").send({ label: "Tier", field_type: "script" });

        expect(missingLabel.status).toBe(400);
        expect(invalidType.status).toBe(400);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("normalizes a select definition and appends it to the existing order", async () => {
        mockRole = "manager";
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [{ m: 2 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 9, key: "customer_tier", label: "Customer Tier", field_type: "select" }], rowCount: 1 });

        const res = await request(makeApp()).post("/api/custom-fields").send({
            label: " Customer Tier ",
            field_type: "select",
            options: ["Gold", { value: "silver", label: "Silver" }, ""],
            applies_to_types: ["4", -1, "bad"],
            is_required: true,
        });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ id: 9, key: "customer_tier" });
        const insertParams = mockQuery.mock.calls[2][1];
        expect(insertParams[0]).toBe(3);
        expect(insertParams[1]).toBe("customer_tier");
        expect(JSON.parse(insertParams[5])).toEqual([
            { value: "Gold", label: "Gold" },
            { value: "silver", label: "Silver" },
        ]);
        expect(JSON.parse(insertParams[8])).toEqual([4]);
        expect(insertParams[9]).toBe(3);
        expect(mockLogAction).toHaveBeenCalledWith(expect.anything(), "create", "custom_field", 9, expect.objectContaining({ key: "customer_tier" }));
    });

    test("routes /reorder to the static handler and updates positions transactionally", async () => {
        mockRole = "manager";
        mockQuery.mockResolvedValueOnce({ rows: [{ id: 8 }, { id: 4 }], rowCount: 2 });

        const res = await request(makeApp()).put("/api/custom-fields/reorder").send({ order: [8, "4", "bad"] });

        expect(res.status).toBe(200);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockTxQuery.mock.calls.map((call) => call[1])).toEqual([[1, 8, 3], [2, 4, 3]]);
        expect(mockQuery.mock.calls[0][0]).toContain("ORDER BY sort_order");
    });

    test("rejects invalid task identifiers before accessibility queries", async () => {
        const res = await request(makeApp()).get("/api/custom-fields/task/not-a-number");

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Invalid task id" });
        expect(mockQuery).not.toHaveBeenCalled();
    });
});