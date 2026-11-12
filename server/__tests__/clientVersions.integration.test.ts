import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";
import { createTestDatabase } from "../test-support/pgTestDatabase";
import { createClientVersionRepository } from "../modules/clientVersions/clientVersions.repository";
import { createClientVersionService } from "../modules/clientVersions/clientVersions.service";

const url = process.env.TASKS_SCHEMA_TEST_DATABASE_URL;
(url ? describe : describe.skip)("client versions persistence (disposable PostgreSQL)", () => {
    let database: Awaited<ReturnType<typeof createTestDatabase>>;
    let pool: Pool;
    let tenant: Pool;
    beforeAll(async () => {
        database = await createTestDatabase(url!, "client_versions");
        pool = new Pool({ connectionString: database.url });
        await pool.query(`CREATE TABLE user_sessions (
            id TEXT PRIMARY KEY, user_id INTEGER, client_class TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
            last_activity_at TIMESTAMPTZ DEFAULT NOW());
            INSERT INTO user_sessions (id,user_id,client_class,last_activity_at)
            VALUES ('web-session',7,'web',NOW()-INTERVAL '40 days');
            CREATE SCHEMA tenant;
            CREATE TABLE tenant.user_sessions (LIKE public.user_sessions INCLUDING ALL);
            INSERT INTO tenant.user_sessions SELECT * FROM public.user_sessions`);
        tenant = new Pool({ connectionString: database.url, options: "-c search_path=tenant" });
    });
    afterAll(async () => { await tenant?.end(); await pool?.end(); await database?.drop(); });

    test("both expand migrations rerun safely; real last-seen counts survive activity, logout and tenant collisions", async () => {
        for (const file of ["0033_client_versions.sql", path.join("master", "0011_client_versions.sql")]) {
            const sql = fs.readFileSync(path.join(__dirname, "..", "platform", "db", "migrations", file), "utf8");
            const target = file.startsWith("master") ? pool : tenant;
            await target.query(sql);
            await target.query(sql);
        }
        const query = (sql: string, params?: any[]) => pool.query(sql, params);
        const service = createClientVersionService(createClientVersionRepository(query), () => ({
            mode: "report", minimums: { android: "0.0.0", desktop: "0.0.0", web: "0.0.0" },
        }));
        const principal = { userId: 7, tenantId: 1, sessionId: "web-session", query: (sql: string, params?: any[]) => tenant.query(sql, params) };
        const web = { client: "web" as const, version: "3.0.79" };
        await service.observe(principal, web);
        await pool.query("UPDATE client_version_observations SET last_seen_at = NOW() - INTERVAL '31 days'");
        expect(await service.report()).toEqual([]);
        await service.observe(principal, web);
        await service.observe(principal, web);
        await service.observe({ userId: 7, tenantId: 2 }, web);
        await service.observe({ userId: 7, tenantId: null, isPlatformUser: true, sessionId: "web-session", query }, web);
        await service.observe(principal, { client: "desktop", version: "3.0.80" });
        const session = (await tenant.query("SELECT client_class, observed_client_class, client_version, client_version_seen_at > NOW() - INTERVAL '1 minute' AS fresh FROM user_sessions")).rows[0];
        expect(session).toEqual({ client_class: "web", observed_client_class: "desktop", client_version: "3.0.80", fresh: true });
        expect((await pool.query("SELECT observed_client_class, client_version FROM user_sessions")).rows[0])
            .toEqual({ observed_client_class: "web", client_version: "3.0.79" });
        await tenant.query("DELETE FROM user_sessions");
        await pool.query("DELETE FROM user_sessions");
        expect(await service.report()).toEqual([
            { client: "desktop", version: "3.0.80", users: 1 },
            { client: "web", version: "3.0.79", users: 3 },
        ]);
    });
});
