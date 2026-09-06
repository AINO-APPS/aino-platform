import { Pool } from "pg";
import { makePoolQuery, makePoolTransaction } from "./pool";
import { runTenantMigrations } from "./migrations";
import { logger } from "../../utils/logger";
import type { QueryFn, TransactionFn } from "../../types/domain";

interface PoolEntry {
    pool: Pool;
    query: QueryFn;
    transaction: TransactionFn;
    lastUsed: number;
}

interface MasterConnConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    ssl: { rejectUnauthorized: boolean } | false;
}

// Configurable via env so Railway/prod deployments can be tuned without a rebuild.
//   TENANT_MAX_POOLS       — max number of cached tenant pools (default 100)
//   TENANT_POOL_SIZE       — max connections per pool                 (default 3)
//   TENANT_POOL_IDLE_MS    — idle pool eviction threshold in ms      (default 5 min)
const MAX_POOLS = Math.max(1, parseInt(process.env.TENANT_MAX_POOLS || "", 10) || 100);
const POOL_SIZE = Math.max(1, parseInt(process.env.TENANT_POOL_SIZE || "", 10) || 3);
const IDLE_TIMEOUT_MS = Math.max(30_000, parseInt(process.env.TENANT_POOL_IDLE_MS || "", 10) || 5 * 60 * 1000);

const poolMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    busyEvictions: 0,
    peakPoolCount: 0,
};

// ── LRU pool cache ──────────────────────────────────────────────────────────

const poolCache = new Map<string, PoolEntry>();

/** Track tenant DBs that have been schema-migrated this process lifetime. */
const migratedDbs = new Set<string>();

/** Prevents concurrent pool creation for the same db_name. */
const pendingCreations = new Map<string, Promise<PoolEntry>>();

/** Parse the master DATABASE_URL to extract host/port/user/password for tenant connections. */
function parseMasterUrl(): MasterConnConfig {
    const url = new URL(process.env.DATABASE_URL as string);
    return {
        host: url.hostname,
        port: parseInt(url.port, 10) || 5432,
        user: url.username,
        password: url.password,
        ssl: (process.env.DATABASE_URL || "").includes("sslmode=require")
            ? { rejectUnauthorized: false }
            : false,
    };
}

/**
 * Evict the least-recently-used pool if we're over the limit, or any pool
 * that has been idle longer than IDLE_TIMEOUT_MS.
 */
/** A pool is "busy" when it has checked-out clients or queued waiters —
 *  evicting it would kill in-flight queries. */
function isPoolBusy(entry: PoolEntry): boolean {
    const p = entry.pool as Pool & { totalCount: number; idleCount: number; waitingCount: number };
    return p.waitingCount > 0 || (p.totalCount - p.idleCount) > 0;
}

function evictIfNeeded(): void {
    const now = Date.now();
    // First evict stale pools (skip any with in-flight work)
    for (const [dbName, entry] of poolCache) {
        if (now - entry.lastUsed > IDLE_TIMEOUT_MS && !isPoolBusy(entry)) {
            logger.info({ dbName }, "Evicting idle tenant pool");
            entry.pool.end().catch(() => { });
            poolCache.delete(dbName);
            poolMetrics.evictions++;
        }
    }
    // Then evict LRU if still over limit. Prefer idle pools; only touch a
    // busy pool as a last resort when EVERY cached pool is busy (otherwise
    // the cache could grow unbounded past MAX_POOLS and exceed the DB's
    // connection budget).
    while (poolCache.size >= MAX_POOLS) {
        let oldestIdleKey: string | null = null;
        let oldestIdleTime = Infinity;
        let oldestAnyKey: string | null = null;
        let oldestAnyTime = Infinity;
        for (const [dbName, entry] of poolCache) {
            if (entry.lastUsed < oldestAnyTime) {
                oldestAnyTime = entry.lastUsed;
                oldestAnyKey = dbName;
            }
            if (!isPoolBusy(entry) && entry.lastUsed < oldestIdleTime) {
                oldestIdleTime = entry.lastUsed;
                oldestIdleKey = dbName;
            }
        }
        const victim = oldestIdleKey || oldestAnyKey;
        if (!victim) break;
        logger.info({ dbName: victim, wasBusy: !oldestIdleKey }, "Evicting LRU tenant pool");
        poolMetrics.evictions++;
        if (!oldestIdleKey) poolMetrics.busyEvictions++;
        // pool.end() waits for checked-out clients to be released before
        // closing, so even the busy-pool fallback doesn't kill in-flight
        // queries — it just stops new checkouts.
        poolCache.get(victim)!.pool.end().catch(() => { });
        poolCache.delete(victim);
    }
}

/**
 * Get (or create) a connection pool for a tenant database.
 * Returns { pool, query, transaction } where query/transaction are bound to the pool.
 *
 * @param dbName - The database name (e.g., 'wp_acme')
 * @param dbHost - Override host (for future external DB support)
 */
async function getTenantPool(dbName: string, dbHost?: string | null): Promise<PoolEntry> {
    // Cache hit — touch LRU timestamp
    if (poolCache.has(dbName)) {
        poolMetrics.hits++;
        const entry = poolCache.get(dbName)!;
        entry.lastUsed = Date.now();
        return entry;
    }
    poolMetrics.misses++;

    // Prevent duplicate concurrent pool creation
    if (pendingCreations.has(dbName)) {
        return pendingCreations.get(dbName)!;
    }

    const promise = (async (): Promise<PoolEntry> => {
        evictIfNeeded();

        const master = parseMasterUrl();
        const tenantPool = new Pool({
            host: dbHost || master.host,
            port: master.port,
            user: master.user,
            password: master.password,
            database: dbName,
            ssl: master.ssl,
            max: POOL_SIZE,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        });

        tenantPool.on("error", (err) => {
            logger.error({ err, dbName }, "Tenant pool error");
        });

        // Verify connectivity
        const client = await tenantPool.connect();
        client.release();

        const entry: PoolEntry = {
            pool: tenantPool,
            query: makePoolQuery(tenantPool),
            transaction: makePoolTransaction(tenantPool),
            lastUsed: Date.now(),
        };

        poolCache.set(dbName, entry);
        poolMetrics.peakPoolCount = Math.max(poolMetrics.peakPoolCount, poolCache.size);

        // Note: implicit `initTenantSchema(entry.query)` on first pool use was
        // removed in favor of the startup-time `sweepAllTenants()` migration
        // runner (see server/utils/migrationRunner.js). Cold-start latency for
        // new tenants is now bounded by the connection itself, not by an
        // entire schema script. Newly-created tenants still get
        // `initTenantSchema()` called explicitly in `createTenant()` below.
        //
        // Apply versioned migrations on first touch of a tenant pool this
        // process lifetime — cheap, idempotent, and ensures any tenant DB
        // touched at runtime (e.g. via custom-domain hit) is up to date even
        // if it was provisioned before the most recent deploy.
        if (!migratedDbs.has(dbName)) {
            migratedDbs.add(dbName);
            try {
                await runTenantMigrations(entry.query, { label: dbName, transaction: entry.transaction });
            } catch (err) {
                logger.error({ err: (err as Error).message, dbName }, "Per-pool migrations failed (non-fatal)");
            }
        }

        logger.info({ dbName, poolCount: poolCache.size }, "Tenant pool created");
        return entry;
    })();

    pendingCreations.set(dbName, promise);
    try {
        return await promise;
    } finally {
        pendingCreations.delete(dbName);
    }
}

/**
 * Destroy a specific tenant pool (e.g., on tenant deletion).
 */
async function destroyTenantPool(dbName: string): Promise<void> {
    const entry = poolCache.get(dbName);
    if (entry) {
        await entry.pool.end();
        poolCache.delete(dbName);
        logger.info({ dbName }, "Tenant pool destroyed");
    }
}

/**
 * Destroy all cached tenant pools (for graceful shutdown).
 */
async function destroyAllPools(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [dbName, entry] of poolCache) {
        promises.push(entry.pool.end().catch(() => { }));
        logger.info({ dbName }, "Shutting down tenant pool");
    }
    poolCache.clear();
    await Promise.all(promises);
}

/**
 * Get pool size info for monitoring.
 */
function getPoolStats(): {
    poolCount: number;
    maxPools: number;
    poolSize: number;
    metrics: typeof poolMetrics & { hitRate: number; totalWaiting: number };
    pools: Record<string, unknown>;
} {
    const stats: Record<string, unknown> = {};
    let totalWaiting = 0;
    for (const [dbName, entry] of poolCache) {
        totalWaiting += entry.pool.waitingCount;
        stats[dbName] = {
            total: entry.pool.totalCount,
            idle: entry.pool.idleCount,
            waiting: entry.pool.waitingCount,
            lastUsed: entry.lastUsed,
        };
    }
    const lookups = poolMetrics.hits + poolMetrics.misses;
    return {
        poolCount: poolCache.size,
        maxPools: MAX_POOLS,
        poolSize: POOL_SIZE,
        metrics: {
            ...poolMetrics,
            hitRate: lookups === 0 ? 1 : poolMetrics.hits / lookups,
            totalWaiting,
        },
        pools: stats,
    };
}

export type { PoolEntry };
export {
    getTenantPool,
    destroyTenantPool,
    destroyAllPools,
    getPoolStats,
};
