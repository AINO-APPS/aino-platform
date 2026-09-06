export {};

import express from "express";
const request = require("supertest");

let mockFeatureAllowed = true;
let mockAuthCalls = 0;
const mockQuery = jest.fn();
const mockGithub = {
    isConfigured: jest.fn(),
    consumeState: jest.fn(),
    callbackUrl: jest.fn(() => "https://app.example/api/integrations/github/oauth/callback"),
    issueState: jest.fn(),
    buildAuthorizeUrl: jest.fn(),
    exchangeCodeForToken: jest.fn(),
    getViewer: jest.fn(),
    listAccessibleRepos: jest.fn(),
    installWebhook: jest.fn(),
    deleteWebhook: jest.fn(),
};

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    mockAuthCalls++;
    req.userId = 11;
    req.tenantId = 7;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userOrgId = 3;
        req.userRole = "manager";
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (req: any, _res: any, next: any) => {
        req.tenant = { id: 7, plan: "enterprise" };
        req.db = { query: mockQuery, transaction: jest.fn() };
        next();
    },
    requireFeature: () => (_req: any, res: any, next: any) => {
        if (!mockFeatureAllowed) return res.status(403).json({ code: "FEATURE_NOT_AVAILABLE" });
        next();
    },
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
jest.mock("../services/github", () => mockGithub);

const integrationRoutes = require("../routes/integrations");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/integrations", integrationRoutes);
    return app;
}

describe("integration route characterization", () => {
    beforeEach(() => {
        mockFeatureAllowed = true;
        mockAuthCalls = 0;
        mockQuery.mockReset();
        Object.values(mockGithub).forEach((fn) => fn.mockReset());
        mockGithub.callbackUrl.mockReturnValue("https://app.example/api/integrations/github/oauth/callback");
    });

    test("keeps the OAuth callback outside tenant and feature middleware", async () => {
        mockFeatureAllowed = false;
        mockGithub.isConfigured.mockReturnValue(true);

        const res = await request(makeApp()).get("/api/integrations/github/oauth/callback");

        expect(res.status).toBe(400);
        expect(res.text).toBe("Missing code or state");
        expect(mockAuthCalls).toBe(0);
    });

    test("returns a clear OAuth configuration error", async () => {
        mockGithub.isConfigured.mockReturnValue(false);

        const res = await request(makeApp()).get("/api/integrations/github/oauth/callback?code=x&state=y");

        expect(res.status).toBe(500);
        expect(res.text).toMatch(/not configured/i);
        expect(mockGithub.consumeState).not.toHaveBeenCalled();
    });

    test("rejects expired or already-consumed OAuth state", async () => {
        mockGithub.isConfigured.mockReturnValue(true);
        mockGithub.consumeState.mockResolvedValue(null);

        const res = await request(makeApp()).get("/api/integrations/github/oauth/callback?code=x&state=expired");

        expect(res.status).toBe(400);
        expect(res.text).toMatch(/expired or already used/i);
    });

    test("checks the webhooks feature before authentication on management routes", async () => {
        mockFeatureAllowed = false;

        const res = await request(makeApp()).get("/api/integrations");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ code: "FEATURE_NOT_AVAILABLE" });
        expect(mockAuthCalls).toBe(0);
    });

    test("lists only secret-presence flags and public GitHub identity", async () => {
        mockQuery.mockResolvedValue({
            rows: [{
                id: 4,
                provider: "github",
                config: { owner: "AINO-APPS" },
                is_active: true,
                has_webhook_secret: true,
                has_access_token: true,
                github_login: "operator",
                github_avatar: "avatar",
                scopes: ["repo"],
            }],
            rowCount: 1,
        });

        const res = await request(makeApp()).get("/api/integrations");

        expect(res.status).toBe(200);
        expect(res.body[0]).toMatchObject({ has_webhook_secret: true, has_access_token: true, github_login: "operator" });
        expect(res.body[0]).not.toHaveProperty("access_token");
        expect(res.body[0]).not.toHaveProperty("webhook_secret");
        expect(mockQuery.mock.calls[0][0]).not.toMatch(/s\.access_token\s*(?:,|FROM)/i);
        expect(mockQuery.mock.calls[0][0]).not.toMatch(/s\.webhook_secret\s*(?:,|FROM)/i);
    });

    test("returns disconnected status when no GitHub integration exists", async () => {
        mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        const res = await request(makeApp()).get("/api/integrations/github/status");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ connected: false });
    });

    test("rejects an empty repository selection before database access", async () => {
        const res = await request(makeApp()).post("/api/integrations/github/repos/connect").send({ repos: [] });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/non-empty array/i);
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("requires a connected GitHub account before listing repositories", async () => {
        mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        const res = await request(makeApp()).get("/api/integrations/github/repos");

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Connect a GitHub account first." });
        expect(mockGithub.listAccessibleRepos).not.toHaveBeenCalled();
    });
});