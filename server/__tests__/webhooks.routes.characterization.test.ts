export {};

import crypto from "crypto";
import express from "express";
const request = require("supertest");

const masterQuery = jest.fn();
const tenantQuery = jest.fn();
const getTenantPool = jest.fn();
const isFeatureEnabled = jest.fn();

jest.mock("../db", () => ({
    masterQuery,
    masterTransaction: jest.fn(),
}));
jest.mock("../utils/tenantManager", () => ({ getTenantPool }));
jest.mock("../utils/planCatalog", () => ({ isFeatureEnabled }));
jest.mock("../utils/logger", () => ({
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const webhookRoutes = require("../routes/webhooks");

function makeApp() {
    const app = express();
    app.use("/api/webhooks", webhookRoutes);
    return app;
}

function signedPing(secret: string) {
    const body = JSON.stringify({ zen: "test" });
    const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
    return { body, signature };
}

function resolveTenantIntegration({ featureEnabled = true, secret = "hook-secret" } = {}) {
    masterQuery
        .mockResolvedValueOnce({ rows: [{ id: 7, slug: "acme", db_name: "wp_acme", db_host: null }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ plan: "enterprise", features: {}, status: "active" }], rowCount: 1 });
    tenantQuery
        .mockResolvedValueOnce({ rows: [{ id: 42, org_id: 3 }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: secret ? [{ webhook_secret: secret }] : [], rowCount: secret ? 1 : 0 });
    getTenantPool.mockResolvedValue({ query: tenantQuery, transaction: jest.fn() });
    isFeatureEnabled.mockReturnValue(featureEnabled);
}

describe("GitHub webhook characterization", () => {
    beforeEach(() => {
        masterQuery.mockReset();
        tenantQuery.mockReset();
        getTenantPool.mockReset();
        isFeatureEnabled.mockReset();
    });

    test("rejects a malformed integration id inside the webhook router", async () => {
        const res = await request(makeApp()).post("/api/webhooks/github/not-a-number").send("{}");

        expect(res.status).toBe(400);
        expect(res.text).toBe("Invalid integration id");
        expect(masterQuery).not.toHaveBeenCalled();
    });

    test("returns 404 when no tenant owns the integration", async () => {
        masterQuery
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce({ rows: [], rowCount: 0 });

        const res = await request(makeApp()).post("/api/webhooks/github/42").send("{}");

        expect(res.status).toBe(404);
        expect(res.text).toBe("Integration not found");
    });

    test("returns 410 before secret lookup when the tenant plan disables webhooks", async () => {
        resolveTenantIntegration({ featureEnabled: false });

        const res = await request(makeApp()).post("/api/webhooks/github/42").send("{}");

        expect(res.status).toBe(410);
        expect(res.text).toMatch(/not enabled/i);
        expect(tenantQuery).toHaveBeenCalledTimes(1);
    });

    test("rejects an invalid GitHub signature", async () => {
        resolveTenantIntegration();

        const res = await request(makeApp())
            .post("/api/webhooks/github/42")
            .set("Content-Type", "application/json")
            .set("X-GitHub-Event", "ping")
            .set("X-Hub-Signature-256", "sha256=invalid")
            .send(JSON.stringify({ zen: "test" }));

        expect(res.status).toBe(401);
        expect(res.text).toBe("Invalid signature");
    });

    test("acknowledges a correctly signed GitHub ping without CSRF headers", async () => {
        resolveTenantIntegration();
        const { body, signature } = signedPing("hook-secret");

        const res = await request(makeApp())
            .post("/api/webhooks/github/42")
            .set("Content-Type", "application/json")
            .set("X-GitHub-Event", "ping")
            .set("X-Hub-Signature-256", signature)
            .send(body);

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ ok: true, pong: true });
        expect(isFeatureEnabled).toHaveBeenCalledWith(expect.objectContaining({ plan: "enterprise" }), "webhooks");
    });
});