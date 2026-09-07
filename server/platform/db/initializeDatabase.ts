import { logger } from "../../utils/logger";
import { masterQuery } from "./pool";
import { initMasterDB } from "./masterSchema";
import { seedAgileDefaults } from "./agileDefaults";
import type { SchemaQuery } from "./schemaTypes";

async function initializeDatabase(initTenantSchema: (query: SchemaQuery) => Promise<void>): Promise<void> {
    await initMasterDB();
    // Legacy: also initialise tenant schema in master DB so existing single-DB
    // deployments keep working until fully migrated to per-tenant databases.
    await initTenantSchema(masterQuery);
    try {
        await seedAgileDefaults(masterQuery);
    } catch (err: unknown) {
        logger.warn({ err: (err as Error).message }, "Agile defaults seeding failed in initDB (non-fatal)");
    }
    logger.info("Database schema initialised (master + legacy tenant tables)");
}

export { initializeDatabase };
