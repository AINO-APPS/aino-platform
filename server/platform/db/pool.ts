import { Pool } from "pg";
import type { PoolClient } from "pg";
import { logger } from "../../utils/logger";

if (!process.env.DATABASE_URL) {
    logger.fatal("DATABASE_URL environment variable is not set. Server cannot start.");
    process.exit(1);
}

/**
 * Keep application-side pools deliberately small. PgBouncer owns the real
 * server-connection budget; each Node replica only needs a few client sockets.
 */
const MASTER_POOL_SIZE = Math.max(1, parseInt(process.env.MASTER_POOL_SIZE || "", 10) || 4);

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : false,
    max: MASTER_POOL_SIZE,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
    logger.error({ err }, "Unexpected master DB pool error");
});

/** Create a query function bound to the given pool. */
function makePoolQuery(targetPool: Pool) {
    return async function boundQuery(sql: string, params: unknown[] = []) {
        const client = await targetPool.connect();
        try {
            return await client.query(sql, params);
        } finally {
            client.release();
        }
    };
}

/** Create a transaction function bound to the given pool. */
function makePoolTransaction(targetPool: Pool) {
    return async function boundTransaction<T = unknown>(asyncFn: (client: PoolClient) => Promise<T>): Promise<T> {
        const client = await targetPool.connect();
        try {
            await client.query("BEGIN");
            const result = await asyncFn(client);
            await client.query("COMMIT");
            return result;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    };
}

const masterQuery = makePoolQuery(pool);
const masterTransaction = makePoolTransaction(pool);

/** @deprecated Use masterQuery — kept for backward compatibility during migration. */
const query = masterQuery;
/** @deprecated Use masterTransaction — kept for backward compatibility during migration. */
const transaction = masterTransaction;

export {
    pool,
    masterQuery,
    masterTransaction,
    query,
    transaction,
    makePoolQuery,
    makePoolTransaction,
};