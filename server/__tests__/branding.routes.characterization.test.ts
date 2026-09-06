export {};

import express from "express";
const request = require("supertest");

const mockQuery = jest.fn();
const mockInvalidateBrandingCache = jest.fn();
const mockLogAction = jest.fn();
const mockBroadcast = jest.fn();
const mockStoragePut = jest.fn();
const mockStorageDelete = jest.fn();

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => {
    req.userId = 11;
    req.tenantId = 7;
    next();
});
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = "hr_admin";
        req.userOrgId = 3;
        next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (req: any, _res: any, next: any) => {
        req.tenant = { id: 7 };
        req.db = { query: mockQuery };
        next();
    },
}));
jest.mock("../utils/audit", () => ({ logAction: (...args: any[]) => mockLogAction(...args) }));
jest.mock("../utils/ws", () => ({ broadcast: (...args: any[]) => mockBroadcast(...args) }));
jest.mock("../utils/uploadPath", () => ({
    getUploadKey: (_tenant: number, _org: number, kind: string, filename: string) => `tenant_7/org_3/${kind}/${filename}`,
    getUploadUrl: (_tenant: number, _org: number, kind: string, filename: string) => `/uploads/tenant_7/org_3/${kind}/${filename}`,
    getKeyFromUrl: (url: string) => url?.startsWith("/uploads/") ? url.slice(9) : null,
}));
jest.mock("../platform/storage", () => ({
    getStorage: () => ({ put: mockStoragePut, delete: mockStorageDelete }),
    randomFilename: () => "logo_opaque.png",
}));
jest.mock("../utils/mailer", () => ({
    templates: { welcome: () => ({ subject: "Built in", body: "<p>Built in</p>" }) },
    TEMPLATE_KEYS: ["welcome"],
    TEMPLATE_PREVIEW_ARGS: { welcome: () => [] },
    applyBranding: (body: string) => `<main>${body}</main>`,
    invalidateBrandingCache: (...args: any[]) => mockInvalidateBrandingCache(...args),
    loadOrgBranding: jest.fn().mockResolvedValue({ accent_color: "#6366f1" }),
}));

const brandingRoutes = require("../routes/branding");

function makeApp() {
    const app = express();
    app.use(express.json());
    app.use("/api/branding", brandingRoutes);
    return app;
}

describe("branding route characterization", () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockInvalidateBrandingCache.mockReset();
        mockLogAction.mockReset();
        mockBroadcast.mockReset();
        mockStoragePut.mockReset();
        mockStorageDelete.mockReset();
    });

    test("returns stable defaults when the organization has no branding row", async () => {
        mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        const res = await request(makeApp()).get("/api/branding");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ logo_url: null, accent_color: "#6366f1", org_name: null, updated_at: null });
        expect(mockQuery.mock.calls[0][1]).toEqual([3]);
    });

    test("rejects an invalid accent before writing or broadcasting", async () => {
        const res = await request(makeApp()).put("/api/branding").send({ accent_color: "red" });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/#RRGGBB/);
        expect(mockQuery).not.toHaveBeenCalled();
        expect(mockBroadcast).not.toHaveBeenCalled();
    });

    test("normalizes a valid accent, invalidates cache and broadcasts the change", async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ logo_url: null, accent_color: "#aabbcc", updated_at: "now" }], rowCount: 1 });

        const res = await request(makeApp()).put("/api/branding").send({ accent_color: "#AABBCC" });

        expect(res.status).toBe(200);
        expect(res.body.accent_color).toBe("#aabbcc");
        expect(mockQuery.mock.calls[0][1]).toEqual([3, "#aabbcc", 11]);
        expect(mockInvalidateBrandingCache).toHaveBeenCalledWith(7, 3);
        expect(mockLogAction).toHaveBeenCalledWith(expect.anything(), "update", "org_branding", 3, { accent_color: "#AABBCC" });
        expect(mockBroadcast).toHaveBeenCalledWith(7, "branding_changed", { orgId: 3 });
    });

    test("requires a multipart logo file before touching storage", async () => {
        const res = await request(makeApp()).post("/api/branding/logo");

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "No file uploaded" });
        expect(mockStoragePut).not.toHaveBeenCalled();
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("rejects unknown email template keys before querying", async () => {
        const res = await request(makeApp())
            .put("/api/branding/email-templates/unknown")
            .send({ subject: "Subject", body_html: "<p>Body</p>" });

        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: "Unknown template key. Allowed: welcome" });
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test("renders a draft preview without persisting it", async () => {
        const res = await request(makeApp())
            .post("/api/branding/email-templates/welcome/preview")
            .send({ subject: "Draft", body_html: "<p>Draft body</p>" });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ subject: "Draft", html: "<main><p>Draft body</p></main>" });
        expect(mockQuery).not.toHaveBeenCalled();
    });
});