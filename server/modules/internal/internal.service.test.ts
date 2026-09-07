import { createInternalService } from "./internal.service";

describe("internal migration status", () => {
    const db = {
        query: jest.fn(),
        transaction: jest.fn(),
        tenantId: 1,
    };

    beforeEach(() => db.query.mockReset());

    test("reports healthy when every reachable database is current", async () => {
        db.query.mockResolvedValue({ rows: [{ count: 4 }], rowCount: 1 });
        const service = createInternalService({
            expectedMigrationCount: 4,
            forEachTenant: async (visit) => {
                await visit(db, { slug: "acme", db_name: "acme" });
                return { ok: 1, failed: 0 };
            },
        });
        await expect(service.getMigrationStatus()).resolves.toEqual({
            status: "ok", expected: 4, minApplied: 4,
            tenants: { acme: 4 }, unreachableTenants: 0,
        });
    });

    test("reports degraded when a tenant is unreachable", async () => {
        const service = createInternalService({
            expectedMigrationCount: 4,
            forEachTenant: async () => ({ ok: 1, failed: 1 }),
        });
        await expect(service.getMigrationStatus()).resolves.toMatchObject({
            status: "degraded", unreachableTenants: 1,
        });
    });

    test("treats an empty fresh platform as healthy with zero applied", async () => {
        const service = createInternalService({
            expectedMigrationCount: 4,
            forEachTenant: async () => ({ ok: 0, failed: 0 }),
        });
        await expect(service.getMigrationStatus()).resolves.toEqual({
            status: "ok", expected: 4, minApplied: 0,
            tenants: {}, unreachableTenants: 0,
        });
    });
});