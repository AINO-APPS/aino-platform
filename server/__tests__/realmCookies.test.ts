export {};

/**
 * REALM COOKIES — PR-B / item B3.
 *
 * Each realm owns a distinct cookie name and neither sets a `domain`
 * attribute, so the browser scopes each to the host that issued it. Once the
 * console runs on its own hostname, the control-plane session is physically
 * incapable of being sent to the application host — a stronger guarantee than
 * any server-side check, and the reason PR-B provisions a separate host
 * rather than a path prefix.
 */

const cookieUtil = require("../utils/cookie");
const reserved = require("../platform/reservedHosts");

const CONSOLE = "console.aino.org.in";
const APP = "app.aino.org.in";

const req = (host: string, extra: Record<string, unknown> = {}) => ({
    headers: { host, ...(extra.headers as object || {}) },
    cookies: (extra.cookies as object) || {},
});

const ORIGINAL_CONSOLE_HOST = process.env.CONSOLE_HOST;

beforeEach(() => {
    process.env.CONSOLE_HOST = CONSOLE;
    reserved.__resetForTests();
});

afterAll(() => {
    if (ORIGINAL_CONSOLE_HOST === undefined) delete process.env.CONSOLE_HOST;
    else process.env.CONSOLE_HOST = ORIGINAL_CONSOLE_HOST;
    reserved.__resetForTests();
});

describe("cookie naming", () => {
    it("keeps the tenant cookie name unchanged so existing sessions survive deploy", () => {
        expect(cookieUtil.TENANT_COOKIE).toBe("token");
    });

    it("uses a distinct name for the control-plane session", () => {
        expect(cookieUtil.PLATFORM_COOKIE).toBe("aino_console");
        expect(cookieUtil.PLATFORM_COOKIE).not.toBe(cookieUtil.TENANT_COOKIE);
    });

    it("derives the cookie name from the host", () => {
        expect(cookieUtil.cookieNameForRequest(req(CONSOLE))).toBe("aino_console");
        expect(cookieUtil.cookieNameForRequest(req(APP))).toBe("token");
    });
});

describe("cookie attributes", () => {
    it("never sets a domain attribute, so cookies stay host-scoped", () => {
        // This is the whole isolation mechanism: with no `domain`, the browser
        // will not send the console cookie to the app host or vice-versa.
        expect(cookieUtil.cookieOptions(req(CONSOLE) as any)).not.toHaveProperty("domain");
        expect(cookieUtil.cookieOptions(req(APP) as any)).not.toHaveProperty("domain");
    });

    it("keeps the console cookie SameSite=strict even for a desktop origin", () => {
        // The Electron desktop app needs SameSite=none on the TENANT cookie.
        // The console is browser-only, so it must never be relaxed — otherwise
        // the control-plane cookie would ride along on cross-site requests.
        const desktop = { headers: { host: CONSOLE, origin: "aino://app" }, cookies: {} };
        expect(cookieUtil.cookieOptions(desktop as any).sameSite).toBe("strict");
    });

    it("still relaxes SameSite for the desktop app on the tenant host", () => {
        const desktop = { headers: { host: APP, origin: "aino://app" }, cookies: {} };
        const opts = cookieUtil.cookieOptions(desktop as any);
        expect(opts.sameSite).toBe("none");
        expect(opts.secure).toBe(true);
    });
});

describe("readAuthToken", () => {
    it("reads the realm's own cookie", () => {
        expect(cookieUtil.readAuthToken(req(CONSOLE, { cookies: { aino_console: "P" } }))).toBe("P");
        expect(cookieUtil.readAuthToken(req(APP, { cookies: { token: "T" } }))).toBe("T");
    });

    it("does not fall back to the other realm's cookie", () => {
        // A console request carrying only a tenant cookie has no console
        // session — it must not be silently authenticated with the tenant one.
        expect(cookieUtil.readAuthToken(req(CONSOLE, { cookies: { token: "T" } }))).toBeNull();
        expect(cookieUtil.readAuthToken(req(APP, { cookies: { aino_console: "P" } }))).toBeNull();
    });

    it("accepts a Bearer token on the tenant host for native mobile", () => {
        const r = { headers: { host: APP, authorization: "Bearer MOBILE" }, cookies: {} };
        expect(cookieUtil.readAuthToken(r)).toBe("MOBILE");
    });

    it("ignores Bearer tokens on the console host", () => {
        // The console is a browser surface; there is no mobile console client,
        // so allowing a bearer header would only widen the attack surface.
        const r = { headers: { host: CONSOLE, authorization: "Bearer MOBILE" }, cookies: {} };
        expect(cookieUtil.readAuthToken(r)).toBeNull();
    });

    it("prefers the cookie over a Bearer header", () => {
        const r = { headers: { host: APP, authorization: "Bearer B" }, cookies: { token: "C" } };
        expect(cookieUtil.readAuthToken(r)).toBe("C");
    });
});
