export {};

/**
 * REALM AUDIENCE — PR-B / item B4.
 *
 * A token minted for one plane must never authenticate a request on the other,
 * even though both planes share a JWT secret and a process. The `aud` claim
 * carries the realm; the Host header determines which realm is expected.
 *
 * Also covers the grace window: tokens issued before PR-B have no `aud` and
 * would sign every user out on deploy if rejected outright. They are accepted
 * — but ONLY as tenant tokens, so a legacy token can never reach the console.
 */

jest.mock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), fatal: jest.fn() },
}));

import jwt from "jsonwebtoken";

const SECRET = "test-secret-for-realm-audience-suite";
const APP_HOST = "app.aino.org.in";
const CONSOLE = "console.aino.org.in";

const realm = require("../platform/realm");
const reserved = require("../platform/reservedHosts");

function sign(payload: Record<string, unknown>): string {
    return jwt.sign(payload, SECRET, { expiresIn: "8h" });
}

const req = (host: string) => ({ headers: { host } });

const ORIGINAL = {
    CONSOLE_HOST: process.env.CONSOLE_HOST,
    STRICT_REALM: process.env.STRICT_REALM,
    JWT_SECRET: process.env.JWT_SECRET,
};

beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    process.env.CONSOLE_HOST = CONSOLE;
    delete process.env.STRICT_REALM;
    reserved.__resetForTests();
});

afterAll(() => {
    for (const [k, v] of Object.entries(ORIGINAL)) {
        if (v === undefined) delete (process.env as any)[k];
        else (process.env as any)[k] = v;
    }
    reserved.__resetForTests();
});

describe("matching realms", () => {
    it("accepts a tenant token on the app host", () => {
        const token = sign({ id: 1, tenant_id: 7, aud: "tenant" });
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(true);
        expect(r.realm).toBe("tenant");
        expect(r.legacy).toBe(false);
    });

    it("accepts a platform token on the console host", () => {
        const token = sign({ id: 41, tenant_id: null, aud: "platform" });
        const r = realm.verifyRealmToken(token, req(CONSOLE));
        expect(r.ok).toBe(true);
        expect(r.realm).toBe("platform");
    });
});

describe("cross-realm rejection", () => {
    it("rejects a platform token presented to the app host", () => {
        const token = sign({ id: 41, aud: "platform" });
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("wrong_realm");
        expect(r.expected).toBe("tenant");
        expect(r.actual).toBe("platform");
    });

    it("rejects a tenant token presented to the console host", () => {
        // The important direction: a compromised or replayed tenant session
        // must not reach the control plane.
        const token = sign({ id: 1, tenant_id: 7, aud: "tenant" });
        const r = realm.verifyRealmToken(token, req(CONSOLE));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("wrong_realm");
        expect(r.expected).toBe("platform");
    });

    it("reports a bad signature as invalid, not as a realm mismatch", () => {
        const token = jwt.sign({ id: 1, aud: "tenant" }, "a-different-secret");
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("invalid");
    });

    it("rejects an expired token as invalid", () => {
        const token = jwt.sign({ id: 1, aud: "tenant" }, SECRET, { expiresIn: "-1s" });
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("invalid");
    });
});

describe("grace window for pre-PR-B tokens", () => {
    it("accepts a realmless token on the app host and flags it legacy", () => {
        const token = sign({ id: 1, tenant_id: 7 });
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(true);
        expect(r.realm).toBe("tenant");
        expect(r.legacy).toBe(true);
    });

    it("NEVER accepts a realmless token on the console host", () => {
        // Legacy tokens predate the control plane; treating one as a platform
        // session would be a privilege escalation.
        const token = sign({ id: 41 });
        const r = realm.verifyRealmToken(token, req(CONSOLE));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("wrong_realm");
    });

    it("rejects realmless tokens once STRICT_REALM is enabled", () => {
        process.env.STRICT_REALM = "true";
        const token = sign({ id: 1, tenant_id: 7 });
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(false);
        expect(r.reason).toBe("wrong_realm");
    });
});

describe("aud parsing", () => {
    it("accepts an array-valued aud (RFC 7519 allows it)", () => {
        const token = sign({ id: 1, aud: ["tenant"] });
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(true);
        expect(r.realm).toBe("tenant");
    });

    it("treats an unrecognised aud as absent rather than trusting it", () => {
        process.env.STRICT_REALM = "true";
        const token = sign({ id: 1, aud: "root" });
        const r = realm.verifyRealmToken(token, req(APP_HOST));
        expect(r.ok).toBe(false);
    });
});

describe("single-host deployments", () => {
    it("treats every host as the tenant realm when CONSOLE_HOST is unset", () => {
        delete process.env.CONSOLE_HOST;
        process.env.RESERVED_HOSTS = "";
        reserved.__resetForTests();

        const token = sign({ id: 1, tenant_id: 7, aud: "tenant" });
        expect(realm.verifyRealmToken(token, req(APP_HOST)).ok).toBe(true);

        delete process.env.RESERVED_HOSTS;
        reserved.__resetForTests();
    });
});
