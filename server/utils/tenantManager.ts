/**
 * Tenant Database Lifecycle Manager.
 *
 * Manages per-tenant PostgreSQL databases and an LRU pool cache to keep
 * total connection count within Railway's limits (~97 usable).
 *
 * Pool strategy:
 *   - Master pool: max 10 connections (in db.js)
 *   - Active tenant pools: up to MAX_POOLS (10), each with POOL_SIZE (8)
 *   - Idle pools evicted after IDLE_TIMEOUT_MS (5 min)
 *   - Total worst case: 10 + 10×8 = 90 connections
 */
import { masterQuery, masterTransaction, initTenantSchema } from "../db";
import { runTenantMigrations } from "../platform/db/migrations";
import { getTenantPool, destroyTenantPool, destroyAllPools, getPoolStats } from "../platform/db/tenantPools";
import type { PoolEntry } from "../platform/db/tenantPools";
import { logger } from "./logger";
import type { TenantRow, DbContext } from "../types/domain";
import { forEachBounded } from "../platform/boundedParallel";

const FOREACH_CONCURRENCY = Math.max(1, parseInt(process.env.TENANT_FOREACH_CONCURRENCY || "", 10) || 5);

interface CreateTenantOpts {
    orgName: string;
    slug: string;
    plan?: string;
    features?: Record<string, unknown>;
    maxUsers?: number | null;
    maxStorageMb?: number | null;
}

interface ForEachTenantOpts {
    label?: string;
    includeLegacyMaster?: boolean;
}


// ── Tenant lifecycle ────────────────────────────────────────────────────────

/** PostgreSQL identifiers are capped at 63 bytes. */
const PG_IDENT_MAX = 63;

/**
 * Resolve a database name derived from `base` that is unused both in the
 * master `tenants` catalog and on the physical PostgreSQL cluster. Appends a
 * numeric suffix (`_1`, `_2`, …) on collision. This guards against reusing the
 * retained database of a soft-deleted tenant that shared the same slug.
 */
async function pickAvailableDbName(base: string): Promise<string> {
    const trimmedBase = base.slice(0, PG_IDENT_MAX);
    for (let i = 0; i < 1000; i++) {
        const suffix = i === 0 ? "" : `_${i}`;
        const candidate = i === 0
            ? trimmedBase
            : `${base.slice(0, PG_IDENT_MAX - suffix.length)}${suffix}`;

        const inCatalog = (await masterQuery(
            "SELECT 1 FROM tenants WHERE db_name = $1 LIMIT 1",
            [candidate],
        )).rows.length > 0;
        if (inCatalog) continue;

        const physicallyExists = (await masterQuery(
            "SELECT 1 FROM pg_database WHERE datname = $1 LIMIT 1",
            [candidate],
        )).rows.length > 0;
        if (physicallyExists) continue;

        return candidate;
    }
    throw new Error(`Could not allocate a unique database name for base "${base}"`);
}

/**
 * Create a new tenant database and initialise its schema.
 */
interface ShardRow {
    id: number;
    name: string;
    /** Empty string is the sentinel for "same host as DATABASE_URL". */
    host: string;
    tenant_count: number;
    capacity: number | null;
}

/**
 * A4: pick the shard a new tenant should live on.
 *
 * Strategy: least-loaded active shard that still has capacity. `capacity IS
 * NULL` means unlimited.
 *
 * Returns null when the `shards` table does not exist yet (the master
 * migration has not run) or no shard is eligible. Callers then leave
 * `db_host` NULL, and `getTenantPool()` falls back to the master host — which
 * is exactly the single-host behaviour that existed before sharding.
 *
 * This is the seam that turns "we outgrew one Postgres" from a rewrite into
 * inserting a row and pointing new tenants at it.
 */
async function pickShard(): Promise<ShardRow | null> {
    try {
        const res = await masterQuery(`
            SELECT id, name, host, tenant_count, capacity
              FROM shards
             WHERE is_active = TRUE
               AND (capacity IS NULL OR tenant_count < capacity)
             ORDER BY tenant_count ASC, id ASC
             LIMIT 1
        `);
        return (res.rows[0] as ShardRow) || null;
    } catch {
        // Table missing (pre-migration) — single-host mode.
        return null;
    }
}

async function createTenant(
    { orgName, slug, plan, features, maxUsers, maxStorageMb }: CreateTenantOpts,
): Promise<{ tenant: TenantRow; db: PoolEntry }> {
    const { getPlanLimits, PLAN_KEYS } = require("./planCatalog");
    const effectivePlan = PLAN_KEYS.includes(plan) ? plan : "standard";
    const planLimits = getPlanLimits(effectivePlan);

    // Allocate a database name that is free both in the master catalog AND on
    // the physical PostgreSQL cluster. This prevents a "new" tenant from
    // silently inheriting the data of a previously-deleted tenant that shared
    // the same slug (whose retained database still exists after a soft delete).
    const dbName = await pickAvailableDbName(`wp_${slug.replace(/-/g, "_")}`);

    // Sanitize: only allow safe identifiers to prevent DDL injection
    if (!/^wp_[a-z0-9_]+$/.test(dbName)) {
        throw new Error(`Invalid tenant database name: ${dbName}`);
    }

    // 0. Pre-check: verify the slug is actually available (not held by any non-deleted tenant).
    //    The UNIQUE constraint on tenants.slug would catch this at INSERT time,
    //    but an explicit check gives a clearer error and guards against edge cases
    //    where a soft-delete tombstone UPDATE failed silently.
    const existingBySlug = await masterQuery(
        "SELECT id FROM tenants WHERE slug = $1 AND status != 'deleted' LIMIT 1",
        [slug]
    );
    if (existingBySlug.rows.length > 0) {
        throw Object.assign(new Error("A tenant with that slug already exists."), { code: "23505" });
    }

    // 0b. A4: choose a shard. Placement is least-loaded among active shards
    //     with spare capacity. Returns null before the shards migration has
    //     run, or on a single-host deployment — in which case db_host stays
    //     NULL and getTenantPool() falls back to the master host.
    const shard = await pickShard();

    // 1. Register in master tenants catalog
    const result = await masterQuery(
        `INSERT INTO tenants (org_name, slug, db_name, db_host, shard_id, plan, features, max_users, max_storage_mb)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
            orgName, slug, dbName,
            shard?.host || null,
            shard?.id || null,
            effectivePlan, JSON.stringify(features || {}),
            maxUsers ?? planLimits.max_users,
            maxStorageMb ?? planLimits.max_storage_mb,
        ]
    );
    const tenant = result.rows[0] as TenantRow;

    // 2. Create the database (must use master connection; CREATE DATABASE cannot run inside a transaction)
    try {
        // Use a connecting directly to avoid parameterized DDL issues
        await masterQuery(`CREATE DATABASE "${dbName}"`);
    } catch (err) {
        // Any failure here (including a rare 42P04 race after our pre-check)
        // must roll back the catalog row so we never leave a tenant pointing
        // at a database we didn't freshly provision.
        await masterQuery("DELETE FROM tenants WHERE id = $1", [tenant.id]);
        throw err;
    }

    // 3. Connect to the new database and initialise schema.
    //
    //    IMPORTANT: initTenantSchema() alone is NOT the complete schema — 26
    //    objects (device_tokens/push, webauthn_credentials/biometric,
    //    users.mfa_*, burndown, retro votes, cycle-time columns) are created
    //    only by the migrations. Before A2 they arrived whenever a sweep
    //    happened to run, so a brand-new tenant could not receive push
    //    notifications until then. Running the migrations here closes that gap.
    const db = await getTenantPool(dbName, shard?.host || null);
    await initTenantSchema(db.query);

    const migResult = await runTenantMigrations(db.query, { label: dbName, transaction: db.transaction });
    if (migResult.failed.length > 0) {
        logger.error(
            { dbName, failed: migResult.failed },
            "New tenant has FAILED migrations — schema is incomplete",
        );
    }

    // Keep the shard's denormalised counter in step with reality.
    if (shard?.id) {
        await masterQuery(
            "UPDATE shards SET tenant_count = tenant_count + 1, updated_at = NOW() WHERE id = $1",
            [shard.id],
        ).catch(() => { /* counter drift is self-healing; never fail provisioning */ });
    }

    // 4. Create the organizations row inside the tenant DB (1 org per tenant DB)
    await db.query(
        `INSERT INTO organizations (id, name, slug, created_by)
         VALUES (1, $1, $2, NULL)
         ON CONFLICT (id) DO NOTHING`,
        [orgName, slug]
    );

    logger.info({ tenantId: tenant.id, dbName, slug }, "Tenant created");
    return { tenant, db };
}

/**
 * Drop a tenant database and remove from catalog.
 * DANGER: This permanently destroys all tenant data.
 *
 * @param tenantId
 * @param hardDelete - If true, DROP DATABASE. If false, just mark deleted.
 * @returns the tenant row that was deleted, or null if no such tenant existed.
 */
async function deleteTenant(tenantId: number, hardDelete = false): Promise<TenantRow | null> {
    const tenantRes = await masterQuery("SELECT * FROM tenants WHERE id = $1", [tenantId]);
    const tenant = tenantRes.rows[0] as TenantRow | undefined;
    if (!tenant) return null;

    // Close pool if cached
    await destroyTenantPool(tenant.db_name);

    if (hardDelete) {
        // Sanitize db_name before using in DDL to prevent injection
        if (!/^wp_[a-z0-9_]+$/.test(tenant.db_name)) {
            throw new Error(`Invalid tenant database name: ${tenant.db_name}`);
        }
        // Terminate active connections first
        await masterQuery(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [tenant.db_name]
        );
        await masterQuery(`DROP DATABASE IF EXISTS "${tenant.db_name}"`);
        await masterQuery("DELETE FROM user_directory WHERE tenant_id = $1", [tenantId]);
        await masterQuery("DELETE FROM tenants WHERE id = $1", [tenantId]);

        // A4.5: purge the tenant's uploads. Dropping the database alone would
        // leave every avatar, chat attachment and logo orphaned in object
        // storage, silently accruing cost and retaining customer data after a
        // deletion request.
        //
        // Best-effort: the database is already gone, so a storage failure must
        // not throw. It is logged loudly instead so it can be swept manually.
        try {
            const { getStorage, tenantPrefix } = require("../platform/storage");
            const removed = await getStorage().deletePrefix(tenantPrefix(tenantId));
            logger.info({ tenantId, objectsDeleted: removed }, "Tenant uploads purged from storage");
        } catch (err: unknown) {
            logger.error(
                { err: (err as Error).message, tenantId },
                "Failed to purge tenant uploads — objects may be orphaned in storage",
            );
        }

        logger.info({ tenantId, dbName: tenant.db_name }, "Tenant hard-deleted");
    } else {
        // Soft delete: retain the database + catalog row for audit/recovery,
        // but free the UNIQUE identifiers (slug, custom_domain) so the same
        // slug can be provisioned again as a brand-new tenant. The db_name is
        // left untouched so the retained data stays reachable; createTenant()
        // allocates a fresh, collision-free db_name for any future tenant.
        const tombstone = `_deleted_${tenantId}`;
        const tombstonedSlug = `${tenant.slug}${tombstone}`;
        const updateResult = await masterQuery(
            `UPDATE tenants
                SET status = 'deleted',
                    slug = $2,
                    custom_domain = NULL,
                    updated_at = NOW()
              WHERE id = $1
              RETURNING slug`,
            [tenantId, tombstonedSlug]
        );
        if (updateResult.rows.length === 0) {
            logger.error({ tenantId }, "Soft-delete tombstone UPDATE returned 0 rows — slug may not be freed");
        }
        // Drop the freed users from the global directory so their emails /
        // usernames can be reused and don't inflate cross-tenant lookups.
        await masterQuery("DELETE FROM user_directory WHERE tenant_id = $1", [tenantId]);
        logger.info({ tenantId, dbName: tenant.db_name, freedSlug: tenant.slug, tombstonedSlug }, "Tenant soft-deleted");
    }
    return tenant;
}

/**
 * Suspend a tenant — all API calls will get 503.
 */
async function suspendTenant(tenantId: number, reason?: string | null): Promise<void> {
    await masterQuery(
        `UPDATE tenants SET status = 'suspended', suspended_at = NOW(), suspended_reason = $2, updated_at = NOW()
         WHERE id = $1`,
        [tenantId, reason || null]
    );
    logger.info({ tenantId, reason }, "Tenant suspended");
}

/**
 * Reactivate a suspended tenant.
 */
async function reactivateTenant(tenantId: number): Promise<void> {
    await masterQuery(
        `UPDATE tenants SET status = 'active', suspended_at = NULL, suspended_reason = NULL, updated_at = NOW()
         WHERE id = $1`,
        [tenantId]
    );
    logger.info({ tenantId }, "Tenant reactivated");
}

/**
 * Get tenant record from master DB by ID.
 */
async function getTenantById(tenantId: number): Promise<TenantRow | null> {
    const res = await masterQuery("SELECT * FROM tenants WHERE id = $1", [tenantId]);
    return (res.rows[0] as TenantRow) || null;
}

/**
 * Get tenant record from master DB by slug.
 */
async function getTenantBySlug(slug: string): Promise<TenantRow | null> {
    const res = await masterQuery("SELECT * FROM tenants WHERE slug = $1", [slug]);
    return (res.rows[0] as TenantRow) || null;
}

/**
 * Get tenant record by custom domain.
 */
async function getTenantByDomain(domain: string): Promise<TenantRow | null> {
    const res = await masterQuery(
        `SELECT * FROM tenants WHERE custom_domain = $1 AND status != 'deleted'`,
        [domain.toLowerCase()]
    );
    return (res.rows[0] as TenantRow) || null;
}

/**
 * List all active tenants (for background jobs).
 */
async function listActiveTenants(): Promise<TenantRow[]> {
    const res = await masterQuery(
        `SELECT * FROM tenants WHERE status = 'active' ORDER BY id`
    );
    return res.rows as TenantRow[];
}

type ForEachTenantFn = (db: DbContext, tenant: Omit<Partial<TenantRow>, "id"> & { id: number | null; slug: string; db_name: string }) => Promise<unknown>;

/**
 * Iterate every active tenant and invoke `fn(db, tenant)` for each.
 *
 * - Errors are caught per-tenant so one failing tenant doesn't abort the
 *   whole sweep.
 * - Optionally also runs `fn` against the master DB if it isn't covered by
 *   any active tenant (legacy single-DB deployments still on the pre-
 *   migration `users` table).
 */
async function forEachTenant(fn: ForEachTenantFn, opts: ForEachTenantOpts = {}): Promise<{ ok: number; failed: number }> {
    const { label = "job", includeLegacyMaster = true } = opts;
    let ok = 0;
    let failed = 0;

    let tenants: TenantRow[] = [];
    try {
        tenants = await listActiveTenants();
    } catch (err) {
        logger.error({ err: (err as Error).message, label }, "forEachTenant: failed to list tenants");
        return { ok, failed };
    }

    // Bounded parallelism: tenant sweeps were fully serial, making bootstrap
    // and background jobs O(n) wall-clock. Five workers gives a ~5x speed-up
    // without opening every tenant pool at once.
    await forEachBounded(tenants, FOREACH_CONCURRENCY, async (tenant) => {
            try {
                const db = await getTenantPool(tenant.db_name, tenant.db_host);
                await fn(db as unknown as DbContext, tenant);
                ok++;
            } catch (err) {
                failed++;
                logger.error({
                    err: (err as Error).message,
                    stack: (err as Error).stack,
                    tenantId: tenant.id,
                    slug: tenant.slug,
                    label,
                }, "forEachTenant: tenant iteration failed");
            }
    });

    if (includeLegacyMaster) {
        try {
            const masterDbName = new URL(process.env.DATABASE_URL as string).pathname.slice(1);
            const masterCovered = tenants.some(t => t.db_name === masterDbName);
            if (!masterCovered) {
                // Only run against master if it actually has a `users` table
                // (i.e. legacy single-DB deployment pre-migration).
                const hasUsers = (await masterQuery(`
                    SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'users' LIMIT 1
                `)).rows.length > 0;
                if (hasUsers) {
                    try {
                        await fn(
                            { query: masterQuery, transaction: masterTransaction } as unknown as DbContext,
                            { id: null, slug: "master", db_name: masterDbName },
                        );
                        ok++;
                    } catch (err) {
                        failed++;
                        logger.error({
                            err: (err as Error).message,
                            stack: (err as Error).stack,
                            label,
                        }, "forEachTenant: master legacy iteration failed");
                    }
                }
            }
        } catch { /* ignore – best-effort master coverage */ }
    }

    return { ok, failed };
}


export {
    // Pool management
    getTenantPool,
    destroyTenantPool,
    destroyAllPools,
    getPoolStats,
    // Tenant lifecycle
    createTenant,
    deleteTenant,
    suspendTenant,
    reactivateTenant,
    // Tenant queries
    getTenantById,
    getTenantBySlug,
    getTenantByDomain,
    listActiveTenants,
    forEachTenant,
};
