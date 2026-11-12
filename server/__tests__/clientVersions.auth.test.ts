export {};
const observe = jest.fn().mockResolvedValue(undefined);
jest.mock("../modules/clientVersions/clientVersions", () => ({ clientVersions: { observe } }));
jest.mock("../redis", () => ({ getTokenVersion: jest.fn(async () => 0), setTokenVersion: jest.fn() }));
jest.mock("../db", () => ({ masterQuery: jest.fn() }));
const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const auth = require("../middleware/auth");
const { createClientVersionGate } = require("../modules/clientVersions/clientVersions.middleware");

test("only fully validated authentication observes usage; forged and revoked sessions never count", async () => {
    const app = express();
    let active = true;
    app.use(createClientVersionGate(() => ({ mode: "report", minimums: {} })));
    app.use((req: any, _res: any, next: any) => {
        req.db = { query: jest.fn(async () => ({ rows: active ? [{}] : [] })) };
        next();
    });
    app.use(auth);
    app.use((_req: any, res: any) => res.sendStatus(200));
    const token = jwt.sign({ id: 7, tenant_id: 3, sid: "session-a", aud: "tenant", cli: "mobile" }, process.env.JWT_SECRET);
    expect((await request(app).get("/api/tasks").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    expect(observe).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 7, tenantId: 3, sessionId: "session-a" }),
        { client: "android", version: "0" },
    );
    observe.mockClear();
    const forged = jwt.sign({ id: 7, tenant_id: 3, aud: "tenant", cli: "mobile" }, "wrong-secret");
    expect((await request(app).get("/api/tasks").set("Authorization", `Bearer ${forged}`)).status).toBe(401);
    active = false;
    expect((await request(app).get("/api/tasks").set("Authorization", `Bearer ${token}`)).status).toBe(401);
    expect(observe).not.toHaveBeenCalled();
    active = true;
    observe.mockRejectedValueOnce(new Error("report store unavailable"));
    expect((await request(app).get("/api/tasks").set("Authorization", `Bearer ${token}`)).status).toBe(200);
});
