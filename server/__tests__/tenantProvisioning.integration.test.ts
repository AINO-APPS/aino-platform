/** A new organization never blocks the platform-wide project-ownership readiness check. */
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { provisionTenantOrganization } from "../platform/db/tenantOrganization";
import { verifyProjectOwnership } from "../platform/projectTypesRemoval";

jest.mock("../middleware/auth", () => (req: any, _res: any, next: any) => { req.userId = 1; next(); });
jest.mock("../middleware/rbac", () => ({
    loadUserContext: (req: any, _res: any, next: any) => {
        req.userRole = req.get("x-test-role") || "super_admin"; req.userOrgId = 1; next();
    },
    requireRole: () => (_req: any, _res: any, next: any) => next(),
    requireSameOrg: (_req: any, _res: any, next: any) => next(),
    ROLE_LEVEL: { employee: 1, team_lead: 2, hr_admin: 4, super_admin: 5, platform_admin: 6 },
}));
jest.mock("../middleware/tenant", () => ({
    requireTenant: (_req: any, _res: any, next: any) => next(),
    requireFeature: () => (_req: any, _res: any, next: any) => next(),
}));
jest.mock("../utils/audit", () => ({ logAction: jest.fn() }));
jest.mock("../utils/ws", () => ({ sendToUser: jest.fn(), notifyUser: jest.fn(), broadcast: jest.fn() }));
jest.mock("../realtime/fanout", () => ({ notifyUser: jest.fn().mockResolvedValue(undefined) }));

jest.setTimeout(120_000);

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("tenant provisioning (PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let query: (sql: string, params?: unknown[]) => Promise<any>;

    beforeAll(async () => {
        database = await createTestDatabase(databaseUrl!, "tenant_provisioning");
        pool = new Pool({ connectionString: database.url, max: 2 });
        query = (sql, params = []) => pool.query(sql, params as any[]);
        await require("../platform/db/tenantSchema").initTenantSchema(query);
        expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
    });

    afterAll(async () => {
        await pool?.end();
        await database?.drop();
    });

    test("a plain organization row on a fresh tenant is not ready, which is what blocked every tenant", async () => {
        await query("INSERT INTO organizations (id, name, slug) VALUES (1, 'Plain', 'plain')");
        await expect(verifyProjectOwnership(query)).rejects.toThrow("Project ownership is not verified for every organization");
        await query("DELETE FROM organizations");
    });

    test("a provisioned tenant is project-owned, ready, and has its default project and workflow", async () => {
        await provisionTenantOrganization(query, { orgName: "Fresh", slug: "fresh" });
        await expect(verifyProjectOwnership(query)).resolves.toBeUndefined();
        expect((await query("SELECT id, name, slug FROM organizations")).rows).toEqual([{ id: 1, name: "Fresh", slug: "fresh" }]);
        expect((await query("SELECT COUNT(*)::int AS n FROM projects WHERE org_id = 1 AND is_general")).rows[0].n).toBe(1);
        expect((await query("SELECT COUNT(*)::int AS n FROM workflow_states WHERE org_id = 1")).rows[0].n).toBeGreaterThan(0);
    });

    test("provisioning twice keeps one organization", async () => {
        await provisionTenantOrganization(query, { orgName: "Fresh", slug: "fresh" });
        expect((await query("SELECT COUNT(*)::int AS n FROM organizations")).rows[0].n).toBe(1);
    });

    describe("organizations created later inside an existing tenant", () => {
        const request = require("supertest");
        let app: any;

        beforeAll(() => {
            const { makePoolQuery, makePoolTransaction } = require("../platform/db/pool");
            const express = require("express");
            app = express();
            app.use(express.json());
            app.use((req: any, _res: any, next: any) => {
                req.tenantId = 1;
                req.db = { query: makePoolQuery(pool), transaction: makePoolTransaction(pool) };
                req.log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
                next();
            });
            app.use("/api/admin", require("../routes/admin"));
            app.use("/api/organization", require("../routes/organization"));
        });

        beforeEach(async () => {
            await query("TRUNCATE organizations RESTART IDENTITY CASCADE");
            await provisionTenantOrganization(query, { orgName: "Fresh", slug: "fresh" });
            await query("SELECT setval(pg_get_serial_sequence('organizations', 'id'), 1)");
            await query("INSERT INTO users (id, username, password, full_name, org_id) VALUES (1, 'creator', 'x', 'Creator', 1) ON CONFLICT (id) DO NOTHING");
        });

        test("a platform admin creating an organization leaves every organization ready", async () => {
            const created = await request(app).post("/api/admin/organizations").send({ name: "Second" });
            expect(created.status).toBe(200);
            await expect(verifyProjectOwnership(query)).resolves.toBeUndefined();
        });

        test("a super admin creating an organization leaves every organization ready", async () => {
            const created = await request(app).post("/api/organization").send({ name: "Third" });
            expect(created.status).toBe(200);
            await expect(verifyProjectOwnership(query)).resolves.toBeUndefined();
        });
    });
});
