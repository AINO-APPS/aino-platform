import type { DbContext } from "../../types/domain";
import { countAppliedMigrations } from "./internal.repository";

interface TenantIdentity { slug?: string; db_name: string; }
interface Dependencies {
    expectedMigrationCount: number;
    forEachTenant: (
        visit: (db: DbContext, tenant: TenantIdentity) => Promise<void>,
        options: { label: string; includeLegacyMaster: boolean },
    ) => Promise<{ ok: number; failed: number }>;
}

export function createInternalService(deps: Dependencies) {
    return {
        async getMigrationStatus() {
            const tenants: Record<string, number> = {};
            let minApplied = Infinity;
            const sweep = await deps.forEachTenant(async (db, tenant) => {
                const count = await countAppliedMigrations(db);
                tenants[tenant.slug || tenant.db_name] = count;
                if (count < minApplied) minApplied = count;
            }, { label: "migration-status", includeLegacyMaster: true });
            if (minApplied === Infinity) minApplied = 0;
            const ok = sweep.failed === 0
                && (sweep.ok === 0 || minApplied >= deps.expectedMigrationCount);
            return {
                status: ok ? "ok" : "degraded",
                expected: deps.expectedMigrationCount,
                minApplied,
                tenants,
                unreachableTenants: sweep.failed,
            };
        },
    };
}