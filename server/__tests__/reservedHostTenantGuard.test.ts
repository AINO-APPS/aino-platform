export {};

/**
 * RESERVED HOST → NEVER A TENANT — PR-B / item B2.
 *
 * `resolveTenant` must attach the MASTER database on a reserved host, no
 * matter what the request carries. Two attack shapes are covered:
 *
 *   - a JWT whose `tenant_id` claim points at a tenant
 *   - a stale `tenants.custom_domain` row pointing at the console host
 *
 * Either one succeeding would mean a console request executing against a
 * tenant database — the exact failure the plane split exists to prevent.
 */

// jest.setup.ts replaces middleware/tenant with a pass-through stub for route
// suites. This suite tests the real implementation, so opt out of that mock.
jest.unmock("../middleware/tenant");

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

const mockGetTenantById = jest.fn();
const mockGetTenantPool = jest.fn();
const mockMasterQuery = jest.fn();

jest.mock("../utils/tenantManager", () => ({
    getTenantById: (...a: any[]) => mockGetTenantById(...a),
    getTenantPool: (...a: any[]) => mockGetTenantPool(...a),
}));
jest.mock("../db", () => ({
    masterQuery: (...a: any[]) => mockMasterQuery(...a),
    masterTransaction: jest.fn(),
    pool: { totalCount: 0 },
}));
jest.mock("../redis", () => ({
    get: jest.fn(async () => null),
    set: jest.fn(async () => undefined),
    del: jest.fn(async () => undefined),
}));

import jwt from "jsonwebtoken";

const SECRET = "reserved-host-guard-secret";
const CONSOLE = "console.aino.org.in";
const APP = "app.aino.org.in";

const reserved = require("../platform/reservedHosts");
const { resolveTenant } = require("../middleware/tenant");

const ORIGINAL = { CONSOLE_HOST: process.env.CONSOLE_HOST, JWT_SECRET: process.env.JWT_SECRET };

function run(host: string, cookies: Record<string, string> = {}) {
    const req: any = { headers: { host }, cookies };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    const next = jest.fn();
    return resolveTenant(req, res, next).then(() => ({ req, res, next }));
}

beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    process.env.CONSOLE_HOST = CONSOLE;
    delete process.env.STRICT_REALM;
    reserved.__resetForTests();
    mockGetTenantById.mockReset();
    mockGetTenantPool.mockReset();
    mockMasterQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});

afterAll(() => {
    for (const [k, v] of Object.entries(ORIGINAL)) {
        if (v === undefined) delete (process.env as any)[k];
        else (process.env as any)[k] = v;
    }
    reserved.__resetForTests();
});

describe("resolveTenant on a reserved host", () => {
    it("attaches master context and never looks up a tenant", async () => {
        const { req, next } = await run(CONSOLE);

        expect(next).toHaveBeenCalled();
        expect(req.tenant).toBeNull();
        expect(req.isMasterRoute).toBe(true);
        expect(req.realm).toBe("platform");
        expect(mockGetTenantById).not.toHaveBeenCalled();
        expect(mockGetTenantPool).not.toHaveBeenCalled();
    });

    it("ignores a tenant_id claim carried by a platform token", async () => {
        // Even a validly-signed token claiming a tenant must not pull a tenant
        // pool onto a console request.
        const token = jwt.sign({ id: 41, tenant_id: 7, aud: "platform" }, SECRET, { expiresIn: "1h" });
        const { req } = await run(CONSOLE, { aino_console: token });

        expect(req.tenant).toBeNull();
        expect(req.isMasterRoute).toBe(true);
        expect(mockGetTenantById).not.toHaveBeenCalled();
    });

    it("never consults custom_domain for a reserved host", async () => {
        await run(CONSOLE);
        // A stale tenants.custom_domain row pointing at the console must not
        // even be read, let alone honoured.
        const domainLookups = mockMasterQuery.mock.calls
            .filter((c: any[]) => /custom_domain/i.test(String(c[0])));
        expect(domainLookups).toHaveLength(0);
    });
});

describe("resolveTenant on the application host", () => {
    it("still resolves a tenant from a tenant token", async () => {
        mockGetTenantById.mockResolvedValue({
            id: 7, slug: "acme", status: "active", db_name: "wp_acme", db_host: null,
        });
        mockGetTenantPool.mockResolvedValue({ query: jest.fn(), transaction: jest.fn(), pool: {} });

        const token = jwt.sign({ id: 1, tenant_id: 7, aud: "tenant" }, SECRET, { expiresIn: "1h" });
        const { req, next } = await run(APP, { token });

        expect(next).toHaveBeenCalled();
        expect(req.tenant?.id).toBe(7);
        expect(req.isMasterRoute).toBe(false);
    });

    it("refuses to resolve a tenant from a platform-realm token", async () => {
        // Wrong realm for this host: the token is rejected, so no tenant pool
        // is attached and auth middleware will 401.
        const token = jwt.sign({ id: 41, tenant_id: 7, aud: "platform" }, SECRET, { expiresIn: "1h" });
        const { req } = await run(APP, { token });

        expect(mockGetTenantById).not.toHaveBeenCalled();
        expect(req.isMasterRoute).toBe(true);
    });
});
