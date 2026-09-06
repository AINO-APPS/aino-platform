/** Compatibility facade and tenant-wide migration orchestration. */
import { logger } from "./logger";
import type { QueryFn, TransactionFn } from "../types/domain";
import { runTenantMigrations, runMasterMigrations, expectedMigrationCount } from "../platform/db/migrations";

interface SweepTotals {
    applied: number;
    skipped: number;
    failed: number;
    tenants: number;
}

/**
 * Iterate every active tenant and apply pending migrations.
 * Called once at server startup (after `initDB()`).
 *
 * Loads tenantManager lazily so this compatibility facade remains lightweight;
 * tenantManager depends only on the canonical platform migration executor.
 */
async function sweepAllTenants(): Promise<SweepTotals> {
    const { forEachTenant } = require("./tenantManager");
    const totals: SweepTotals = { applied: 0, skipped: 0, failed: 0, tenants: 0 };

    await forEachTenant(async (db: { query: QueryFn; transaction?: TransactionFn }, tenant: { slug?: string; db_name?: string }) => {
        totals.tenants++;
        const label = tenant.slug || tenant.db_name;
        const r = await runTenantMigrations(db.query, { label, transaction: db.transaction });
        totals.applied += r.applied.length;
        totals.skipped += r.skipped;
        totals.failed += r.failed.length;
        // Surface per-tenant failures loudly. A silently-failing migration
        // (e.g. device_tokens never created) otherwise hides forever, breaking
        // features like push notifications with no obvious cause.
        if (r.failed.length > 0) {
            logger.error(
                { label, failedMigrations: r.failed },
                "Migration sweep: tenant has FAILED migrations — feature schema may be incomplete",
            );
        }
    }, { label: "migration-sweep" });

    if (totals.failed > 0) {
        logger.error(totals, "Migration sweep complete WITH FAILURES — see per-tenant errors above");
    } else {
        logger.info(totals, "Migration sweep complete");
    }
    return totals;
}

/**
 * One-off data scrub: remove platform admins that a historical login bug
 * seeded into CUSTOMER tenants.
 *
 * Background: `finishLogin()` used to home a platform admin in the *first
 * active tenant* instead of the *default platform tenant*, inserting a
 * visible `role='platform_admin'` users row into whichever customer tenant
 * was created first — plus a sticky `user_directory` row that kept routing
 * their logins there. Per the access model, platform admins must NEVER be
 * members of customer tenants (they use the consent-gated impersonation
 * flow instead), so those rows are illegitimate by definition.
 *
 * What this does, for every ACTIVE NON-default tenant:
 *   1. Deactivates + hides every VISIBLE platform_admin users row
 *      (`role = 'platform_admin' AND hidden_from_directory = FALSE`).
 *      The `hidden_from_directory = FALSE` filter precisely excludes the
 *      legitimate synthetic "Platform Inspector" rows created by the
 *      impersonation flow (those are hidden by design and must survive).
 *   2. Deletes the matching master `user_directory` rows so login routing
 *      and the tenant's user_count are corrected immediately.
 *
 * Idempotent and safe to run on every startup — once scrubbed, the WHERE
 * clauses match nothing.
 */
async function scrubPlatformAdminsFromCustomerTenants(): Promise<{ scrubbedUsers: number; scrubbedDirRows: number }> {
    const { masterQuery } = require('../db');
    const { getTenantPool } = require('./tenantManager');
    const totals = { scrubbedUsers: 0, scrubbedDirRows: 0 };

    let tenants: any[] = [];
    try {
        tenants = (await masterQuery(`
            SELECT id, slug, db_name, db_host
              FROM tenants
             WHERE status = 'active'
               AND (is_default IS NOT TRUE)
               AND db_name IS NOT NULL
        `)).rows;
    } catch (err: unknown) {
        logger.error({ err: (err as Error).message }, 'platform-admin scrub: failed to list tenants');
        return totals;
    }

    for (const t of tenants) {
        try {
            const db = await getTenantPool(t.db_name, t.db_host);
            // Find visible platform_admin rows (never the hidden inspector rows).
            const rows = (await db.query(`
                SELECT id, username, email
                  FROM users
                 WHERE role = 'platform_admin'
                   AND hidden_from_directory = FALSE
            `)).rows;
            if (rows.length === 0) continue;

            const ids = rows.map((r: any) => r.id);
            await db.query(
                `UPDATE users
                    SET is_active = FALSE, hidden_from_directory = TRUE
                  WHERE id = ANY($1::int[])`,
                [ids],
            );
            totals.scrubbedUsers += ids.length;

            // Remove the stale master directory rows so login routing and the
            // tenant's user_count are corrected.
            const dirRes = await masterQuery(
                `DELETE FROM user_directory
                  WHERE tenant_id = $1 AND user_id = ANY($2::int[])`,
                [t.id, ids],
            );
            totals.scrubbedDirRows += dirRes.rowCount || 0;

            logger.warn(
                { tenantId: t.id, slug: t.slug, users: rows.map((r: any) => r.username) },
                'platform-admin scrub: removed platform admin membership from customer tenant',
            );
        } catch (err: unknown) {
            logger.error(
                { err: (err as Error).message, tenantId: t.id, slug: t.slug },
                'platform-admin scrub: tenant iteration failed (non-fatal)',
            );
        }
    }

    if (totals.scrubbedUsers > 0) {
        logger.info(totals, 'platform-admin scrub complete');
    }
    return totals;
}

export {
    runTenantMigrations,
    runMasterMigrations,
    sweepAllTenants,
    scrubPlatformAdminsFromCustomerTenants,
    expectedMigrationCount,
};
