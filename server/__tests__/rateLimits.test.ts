export {};

const initRedis = jest.fn();
const call = jest.fn();
const getClient = jest.fn();
const stores: any[] = [];

jest.mock("../redis", () => ({ initRedis, getClient }));
jest.mock("rate-limit-redis", () => ({
    RedisStore: jest.fn().mockImplementation((options: any) => {
        stores.push(options);
        return { options };
    }),
}));
jest.mock("express-rate-limit", () => {
    const rateLimit: any = jest.fn((options: any) => options);
    rateLimit.ipKeyGenerator = (ip: string) => ip;
    return rateLimit;
});

describe("distributed rate-limit stores", () => {
    const oldRedisUrl = process.env.REDIS_URL;

    beforeEach(() => {
        process.env.REDIS_URL = "redis://example.invalid:6379";
        stores.length = 0;
        initRedis.mockReset().mockResolvedValue(undefined);
        call.mockReset().mockResolvedValue("ok");
        getClient.mockReset().mockReturnValue({ call });
    });

    afterAll(() => {
        if (oldRedisUrl === undefined) delete process.env.REDIS_URL;
        else process.env.REDIS_URL = oldRedisUrl;
    });

    test("waits for Redis initialization before issuing store commands", async () => {
        const { createRateLimiters } = require("../http/middleware/rateLimits");
        createRateLimiters();
        const result = await stores[0].sendCommand("SCRIPT", "LOAD", "return 1");

        expect(initRedis).toHaveBeenCalledTimes(1);
        expect(getClient).toHaveBeenCalledTimes(1);
        expect(call).toHaveBeenCalledWith("SCRIPT", "LOAD", "return 1");
        expect(result).toBe("ok");
        expect(initRedis.mock.invocationCallOrder[0]).toBeLessThan(getClient.mock.invocationCallOrder[0]);
    });

    test("rejects clearly when initialization completes without a client", async () => {
        getClient.mockReturnValue(null);
        const { createRateLimiters } = require("../http/middleware/rateLimits");
        createRateLimiters();

        await expect(stores[0].sendCommand("PING")).rejects.toThrow("Redis unavailable after initialization");
    });
});