export {};

jest.mock("../utils/password", () => ({
    BCRYPT_ROUNDS: 4,
    validatePassword: jest.fn().mockResolvedValue(null),
}));

const bcrypt = require("bcryptjs");
const { bootstrapPlatformAdmin } = require("../scripts/bootstrap-platform-admin");

function transactionWith(query: jest.Mock) {
    return (fn: any) => fn({ query });
}

const env = {
    PLATFORM_BOOTSTRAP_PASSWORD: "EnvironmentOnly1!",
    PLATFORM_BOOTSTRAP_EMAIL: "admin@example.test",
    PLATFORM_BOOTSTRAP_FULL_NAME: "Initial Admin",
};

describe("platform administrator CLI bootstrap", () => {
    test("creates exactly tenantless vvronline when both catalogs are empty", async () => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{}] })
            .mockResolvedValueOnce({ rows: [{ platform_users: 0, tenants: 0 }] })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await expect(bootstrapPlatformAdmin(transactionWith(query), env)).resolves.toBe("created");
        expect(query.mock.calls[0]).toEqual([
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            ["aino:bootstrap:platform-admin:v1"],
        ]);
        const insert = query.mock.calls[2];
        expect(insert[0]).toContain("must_change_password");
        expect(insert[1][0]).toBe("vvronline");
        expect(insert[1]).not.toContain(env.PLATFORM_BOOTSTRAP_PASSWORD);
        await expect(bcrypt.compare(env.PLATFORM_BOOTSTRAP_PASSWORD, insert[1][1])).resolves.toBe(true);
    });

    test.each([
        { platform_users: 1, tenants: 0 },
        { platform_users: 0, tenants: 1 },
    ])("is idempotently skipped unless both catalogs are empty", async (counts) => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{}] })
            .mockResolvedValueOnce({ rows: [counts] });
        await expect(bootstrapPlatformAdmin(transactionWith(query), env)).resolves.toBe("skipped");
        expect(query).toHaveBeenCalledTimes(2);
    });

    test("requires the password environment input", async () => {
        await expect(bootstrapPlatformAdmin(transactionWith(jest.fn()), {}))
            .rejects.toThrow(/PLATFORM_BOOTSTRAP_PASSWORD/);
    });

    test("allows email to be omitted", async () => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{}] })
            .mockResolvedValueOnce({ rows: [{ platform_users: 0, tenants: 0 }] })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await expect(bootstrapPlatformAdmin(transactionWith(query), {
            PLATFORM_BOOTSTRAP_PASSWORD: env.PLATFORM_BOOTSTRAP_PASSWORD,
        })).resolves.toBe("created");
        expect(query.mock.calls[2][1][3]).toBeNull();
    });
});
