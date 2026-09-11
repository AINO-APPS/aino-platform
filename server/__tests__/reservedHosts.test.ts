export {};

/**
 * RESERVED HOSTS — PR-B / item B2.
 *
 * The console hostname is the physical boundary between the control plane and
 * the application plane. Two things must hold, or the boundary collapses:
 *
 *   1. A reserved host never resolves to a tenant. If it did, a request to the
 *      console would run against a tenant database.
 *   2. A tenant cannot claim a reserved host as its custom_domain. If it could,
 *      it would take over the console.
 */

const reserved = require("../platform/reservedHosts");

const ORIGINAL_CONSOLE_HOST = process.env.CONSOLE_HOST;
const ORIGINAL_RESERVED = process.env.RESERVED_HOSTS;

beforeEach(() => {
    process.env.CONSOLE_HOST = "console.aino.org.in";
    delete process.env.RESERVED_HOSTS;
    reserved.__resetForTests();
});

afterAll(() => {
    if (ORIGINAL_CONSOLE_HOST === undefined) delete process.env.CONSOLE_HOST;
    else process.env.CONSOLE_HOST = ORIGINAL_CONSOLE_HOST;
    if (ORIGINAL_RESERVED === undefined) delete process.env.RESERVED_HOSTS;
    else process.env.RESERVED_HOSTS = ORIGINAL_RESERVED;
    reserved.__resetForTests();
});

describe("normalizeHost", () => {
    it("strips port, case and the FQDN trailing dot", () => {
        expect(reserved.normalizeHost("Console.AINO.org.in:8443")).toBe("console.aino.org.in");
        // A trailing dot is a valid FQDN spelling of the same host — without
        // normalising it, "console.aino.org.in." would bypass the reservation.
        expect(reserved.normalizeHost("console.aino.org.in.")).toBe("console.aino.org.in");
    });

    it("treats empty input as no host", () => {
        expect(reserved.normalizeHost(undefined)).toBe("");
        expect(reserved.normalizeHost(null)).toBe("");
    });
});

describe("isReservedHost", () => {
    it("recognises the configured console host in any spelling", () => {
        expect(reserved.isReservedHost("console.aino.org.in")).toBe(true);
        expect(reserved.isReservedHost("CONSOLE.aino.org.in:443")).toBe(true);
        expect(reserved.isReservedHost("console.aino.org.in.")).toBe(true);
    });

    it("does not reserve tenant or application hosts", () => {
        expect(reserved.isReservedHost("app.aino.org.in")).toBe(false);
        expect(reserved.isReservedHost("acme.com")).toBe(false);
        expect(reserved.isReservedHost("localhost")).toBe(false);
    });

    it("honours additional hosts from RESERVED_HOSTS", () => {
        process.env.RESERVED_HOSTS = "ops.aino.org.in, billing.aino.org.in";
        reserved.__resetForTests();
        expect(reserved.isReservedHost("ops.aino.org.in")).toBe(true);
        expect(reserved.isReservedHost("billing.aino.org.in")).toBe(true);
    });

    it("still reserves the well-known console names when CONSOLE_HOST is unset", () => {
        delete process.env.CONSOLE_HOST;
        reserved.__resetForTests();
        // Defensive: a tenant must not be able to claim these even before the
        // deployment has cut DNS over.
        expect(reserved.isReservedHost("console.aino.org.in")).toBe(true);
        expect(reserved.isReservedHost("admin.aino.org.in")).toBe(true);
    });
});

describe("requestHost — behind the Cloudflare Worker", () => {
    // infra/cloudflare/src/index.js rewrites the request URL to a Railway
    // origin and preserves the browser-visible name in X-Forwarded-Host. If
    // realm resolution read `Host` it would ALWAYS see the Railway hostname,
    // silently resolve every request to the tenant realm, and the console
    // would never be recognised in production.
    it("prefers X-Forwarded-Host over the rewritten Host header", () => {
        const req = {
            headers: {
                host: "aino-web.up.railway.app",
                "x-forwarded-host": "console.aino.org.in",
            },
        };
        expect(reserved.requestHost(req)).toBe("console.aino.org.in");
        expect(reserved.realmForRequest(req)).toBe("platform");
    });

    it("keeps the tenant realm for the application host behind the Worker", () => {
        const req = {
            headers: { host: "aino-web.up.railway.app", "x-forwarded-host": "aino.org.in" },
        };
        expect(reserved.realmForRequest(req)).toBe("tenant");
    });

    it("uses the first entry of a multi-proxy forwarded chain", () => {
        const req = {
            headers: {
                host: "aino-web.up.railway.app",
                "x-forwarded-host": "console.aino.org.in, internal.proxy",
            },
        };
        expect(reserved.requestHost(req)).toBe("console.aino.org.in");
    });

    it("falls back to Host when no proxy header is present (local dev)", () => {
        expect(reserved.requestHost({ headers: { host: "localhost:5000" } })).toBe("localhost");
    });

    it("normalises the forwarded host the same way as Host", () => {
        const req = { headers: { "x-forwarded-host": "CONSOLE.Aino.Org.In:443" } };
        expect(reserved.realmForRequest(req)).toBe("platform");
    });
});

describe("realmForHost", () => {
    it("maps the console host to the platform realm", () => {
        expect(reserved.realmForHost("console.aino.org.in")).toBe("platform");
    });

    it("maps every other host to the tenant realm", () => {
        expect(reserved.realmForHost("app.aino.org.in")).toBe("tenant");
        expect(reserved.realmForHost("acme.com")).toBe("tenant");
        expect(reserved.realmForHost(undefined)).toBe("tenant");
    });

    it("falls back to the tenant realm for everything when no console host is configured", () => {
        delete process.env.CONSOLE_HOST;
        process.env.RESERVED_HOSTS = "";
        reserved.__resetForTests();
        // Single-host deployments keep working exactly as before the split.
        expect(reserved.realmForHost("app.aino.org.in")).toBe("tenant");
        expect(reserved.consoleHost()).toBeNull();
    });
});
