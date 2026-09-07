export {};

const mockConnect = jest.fn();
const mockPoolOn = jest.fn();
const mockPool = { connect: mockConnect, on: mockPoolOn };
const mockPoolConstructor = jest.fn(() => mockPool);

jest.mock("pg", () => ({ Pool: mockPoolConstructor }));
jest.mock("../utils/logger", () => ({
    logger: { fatal: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

const poolModule = require("../platform/db/pool");

describe("database pool boundary", () => {
    beforeEach(() => {
        mockConnect.mockReset();
    });

    test("creates one bounded master pool and preserves compatibility aliases", () => {
        expect(mockPoolConstructor).toHaveBeenCalledTimes(1);
        expect(mockPoolConstructor).toHaveBeenCalledWith(expect.objectContaining({
            connectionString: process.env.DATABASE_URL,
            max: 4,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000,
        }));
        expect(poolModule.query).toBe(poolModule.masterQuery);
        expect(poolModule.transaction).toBe(poolModule.masterTransaction);
    });

    test("keeps the legacy db facade bound to the canonical pool exports", () => {
        const db = require("../db");
        const masterSchema = require("../platform/db/masterSchema");
        const agileDefaults = require("../platform/db/agileDefaults");

        expect(db.pool).toBe(poolModule.pool);
        expect(db.masterQuery).toBe(poolModule.masterQuery);
        expect(db.masterTransaction).toBe(poolModule.masterTransaction);
        expect(db.query).toBe(poolModule.query);
        expect(db.transaction).toBe(poolModule.transaction);
        expect(db.makePoolQuery).toBe(poolModule.makePoolQuery);
        expect(db.makePoolTransaction).toBe(poolModule.makePoolTransaction);
        expect(db.initMasterDB).toBe(masterSchema.initMasterDB);
        expect(db.seedAgileDefaults).toBe(agileDefaults.seedAgileDefaults);
    });

    test("releases a connected client after successful and failed queries", async () => {
        const successClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }), release: jest.fn() };
        mockConnect.mockResolvedValueOnce(successClient);

        await expect(poolModule.makePoolQuery(mockPool)("SELECT 1", [1])).resolves.toEqual({ rows: [{ id: 1 }] });
        expect(successClient.release).toHaveBeenCalledTimes(1);

        const failure = new Error("query failed");
        const failureClient = { query: jest.fn().mockRejectedValue(failure), release: jest.fn() };
        mockConnect.mockResolvedValueOnce(failureClient);

        await expect(poolModule.makePoolQuery(mockPool)("SELECT broken")).rejects.toBe(failure);
        expect(failureClient.release).toHaveBeenCalledTimes(1);
    });

    test("commits successful transactions on one client and releases it", async () => {
        const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
        mockConnect.mockResolvedValue(client);

        const result = await poolModule.makePoolTransaction(mockPool)(async (tx: any) => {
            expect(tx).toBe(client);
            await tx.query("SELECT work");
            return "done";
        });

        expect(result).toBe("done");
        expect(client.query.mock.calls.map((call: any[]) => call[0])).toEqual(["BEGIN", "SELECT work", "COMMIT"]);
        expect(client.release).toHaveBeenCalledTimes(1);
    });

    test("rolls back failed transactions and releases the client", async () => {
        const failure = new Error("work failed");
        const client = { query: jest.fn().mockResolvedValue({ rows: [] }), release: jest.fn() };
        mockConnect.mockResolvedValue(client);

        await expect(poolModule.makePoolTransaction(mockPool)(async () => {
            throw failure;
        })).rejects.toBe(failure);

        expect(client.query.mock.calls.map((call: any[]) => call[0])).toEqual(["BEGIN", "ROLLBACK"]);
        expect(client.release).toHaveBeenCalledTimes(1);
    });
});