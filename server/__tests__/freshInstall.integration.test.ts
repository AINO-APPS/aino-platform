import crypto from "crypto";
import express from "express";
import { Pool } from "pg";
import request from "supertest";
import type { Test, Agent } from "supertest";
import { createTestDatabase } from "../test-support/pgTestDatabase";

jest.unmock("../middleware/tenant");
jest.unmock("../utils/tenantManager");
jest.unmock("../modules/projectTypesRemoval/projectTypesRemoval");

jest.setTimeout(120_000);

const databaseUrl = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(databaseUrl ? describe : describe.skip)("fresh-install ownership readiness (PostgreSQL)", () => {
    const originalEnv = { ...process.env };
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let db: typeof import("../db");
    let app: express.Express;
    let tenantDatabase: string | undefined;
    const slug = `fresh-test-${crypto.randomBytes(6).toString("hex")}`;
    const password = () => `Fresh-${crypto.randomBytes(18).toString("hex")}!`;

    beforeAll(async () => {
        const redisUrl = process.env.TASKS_SCHEMA_TEST_REDIS_URL || "";
        if (redisUrl && !["localhost", "127.0.0.1", "[::1]", "redis"].includes(new URL(redisUrl).hostname)) {
            throw new Error("TASKS_SCHEMA_TEST_REDIS_URL must point to a local test Redis");
        }
        database = await createTestDatabase(databaseUrl!, "fresh_install");
        Object.assign(process.env, {
            DATABASE_URL: database.url,
            DIRECT_DATABASE_URL: database.url,
            REDIS_URL: redisUrl,
            PROJECT_TYPES_REMOVAL: "api",
            CLIENT_VERSION_MODE: "enforce",
            CLIENT_VERSION_MIN_ANDROID: "0.27.18",
            CLIENT_VERSION_MIN_DESKTOP: "3.0.80",
            CLIENT_VERSION_MIN_WEB: "3.0.80",
            CONSOLE_HOST: "console.fresh.test",
            SERVE_SPA: "false",
            ADMIN_MFA_STEP_UP: "on",
        });
        db = require("../db");
        await require("../migrate").main();
        // Independent test databases must not reuse identity keys in shared Redis.
        await db.masterQuery(`SELECT
            setval(pg_get_serial_sequence('platform_users', 'id'), $1, FALSE),
            setval(pg_get_serial_sequence('tenants', 'id'), $1, FALSE)`,
        [crypto.randomInt(1_000_000, 1_000_000_000)]);
        app = require("../app").app;
        await require("../bootstrap/migrations").bootstrap();
    });

    afterAll(async () => {
        await require("../utils/tenantManager").destroyAllPools();
        await require("../redis").shutdown();
        if (tenantDatabase) {
            if (tenantDatabase !== `wp_${slug.replace(/-/g, "_")}`) throw new Error("Unexpected test tenant database");
            await db.masterQuery(`DROP DATABASE IF EXISTS "${tenantDatabase}" WITH (FORCE)`);
        }
        await db?.pool.end();
        await database?.drop();
        process.env = originalEnv;
    });

    test("accepts a fully initialized empty legacy master before the first tenant exists", async () => {
        await expect(require("../platform/projectTypesRemoval").verifyPlatformProjectOwnership())
            .resolves.toBeUndefined();
    });

    function onHost(call: Test, host = "console.fresh.test"): Test {
        return call.set({
            Host: host,
            "X-Requested-With": "AINO",
            "X-AINO-Client": "web",
            "X-AINO-Client-Version": "3.0.80",
        });
    }

    async function enrollAndSignIn(agent: Agent, username: string, initialPassword: string, host?: string) {
        const login = await onHost(agent.post("/api/auth/login"), host)
            .send({ username, password: initialPassword }).expect(401);
        expect(login.body.code).toBe("MFA_ENROLL_REQUIRED");
        const mfaTicket: string = login.body.mfaTicket;
        const enrollment = await onHost(agent.post("/api/auth/mfa/enroll/start"), host)
            .send({ mfaTicket }).expect(200);
        const secret: string = enrollment.body.secret;
        const { authenticator } = require("otplib");
        const signedIn = await onHost(agent.post("/api/auth/mfa/enroll/confirm"), host)
            .send({ mfaTicket, code: authenticator.generate(secret) }).expect(200);
        expect(signedIn.body.user.must_change_password).toBe(true);
        const changed = await onHost(agent.put("/api/profile/password"), host)
            .send({ current_password: initialPassword, new_password: password() }).expect(200);
        expect(changed.body.must_change_password).toBe(false);
        await onHost(agent.post("/api/auth/mfa/step-up"), host)
            .send({ code: authenticator.generate(secret) }).expect(200);
    }

    test("onboards the first tenant through real MFA, password changes and project-owned ticket APIs", async () => {
        const initialPassword = password();
        await expect(require("../scripts/bootstrap-platform-admin").bootstrapPlatformAdmin(db.masterTransaction, {
            PLATFORM_BOOTSTRAP_PASSWORD: initialPassword,
            PLATFORM_BOOTSTRAP_EMAIL: "platform@example.test",
        })).resolves.toBe("created");
        await onHost(request(app).get("/healthz")).expect(200);
        if (process.env.TASKS_SCHEMA_TEST_REDIS_URL) {
            await onHost(request(app).get("/readyz")).expect(200);
        }

        const operator = request.agent(app);
        await enrollAndSignIn(operator, "vvronline", initialPassword);
        const empty = await onHost(operator.get("/api/admin/tenants")).expect(200);
        expect(empty.body.total).toBe(0);

        const created = await onHost(operator.post("/api/admin/tenants"))
            .send({ org_name: "First workspace", slug }).expect(201);
        const tenantId: number = created.body.tenant.id;
        tenantDatabase = created.body.tenant.db_name;
        const listed = await onHost(operator.get("/api/admin/tenants")).expect(200);
        expect(listed.body.total).toBe(1);
        expect(listed.body.tenants[0].id).toBe(tenantId);

        const ownerPassword = password();
        await onHost(operator.post(`/api/admin/tenants/${tenantId}/users`)).send({
            username: "workspace-owner", password: ownerPassword,
            full_name: "Workspace Owner", email: "owner@example.test", role: "super_admin",
        }).expect(201);

        const owner = request.agent(app);
        await enrollAndSignIn(owner, "workspace-owner", ownerPassword, "app.fresh.test");
        const profile = await onHost(owner.get("/api/profile"), "app.fresh.test").expect(200);
        expect(profile.body).toMatchObject({ tenant_id: tenantId, must_change_password: false });
        expect(profile.body).not.toHaveProperty("project_ownership");
        const projects = await onHost(owner.get("/api/projects"), "app.fresh.test").expect(200);
        const general = projects.body.find((project: { is_general: boolean }) => project.is_general);
        expect(general).toBeDefined();
        const ticket = await onHost(owner.post("/api/tasks/backlog"), "app.fresh.test")
            .send({ project_id: general.id, title: "First ticket" }).expect(200);
        expect(ticket.body.project_id).toBe(general.id);
        expect(ticket.body.ticket_key).toBe(`${general.key}-1`);
        const detail = await onHost(owner.get(`/api/tasks/${ticket.body.id}/detail`), "app.fresh.test").expect(200);
        expect(detail.body).toMatchObject({ title: "First ticket", ticket_key: ticket.body.ticket_key });
        await expect(require("../platform/projectTypesRemoval").verifyPlatformProjectOwnership())
            .resolves.toBeUndefined();
    });

    test("an unswitched organization in legacy master still blocks requests", async () => {
        const inserted = await db.masterQuery(
            "INSERT INTO organizations (name, slug) VALUES ('Unswitched', 'unswitched') RETURNING id",
        );
        try {
            await expect(require("../platform/projectTypesRemoval").verifyPlatformProjectOwnership())
                .rejects.toThrow("Project ownership is not verified for every organization");
            const refused = await onHost(request(app).get("/api/projects")).expect(503);
            expect(refused.body.code).toBe("PROJECT_TYPES_REMOVAL_NOT_READY");
        } finally {
            await db.masterQuery("DELETE FROM organizations WHERE id = $1", [inserted.rows[0].id]);
        }
    });

    test("an empty retained tenant is not mistaken for an empty legacy master", async () => {
        const retained = await createTestDatabase(databaseUrl!, "empty_retained");
        const pool = new Pool({ connectionString: retained.url, max: 1 });
        let retainedId: number | undefined;
        try {
            const query = (sql: string, params: unknown[] = []) => pool.query(sql, params);
            await require("../platform/db/tenantSchema").initTenantSchema(query);
            expect((await require("../platform/db/migrations").runTenantMigrations(query)).failed).toEqual([]);
            const inserted = await db.masterQuery(
                `INSERT INTO tenants (org_name, slug, db_name, status)
                 VALUES ('Retained', $1, $2, 'suspended') RETURNING id`,
                [`retained-${slug}`, new URL(retained.url).pathname.slice(1)],
            );
            retainedId = inserted.rows[0].id;
            await expect(require("../platform/projectTypesRemoval").verifyPlatformProjectOwnership())
                .rejects.toThrow("Project ownership is not verified for every organization");
            const refused = await onHost(request(app).get("/api/projects")).expect(503);
            expect(refused.body.code).toBe("PROJECT_TYPES_REMOVAL_NOT_READY");
        } finally {
            if (retainedId !== undefined) await db.masterQuery("DELETE FROM tenants WHERE id = $1", [retainedId]);
            await pool.end();
            await retained.drop();
        }
    });

    test("missing legacy storage still blocks requests even with zero organizations", async () => {
        await db.masterQuery("ALTER TABLE tasks RENAME TO fresh_install_unavailable_tasks");
        try {
            await expect(require("../platform/projectTypesRemoval").verifyPlatformProjectOwnership())
                .rejects.toThrow();
            const refused = await onHost(request(app).get("/api/projects")).expect(503);
            expect(refused.body.code).toBe("PROJECT_TYPES_REMOVAL_NOT_READY");
        } finally {
            await db.masterQuery("ALTER TABLE fresh_install_unavailable_tasks RENAME TO tasks");
        }
        await expect(require("../platform/projectTypesRemoval").verifyPlatformProjectOwnership())
            .resolves.toBeUndefined();
    });
});
