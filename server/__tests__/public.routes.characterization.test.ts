export {};

import express from "express";
const request = require("supertest");

const masterQuery = jest.fn();
const getTenantPool = jest.fn();
const storageGet = jest.fn();
const storageStat = jest.fn();

jest.mock("../db", () => ({ masterQuery }));
jest.mock("../utils/tenantManager", () => ({
    getTenantById: jest.fn(),
    getTenantPool,
}));
jest.mock("../platform/storage", () => ({
    getStorage: () => ({ get: storageGet, stat: storageStat }),
    urlToKey: (url: string) => url.startsWith("/uploads/") ? url.slice("/uploads/".length) : null,
}));
jest.mock("../utils/logger", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const publicRoutes = require("../routes/public");

function makeApp(context?: Record<string, unknown>) {
    const app = express();
    app.use((req: any, _res, next) => {
        req.log = { warn: jest.fn(), error: jest.fn() };
        Object.assign(req, context || {});
        next();
    });
    app.use("/api/public", publicRoutes);
    return app;
}

describe("public route characterization", () => {
    beforeEach(() => {
        masterQuery.mockReset();
        getTenantPool.mockReset();
        storageGet.mockReset();
        storageStat.mockReset();
    });

    test("serves the public plan catalog with a five-minute cache policy", async () => {
        const res = await request(makeApp()).get("/api/public/plan-catalog");

        expect(res.status).toBe(200);
        expect(res.headers["cache-control"]).toBe("public, max-age=300");
        expect(res.body.plans).toEqual(expect.objectContaining({ standard: expect.any(Object), enterprise: expect.any(Object) }));
        expect(res.body.feature_labels).toEqual(expect.objectContaining({ attendance: expect.any(String) }));
    });

    test("returns empty branding on the default domain without a slug", async () => {
        const res = await request(makeApp()).get("/api/public/branding");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ logo_url: null, accent_color: null, org_name: null });
        expect(masterQuery).not.toHaveBeenCalled();
    });

    test("uses the already-resolved tenant database for branding", async () => {
        const tenantQuery = jest.fn().mockResolvedValue({
            rows: [{ logo_url: "/uploads/tenant_7/logo.svg", accent_color: "#123456", org_name: "Acme" }],
            rowCount: 1,
        });
        const res = await request(makeApp({ tenant: { id: 7 }, db: { query: tenantQuery }, isMasterRoute: false }))
            .get("/api/public/branding");

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ logo_url: "/uploads/tenant_7/logo.svg", accent_color: "#123456", org_name: "Acme" });
        expect(tenantQuery).toHaveBeenCalledTimes(1);
        expect(masterQuery).not.toHaveBeenCalled();
    });

    test("rejects malformed share tokens before querying the master database", async () => {
        const res = await request(makeApp()).get("/api/public/notes/short");

        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: "Not found" });
        expect(masterQuery).not.toHaveBeenCalled();
    });

    test("returns 403 rather than proxying an external branding URL", async () => {
        const tenantQuery = jest.fn().mockResolvedValue({
            rows: [{ logo_url: "https://untrusted.example/logo.svg" }],
            rowCount: 1,
        });
        const res = await request(makeApp({ tenant: { id: 7 }, db: { query: tenantQuery }, isMasterRoute: false }))
            .get("/api/public/branding/logo");

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ error: "Forbidden" });
        expect(storageGet).not.toHaveBeenCalled();
    });
});