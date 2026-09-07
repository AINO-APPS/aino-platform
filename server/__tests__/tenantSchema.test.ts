export {};

const calls: string[] = [];
const mockLoggerInfo = jest.fn();

jest.mock("../platform/db/tenantSchema/core", () => ({
    initializeCoreTenantSchema: jest.fn(async () => { calls.push("core"); }),
}));
jest.mock("../platform/db/tenantSchema/communication", () => ({
    initializeCommunicationTenantSchema: jest.fn(async () => { calls.push("communication"); }),
}));
jest.mock("../platform/db/tenantSchema/operations", () => ({
    initializeOperationsTenantSchema: jest.fn(async () => { calls.push("operations"); }),
}));
jest.mock("../platform/db/tenantSchema/configuration", () => ({
    initializeConfigurationTenantSchema: jest.fn(async () => { calls.push("configuration"); }),
}));
jest.mock("../platform/db/tenantSchema/integrations", () => ({
    initializeIntegrationTenantSchema: jest.fn(async () => { calls.push("integrations"); }),
}));
jest.mock("../utils/logger", () => ({
    logger: { info: mockLoggerInfo },
}));

const { initTenantSchema } = require("../platform/db/tenantSchema");

describe("tenant schema composition", () => {
    beforeEach(() => {
        calls.length = 0;
        mockLoggerInfo.mockClear();
    });

    test("runs every schema phase in the historical dependency order", async () => {
        const query = jest.fn();

        await initTenantSchema(query);

        expect(calls).toEqual(["core", "communication", "operations", "configuration", "integrations"]);
        expect(mockLoggerInfo).toHaveBeenCalledWith("Tenant schema initialised");
    });
});