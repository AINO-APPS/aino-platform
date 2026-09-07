/**
 * PostgreSQL database compatibility facade. Canonical database infrastructure
 * and schema ownership live under platform/db.
 */
import { pool, masterQuery, masterTransaction, query, transaction, makePoolQuery, makePoolTransaction } from "./platform/db/pool";
import { initMasterDB } from "./platform/db/masterSchema";
import { seedAgileDefaults } from "./platform/db/agileDefaults";
import { initializeDatabase } from "./platform/db/initializeDatabase";
import { initTenantSchema } from "./platform/db/tenantSchema";

async function initDB(): Promise<void> {
    await initializeDatabase(initTenantSchema);
}

export {
    pool, masterQuery, masterTransaction, query, transaction,
    makePoolQuery, makePoolTransaction,
    initDB, initMasterDB, initTenantSchema, seedAgileDefaults,
};
