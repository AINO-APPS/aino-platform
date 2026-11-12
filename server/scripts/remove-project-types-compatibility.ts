import { Pool } from "pg";
import { assertProjectTypesRemovalReady } from "../modules/projectTypesRemoval/projectTypesRemoval";
import { runProjectTypesContraction, type ProjectTypesContractionTarget } from "../modules/projectTypesRemoval/projectTypesRemoval.migrate";

async function main(): Promise<void> {
    await assertProjectTypesRemovalReady(process.env, async () => undefined);
    const { masterQuery } = require("../platform/db/pool");
    const { verifyPlatformProjectOwnership } = require("../platform/projectTypesRemoval");
    const inventory = await masterQuery("SELECT db_name, db_host FROM tenants ORDER BY id");
    const legacy = await masterQuery("SELECT to_regclass('public.organizations') IS NOT NULL AS present");
    if (inventory.rows.length === 0 && legacy.rows[0]?.present !== true) {
        throw new Error("Project ownership inventory is empty");
    }

    const masterUrl = new URL(process.env.DATABASE_URL!);
    const pools: Pool[] = [];
    const targets: ProjectTypesContractionTarget[] = [];
    const makeTarget = (name: string, pool: Pool): ProjectTypesContractionTarget => ({
        name,
        transaction: async (run) => {
            const client = await pool.connect();
            try {
                await client.query("BEGIN");
                const result = await run((sql, params = []) => client.query(sql, params as any[]));
                await client.query("COMMIT");
                return result;
            } catch (error) {
                await client.query("ROLLBACK");
                throw error;
            } finally {
                client.release();
            }
        },
    });

    try {
        for (const tenant of inventory.rows) {
            if (typeof tenant.db_name !== "string" || !tenant.db_name) throw new Error("Incomplete ownership inventory");
            const url = new URL(masterUrl);
            url.pathname = `/${tenant.db_name}`;
            if (tenant.db_host) url.hostname = tenant.db_host;
            const pool = new Pool({
                connectionString: url.toString(),
                max: 1,
                connectionTimeoutMillis: 5000,
                ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : false,
            });
            pools.push(pool);
            targets.push(makeTarget(tenant.db_name, pool));
        }
        if (legacy.rows[0]?.present === true) {
            const masterPool = new Pool({
                connectionString: masterUrl.toString(),
                max: 1,
                connectionTimeoutMillis: 5000,
                ssl: masterUrl.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : false,
            });
            pools.push(masterPool);
            targets.push(makeTarget("legacy-master", masterPool));
        }

        const applied = await runProjectTypesContraction({
            env: () => process.env,
            verifyOwnership: verifyPlatformProjectOwnership,
            tenantQueries: targets,
        });
        process.stdout.write(`Project-types contraction applied to ${applied.length} database(s).\n`);
    } finally {
        await Promise.all(pools.map((pool) => pool.end()));
    }
}

main().catch((error: unknown) => {
    process.stderr.write(`Project-types contraction refused or failed: ${(error as Error).message}\n`);
    process.exitCode = 1;
});
