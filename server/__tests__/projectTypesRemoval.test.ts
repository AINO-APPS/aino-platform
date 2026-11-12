import express from "express";
import request from "supertest";
import { createProjectTypesRemoval } from "../modules/projectTypesRemoval/projectTypesRemoval";
import { runProjectTypesContraction } from "../modules/projectTypesRemoval/projectTypesRemoval.migrate";
import { verifyAllProjectOwnership } from "../modules/projectTypesRemoval/projectTypesRemoval.repository";

describe("guarded project-types API removal boundary", () => {
    test("contraction refuses before issuing SQL unless the released minimums and global ownership preflight pass", async () => {
        const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
        const verifyOwnership = jest.fn(async () => undefined);
        const base = {
            tenantQueries: [{
                name: "test",
                transaction: async (run: (query: (sql: string, params?: unknown[]) => Promise<any>) => Promise<unknown>) => run(query),
            }],
            verifyOwnership,
        };
        await expect(runProjectTypesContraction({
            ...base, env: () => ({ PROJECT_TYPES_REMOVAL: "api", CLIENT_VERSION_MODE: "off" }),
        })).rejects.toThrow("Client version gate must enforce released minimums");
        expect(verifyOwnership).not.toHaveBeenCalled();
        expect(query).not.toHaveBeenCalled();

        await expect(runProjectTypesContraction({
            ...base, env: () => ({
                PROJECT_TYPES_REMOVAL: "api", CLIENT_VERSION_MODE: "enforce",
                CLIENT_VERSION_MIN_ANDROID: "0.27.18", CLIENT_VERSION_MIN_DESKTOP: "3.0.80", CLIENT_VERSION_MIN_WEB: "3.0.80",
            }), verifyOwnership: async () => { throw new Error("Project ownership is not verified for every organization"); },
        })).rejects.toThrow("Project ownership is not verified for every organization");
        expect(query).not.toHaveBeenCalled();
    });

    test("verification includes every catalog database and legacy master, and never trusts a failed or changing inventory", async () => {
        const databases = [{ db_name: "active_test", db_host: null }, { db_name: "retained_test", db_host: "shard" }];
        let changed = false;
        let unavailable = false;
        const visited: string[] = [];
        const query = async (sql: string) => {
            if (sql.includes("FROM tenants")) return { rows: changed ? [] : databases };
            if (sql.includes("information_schema.columns")) return { rows: [
                { column_name: "organizations.project_ownership" },
                { column_name: "organizations.project_ownership_switched_at" },
            ] };
            if (sql.includes("to_regclass")) return { rows: [{ present: true }] };
            if (sql.includes("COUNT(*)")) return { rows: [{ organizations: 1, unswitched: 0 }] };
            return { rows: [] };
        };
        const inventory = { masterQuery: query, tenantQuery: async (database: string) => {
            visited.push(database);
            if (unavailable) throw new Error("Cannot inspect retained database");
            return query;
        } };
        await expect(verifyAllProjectOwnership(inventory)).resolves.toBeUndefined();
        expect(visited).toEqual(["active_test", "retained_test"]);
        unavailable = true;
        await expect(verifyAllProjectOwnership(inventory)).rejects.toThrow();
        unavailable = false;
        await expect(verifyAllProjectOwnership({ ...inventory, tenantQuery: async () => { changed = true; return query; } })).rejects.toThrow("changed");
    });

    test("empty organization ownership inventory is not treated as verified", async () => {
        const query = async (sql: string) => {
            if (sql.includes("FROM tenants")) return { rows: [] };
            if (sql.includes("to_regclass")) return { rows: [{ present: true }] };
            if (sql.includes("information_schema.columns")) return { rows: [
                { column_name: "organizations.project_ownership" },
                { column_name: "organizations.project_ownership_switched_at" },
            ] };
            if (sql.includes("COUNT(*)")) return { rows: [{ organizations: 0, unswitched: 0 }] };
            return { rows: [] };
        };
        await expect(verifyAllProjectOwnership({ masterQuery: query, tenantQuery: async () => query }))
            .rejects.toThrow("Project ownership is not verified for every organization");
    });
    test("an explicit opt-in with an OFF gate refuses without retiring existing routes", async () => {
        const verifyOwnership = jest.fn(async () => undefined);
        const app = express();
        app.use(createProjectTypesRemoval({
            env: () => ({ PROJECT_TYPES_REMOVAL: "api" }), verifyOwnership,
        }));
        app.get("/api/tasks/scheduled", (_req, res) => res.json({ tasks: [] }));
        const refused = await request(app).get("/api/tasks/scheduled");
        expect(refused.status).toBe(503);
        expect(refused.body.code).toBe("PROJECT_TYPES_REMOVAL_NOT_READY");
        expect(verifyOwnership).not.toHaveBeenCalled();
        const retained = express();
        retained.use(createProjectTypesRemoval({ env: () => ({}), verifyOwnership }));
        retained.get("/api/tasks/scheduled", (_req, res) => res.json({ tasks: [] }));
        expect((await request(retained).get("/api/tasks/scheduled")).body).toEqual({ tasks: [] });
    });

    test.each([
        { CLIENT_VERSION_MODE: "report" }, { CLIENT_VERSION_MIN_ANDROID: "0.27.17" },
        { CLIENT_VERSION_MIN_DESKTOP: "3.0.80-rc.1" }, { CLIENT_VERSION_MIN_WEB: "3.0.79" },
        { CLIENT_VERSION_MIN_WEB: "garbage" }, { PROJECT_TYPES_REMOVAL: "contract" },
    ])("refuses unready configuration without reading or mutating organization storage: %j", async override => {
        const verifyOwnership = jest.fn(async () => undefined);
        const app = express();
        app.use(createProjectTypesRemoval({ env: () => ({
            PROJECT_TYPES_REMOVAL: "api", CLIENT_VERSION_MODE: "enforce",
            CLIENT_VERSION_MIN_ANDROID: "0.27.18", CLIENT_VERSION_MIN_DESKTOP: "3.0.80", CLIENT_VERSION_MIN_WEB: "3.0.80", ...override,
        }), verifyOwnership }));
        app.use((_req, res) => res.sendStatus(200));
        const response = await request(app).get("/api/tasks/backlog");
        expect(response.status).toBe(503);
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(verifyOwnership).not.toHaveBeenCalled();
    });

    test("ownership inventory failures remain retryable and exempt recovery reads stay available", async () => {
        let failure = true;
        const app = express();
        app.use(createProjectTypesRemoval({ env: () => ({
            PROJECT_TYPES_REMOVAL: "api", CLIENT_VERSION_MODE: "enforce",
            CLIENT_VERSION_MIN_ANDROID: "0.27.18", CLIENT_VERSION_MIN_DESKTOP: "3.0.80", CLIENT_VERSION_MIN_WEB: "3.0.80",
        }), verifyOwnership: async () => { if (failure) throw new Error("Inventory unavailable"); } }));
        app.use((_req, res) => res.sendStatus(200));
        expect((await request(app).get("/api/tasks/backlog")).status).toBe(503);
        for (const path of ["/api/health", "/api/client-versions", "/healthz", "/readyz"]) {
            expect((await request(app).get(path)).status).toBe(200);
        }
        failure = false;
        expect((await request(app).get("/api/tasks/backlog")).status).toBe(200);
    });

    test("verified ownership and released enforcing minimums retire routes and canonicalize ticket payloads only", async () => {
        const app = express();
        const verifyOwnership = jest.fn(async () => undefined);
        app.use(express.json());
        app.use(createProjectTypesRemoval({ env: () => ({
            PROJECT_TYPES_REMOVAL: "api", CLIENT_VERSION_MODE: "enforce",
            CLIENT_VERSION_MIN_ANDROID: "0.27.18", CLIENT_VERSION_MIN_DESKTOP: "3.0.80", CLIENT_VERSION_MIN_WEB: "3.0.80+web.test",
        }), verifyOwnership }));
        app.get("/api/tasks/schedule-overlays", (_req, res) => res.json({ leave: [], holidays: [], meetings: [] }));
        app.use((req, res) => res.json(req.method === "GET" ? {
            task: { id: 1, ticket_key: "APP-1", issue_key: "APP-1", project_id: 10, team_id: 2,
                start_date: "2026-11-12", planned_date: "2026-11-12", pre_sprint_due_date: null,
                time_spent_minutes: 45, logged_minutes: 45, original_estimate_minutes: 90, estimated_minutes: 90,
                subtasks: [{ id: 2, project_id: 10, ticket_key: "APP-2", team_id: 2, issue_key: "APP-2" }],
                sprint: { id: 3, team_id: 2, is_auto: false, project_id: 10 },
                capabilities: { can: { schedule: { allowed: false }, transfer: { allowed: false }, edit: { allowed: true } } } },
        } : req.body));
        for (const [method, path] of [
            ["get", "/api/tasks/scheduled"], ["patch", "/api/tasks/1/schedule"], ["patch", "/api/tasks/1/unschedule"],
            ["post", "/api/tasks/carry-forward"], ["get", "/api/tasks/1/timer"], ["post", "/api/tasks/1/timer/start"],
            ["post", "/api/tasks/1/timer/stop"], ["post", "/api/tasks/1/transfer"],
            ["get", "/api/org/teams/2/sprint-config"], ["put", "/api/org/teams/2/sprint-config"],
            ["post", "/api/projects/migration/switch-back"],
            ["get", "/api/projects/migration/review"],
        ]) {
            expect((await (request(app) as any)[method](path)).status).toBe(404);
        }
        const response = await request(app).get("/api/tasks/1/detail");
        expect(response.body.task).toEqual({ id: 1, ticket_key: "APP-1", project_id: 10, start_date: "2026-11-12",
            time_spent_minutes: 45, original_estimate_minutes: 90,
            subtasks: [{ id: 2, project_id: 10, ticket_key: "APP-2" }], sprint: { id: 3, project_id: 10 },
            capabilities: { can: { edit: { allowed: true } } } });
        expect((await request(app).get("/api/tasks/schedule-overlays")).body).toEqual({ leave: [], holidays: [], meetings: [] });
        expect((await request(app).get("/api/tasks?team_id=2")).status).toBe(400);
        expect((await request(app).put("/api/tasks/1").send({ planned_date: "2026-11-12" })).status).toBe(400);
        expect((await request(app).put("/api/tasks/1").send({ start_date: "2026-11-12" })).body).toEqual({ start_date: "2026-11-12" });
        expect(verifyOwnership).toHaveBeenCalled();
    });
});
