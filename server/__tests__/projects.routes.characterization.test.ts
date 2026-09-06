export {};

import express from "express";
const request = require("supertest");

let mockFeatureAllowed = true;
let mockOrgId: number | null = 3;
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
        req.userOrgId = mockOrgId;
        req.userRole = "manager";
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
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
jest.mock("../utils/audit", () => ({ logAction: (...args: any[]) => mockLogAction(...args) }));
jest.mock("../routes/tasks/_helpers/enrich", () => ({ enrichTasks: async (tasks: any[]) => tasks }));

const projectRoutes = require("../routes/projects");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/projects", projectRoutes);
    return app;
}

describe("project route characterization", () => {
    beforeEach(() => {
        mockFeatureAllowed = true;
        mockOrgId = 3;
        mockAuthCalls = 0;
        mockQuery.mockReset();
        mockTxQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
        mockTransaction.mockReset().mockImplementation(async (fn: any) => fn({ query: mockTxQuery }));
        mockLogAction.mockReset();
    });

    test("checks the Agile feature before authentication", async () => {
        mockFeatureAllowed = false;

        const res = await request(makeApp()).get("/api/projects");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ code: "FEATURE_NOT_AVAILABLE" });
        expect(mockAuthCalls).toBe(0);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("preserves the legacy plain-array list response", async () => {
        mockQuery.mockResolvedValue({ rows: [{ id: 1, key: "APP" }], rowCount: 1 });

        const res = await request(makeApp()).get("/api/projects");

        expect(res.status).toBe(200);
        expect(res.body).toEqual([{ id: 1, key: "APP" }]);
        expect(mockQuery.mock.calls[0][0]).toContain("p.is_archived = FALSE");
    });

    test("clamps paginated list limits and can include archived projects", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ total: 3 }], rowCount: 1 });

        const res = await request(makeApp()).get("/api/projects?paginate=1&include_archived=1&limit=999&offset=-7");

        expect(res.status).toBe(200);
        expect(res.body.pagination).toEqual({ limit: 200, offset: 0, total: 3, hasMore: true });
        expect(mockQuery.mock.calls[0][0]).not.toContain("p.is_archived = FALSE");
        expect(mockQuery.mock.calls[0][1]).toEqual([3, 200, 0]);
    });

    test("returns the established empty shape when no organization is assigned", async () => {
        mockOrgId = null;

        const legacy = await request(makeApp()).get("/api/projects");
        const paginated = await request(makeApp()).get("/api/projects?paginate=1");

        expect(legacy.body).toEqual([]);
        expect(paginated.body).toEqual({ projects: [], pagination: { limit: 0, offset: 0, total: 0, hasMore: false } });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("validates project name and key before querying", async () => {
        const missingName = await request(makeApp()).post("/api/projects").send({ key: "APP" });
        const invalidKey = await request(makeApp()).post("/api/projects").send({ key: "app", name: "Application" });

        expect(missingName.status).toBe(400);
        expect(invalidKey.status).toBe(400);
        expect(invalidKey.body.error).toMatch(/uppercase/i);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("refuses deletion of a project with tasks unless force is explicit", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [{ key: "APP" }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ c: 4 }], rowCount: 1 });

        const res = await request(makeApp()).delete("/api/projects/9");

        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ code: "PROJECT_NOT_EMPTY", task_count: 4 });
        expect(mockTransaction).not.toHaveBeenCalled();
    });
});