import express from "express";
import request from "supertest";
import { createClientVersionGate } from "../modules/clientVersions/clientVersions.middleware";
import { readClientVersionConfig } from "../modules/clientVersions/clientVersions.config";
import { createClientVersionRoutes } from "../modules/clientVersions/clientVersions.routes";
import requirePlatformIdentity from "../middleware/platformIdentity";
import { installCors } from "../http/middleware/cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

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

    test("public config is available before authentication and malformed configuration is refused", async () => {
        expect(readClientVersionConfig({})).toEqual({
            mode: "off", minimums: { android: "0.0.0", desktop: "0.0.0", web: "0.0.0" },
        });
        expect(() => readClientVersionConfig({ CLIENT_VERSION_MODE: "enforce", CLIENT_VERSION_MIN_WEB: "garbage" }))
            .toThrow("CLIENT_VERSION_MIN_WEB");
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

    test("enforcement refuses an outdated client before authentication with the upgrade contract", async () => {
        const config = readClientVersionConfig({ CLIENT_VERSION_MODE: "enforce", CLIENT_VERSION_MIN_ANDROID: "0.27.18" });
        const app = express();
        app.use(createClientVersionGate(() => config));
        app.use((_req, res) => res.sendStatus(401));
        const response = await request(app).get("/api/tasks")
            .set("X-AINO-Client", "android").set("X-AINO-Client-Version", "0.27.17");
        expect(response.status).toBe(426);
        expect(response.body).toEqual({
            code: "CLIENT_UPGRADE_REQUIRED", client: "android",
            min_version: "0.27.18", current_version: "0.27.17",
        });
    });

    test.each(["android", "desktop", "web"] as const)("enforces the minimum boundary for %s", async client => {
        const config = readClientVersionConfig({
            CLIENT_VERSION_MODE: "enforce", CLIENT_VERSION_MIN_ANDROID: "3.0.80",
            CLIENT_VERSION_MIN_DESKTOP: "3.0.80", CLIENT_VERSION_MIN_WEB: "3.0.80",
        });
        const app = express();
        app.use(createClientVersionGate(() => config));
        app.use((_req, res) => res.sendStatus(200));
        for (const version of ["3.0.79", "3.0.80-rc.1", "garbage", undefined]) {
            const call = request(app).get("/api/tasks").set("X-AINO-Client", client);
            if (version !== undefined) call.set("X-AINO-Client-Version", version);
            const response = await call;
            expect(response.status).toBe(426);
            expect(response.body.current_version).toBe(version === "garbage" || version === undefined ? "0" : version);
            expect(response.headers["cache-control"]).toBe("no-store");
        }
        for (const version of ["3.0.80", "3.0.80+web.build", "3.0.81"]) {
            expect((await request(app).get("/api/tasks").set("X-AINO-Client", client)
                .set("X-AINO-Client-Version", version)).status).toBe(200);
        }
    });

    test("legacy recognition, unknown clients and exempt recovery routes remain usable", async () => {
        const config = readClientVersionConfig({
            CLIENT_VERSION_MODE: "enforce", CLIENT_VERSION_MIN_ANDROID: "0.27.18",
            CLIENT_VERSION_MIN_DESKTOP: "3.0.80", CLIENT_VERSION_MIN_WEB: "3.0.80",
        });
        const app = express();
        app.use(cookieParser());
        app.use(createClientVersionGate(() => config));
        const routes = createClientVersionRoutes({ config: () => config, report: async () => [] }, [(_req, _res, next) => next()]);
        app.use("/api/client-versions", routes.public);
        app.use((_req, res) => res.sendStatus(200));
        expect((await request(app).get("/api/tasks").set("Authorization", "Bearer legacy")).body)
            .toMatchObject({ client: "android", current_version: "0" });
        expect((await request(app).get("/api/tasks").set("Origin", "workpulse://app")).body)
            .toMatchObject({ client: "desktop", current_version: "0" });
        const token = jwt.sign({ cli: "mobile" }, "client-recognition-test-only");
        expect((await request(app).get("/api/tasks").set("Cookie", `token=${token}`)).body)
            .toMatchObject({ client: "android", current_version: "0" });
        expect((await request(app).get("/api/tasks")).status).toBe(200);
        expect((await request(app).get("/api/tasks").set("X-AINO-Client", "integration")).status).toBe(200);
        for (const path of ["/health", "/healthz", "/readyz", "/api/health", "/api/client-versions", "/api/client-versions/"]) {
            expect((await request(app).get(path).set("X-AINO-Client", "android")).status).toBe(200);
            expect((await request(app).head(path).set("X-AINO-Client", "android")).status).toBe(200);
        }
        expect((await request(app).get("/api/client-versions").set("X-AINO-Client", "web")).body).toEqual(config);
    });

    test.each([
        { CLIENT_VERSION_MODE: "typo" },
        { CLIENT_VERSION_MIN_ANDROID: "" },
        { CLIENT_VERSION_MIN_DESKTOP: "3.0" },
    ])("invalid operator configuration is rejected: %j", env => {
        expect(() => readClientVersionConfig(env)).toThrow();
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
