import express from "express";
import request from "supertest";
import { createClientVersionGate } from "../modules/clientVersions/clientVersions.middleware";
import { readClientVersionConfig } from "../modules/clientVersions/clientVersions.config";
import { createClientVersionRoutes } from "../modules/clientVersions/clientVersions.routes";
import requirePlatformIdentity from "../middleware/platformIdentity";
import { installCors } from "../http/middleware/cors";

describe("client version HTTP boundary (miniExpress, no database)", () => {
    test("cross-origin first-party preflight permits both client identity headers", async () => {
        const app = express();
        installCors(app);
        const response = await request(app).options("/api/tasks")
            .set("Origin", "http://localhost:3000")
            .set("Access-Control-Request-Headers", "X-AINO-Client, X-AINO-Client-Version");
        expect(response.status).toBe(204);
        const allowed = response.headers["access-control-allow-headers"].toLowerCase();
        expect(allowed).toContain("x-aino-client-version");
        expect(allowed).toContain("x-aino-client");
    });
    test("report identifies first-party and legacy clients without refusing any version", async () => {
        const app = express();
        app.use(createClientVersionGate(() => ({
            mode: "report", minimums: { android: "0.30.0", desktop: "3.0.80", web: "3.0.80" },
        })));
        app.use((req, res) => res.json({ observation: (req as any).clientVersionObservation ?? null }));
        const web = await request(app).get("/api/tasks").set("X-AINO-Client", "web").set("X-AINO-Client-Version", "3.0.79");
        expect(web.status).toBe(200);
        expect(web.body.observation).toEqual({ client: "web", version: "3.0.79" });
        expect((await request(app).get("/api/tasks").set("Authorization", "Bearer invalid")).body.observation)
            .toEqual({ client: "android", version: "0" });
        expect((await request(app).get("/api/tasks").set("Origin", "workpulse://app")).body.observation)
            .toEqual({ client: "desktop", version: "0" });
        expect((await request(app).get("/api/tasks").set("X-AINO-Client", "integration").set("Authorization", "Bearer invalid")).body.observation).toBeNull();
        expect((await request(app).get("/api/tasks")).body.observation).toBeNull();
    });

    test("public config is available before authentication; OFF is safe and enforce cannot be enabled", async () => {
        expect(readClientVersionConfig({})).toEqual({
            mode: "off", minimums: { android: "0.0.0", desktop: "0.0.0", web: "0.0.0" },
        });
        expect(readClientVersionConfig({ CLIENT_VERSION_MODE: "enforce", CLIENT_VERSION_MIN_WEB: "garbage" }).mode).toBe("off");
        const config = readClientVersionConfig({
            CLIENT_VERSION_MODE: "report", CLIENT_VERSION_MIN_ANDROID: "0.30.0",
            CLIENT_VERSION_MIN_DESKTOP: "3.0.80-beta.1", CLIENT_VERSION_MIN_WEB: "3.0.80+build.9",
        });
        const routes = createClientVersionRoutes({ config: () => config, report: async () => [] }, [
            (_req, res) => { res.sendStatus(401); },
        ]);
        const app = express();
        app.use(createClientVersionGate(() => config));
        app.use("/api/client-versions", routes.public);
        app.use("/api/admin/client-versions", routes.admin);
        expect((await request(app).get("/api/client-versions").set("X-AINO-Client", "android")).body).toEqual(config);
        expect((await request(app).get("/api/admin/client-versions")).status).toBe(401);
    });

    test("OFF and every health probe remain unobserved, malformed versions count as zero", async () => {
        let mode: "off" | "report" = "off";
        const app = express();
        app.use(createClientVersionGate(() => ({ mode, minimums: { android: "0.0.0", desktop: "0.0.0", web: "0.0.0" } })));
        app.use((req, res) => res.json({ observation: (req as any).clientVersionObservation ?? null }));
        expect((await request(app).get("/api/tasks").set("X-AINO-Client", "web")).body.observation).toBeNull();
        mode = "report";
        for (const probe of ["/healthz", "/readyz", "/api/health", "/api/client-versions"]) {
            expect((await request(app).get(probe).set("X-AINO-Client", "web")).body.observation).toBeNull();
        }
        for (const version of ["invalid", "01.2.3", "3.0.80-01", "v3.0.80"]) {
            expect((await request(app).get("/api/tasks").set("X-AINO-Client", "web").set("X-AINO-Client-Version", version)).body.observation)
                .toEqual({ client: "web", version: "0" });
        }
    });

    test("adoption report permits only the tenantless platform identity", async () => {
        const report = jest.fn(async () => [{ client: "web", version: "3.0.79", users: 2 }]);
        const config = readClientVersionConfig({});
        const routes = createClientVersionRoutes({ config: () => config, report }, [requirePlatformIdentity]);
        const app = express();
        app.use((req, _res, next) => {
            req.isPlatformUser = req.headers["x-test-platform"] === "yes";
            req.tenantId = req.headers["x-test-tenant"] ? 3 : undefined;
            (req as any).realm = "platform";
            next();
        });
        app.use("/api/admin/client-versions", routes.admin);
        expect((await request(app).get("/api/admin/client-versions")).status).toBe(403);
        expect((await request(app).get("/api/admin/client-versions").set("X-Test-Platform", "yes").set("X-Test-Tenant", "3")).status).toBe(403);
        expect(report).not.toHaveBeenCalled();
        const res = await request(app).get("/api/admin/client-versions").set("X-Test-Platform", "yes");
        expect(res.body).toEqual({ window_days: 30, versions: [{ client: "web", version: "3.0.79", users: 2 }] });
        expect(res.headers["cache-control"]).toBe("no-store");
    });
});
