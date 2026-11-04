import { logger } from "../../utils/logger";
import type { SchemaQuery } from "./schemaTypes";
import { initializeCoreTenantSchema } from "./tenantSchema/core";
import { initializeCommunicationTenantSchema } from "./tenantSchema/communication";
import { initializeOperationsTenantSchema } from "./tenantSchema/operations";
import { initializeConfigurationTenantSchema } from "./tenantSchema/configuration";
import { initializeIntegrationTenantSchema } from "./tenantSchema/integrations";
import { initializeWorklogSchema } from "./tenantSchema/worklogs";

/** Initialise the tenant schema in its historical dependency order. */
async function initTenantSchema(q: SchemaQuery): Promise<void> {
    await initializeCoreTenantSchema(q);
    await initializeCommunicationTenantSchema(q);
    await initializeOperationsTenantSchema(q);
    await initializeConfigurationTenantSchema(q);
    await initializeIntegrationTenantSchema(q);
    await initializeWorklogSchema(q);
    logger.info("Tenant schema initialised");
}

export { initTenantSchema };
