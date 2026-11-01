import { Pool } from "pg";
import type { PoolClient } from "pg";
import { logger } from "../../utils/logger";
import type { TransactionContext } from "../../types/domain";
import { installPgTypeParsers } from "./pgTypes";

// DATE columns must reach the API as `YYYY-MM-DD` strings, not local-midnight
// Date objects. Registering here covers every pool, because they all import
// this module for `makePoolQuery` / `makePoolTransaction`.
installPgTypeParsers();

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

/**
 * Create a transaction function bound to the given pool.
 *
 * The callback's `afterCommit` registers side effects (realtime,
 * notifications) that must only happen once the writes are durable: they run
 * in order after COMMIT, are dropped on ROLLBACK, and a failing one is logged
 * without failing the transaction.
 */
function makePoolTransaction(targetPool: Pool) {
    return async function boundTransaction<T = unknown>(
        asyncFn: (client: PoolClient, context: TransactionContext) => Promise<T>,
    ): Promise<T> {
        const client = await targetPool.connect();
        const pending: Array<() => unknown | Promise<unknown>> = [];
        let result: T;
        try {
            await client.query("BEGIN");
            result = await asyncFn(client, { afterCommit: (callback) => { pending.push(callback); } });
            await client.query("COMMIT");
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
        for (const callback of pending) {
            try {
                await callback();
            } catch (err) {
                logger.error({ err }, "afterCommit callback failed");
            }
        }
        return result;
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