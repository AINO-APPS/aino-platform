export {};

const calls: string[] = [];
const mockMasterQuery = jest.fn();
const mockInitMasterDB = jest.fn(async () => { calls.push("master"); });
const mockSeedAgileDefaults = jest.fn(async () => { calls.push("seed"); });
const mockLoggerWarn = jest.fn();
const mockLoggerInfo = jest.fn();

jest.mock("../platform/db/pool", () => ({ masterQuery: mockMasterQuery }));
jest.mock("../platform/db/masterSchema", () => ({ initMasterDB: mockInitMasterDB }));
jest.mock("../platform/db/agileDefaults", () => ({ seedAgileDefaults: mockSeedAgileDefaults }));
jest.mock("../utils/logger", () => ({
    logger: { warn: mockLoggerWarn, info: mockLoggerInfo, error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

const { initializeDatabase } = require("../platform/db/initializeDatabase");

describe("database initialization composition", () => {
    beforeEach(() => {
        calls.length = 0;
        mockInitMasterDB.mockClear();
        mockSeedAgileDefaults.mockReset().mockImplementation(async () => { calls.push("seed"); });
        mockLoggerWarn.mockReset();
        mockLoggerInfo.mockReset();
    });

    test("initializes master, legacy tenant schema and Agile defaults in order", async () => {
        const initTenantSchema = jest.fn(async (query: unknown) => {
            expect(query).toBe(mockMasterQuery);
            calls.push("tenant");
        });

        await initializeDatabase(initTenantSchema);

        expect(calls).toEqual(["master", "tenant", "seed"]);
        expect(mockLoggerInfo).toHaveBeenCalledWith("Database schema initialised (master + legacy tenant tables)");
    });

    test("keeps Agile default seeding non-fatal", async () => {
        const failure = new Error("seed failed");
        mockSeedAgileDefaults.mockRejectedValueOnce(failure);

        await expect(initializeDatabase(jest.fn().mockResolvedValue(undefined))).resolves.toBeUndefined();

        expect(mockLoggerWarn).toHaveBeenCalledWith(
            { err: "seed failed" },
            "Agile defaults seeding failed in initDB (non-fatal)",
        );
    });
});