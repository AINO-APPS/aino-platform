import { Pool } from "pg";
import { masterQuery } from "../../platform/db/pool";
import { verifyAllProjectOwnership } from "./projectTypesRemoval.repository";

/** Dedicated read-only connections: tenantPool acquisition also runs migrations. */
export async function verifyPlatformProjectOwnership(): Promise<void> {
    const pools: Pool[] = [];
    try {
        await verifyAllProjectOwnership({ masterQuery, tenantQuery: async (database, host) => {
            const url = new URL(process.env.DATABASE_URL!);
            url.pathname = `/${database}`;
            if (host) url.hostname = host;
            const pool = new Pool({ connectionString: url.toString(), max: 1,
                connectionTimeoutMillis: 5000, statement_timeout: 5000,
                options: "-c default_transaction_read_only=on",
                ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : false });
            pools.push(pool);
            return (sql, params) => pool.query(sql, params as any[]);
        } });
    } finally {
        await Promise.all(pools.map(pool => pool.end()));
    }
}
