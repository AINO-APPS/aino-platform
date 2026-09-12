/**
 * Reserved hostnames — the physical control-plane / application-plane boundary.
 *
 * PR-B of the platform/tenant separation train. See
 * docs/PLATFORM_TENANT_SEPARATION_PLAN.md and ADR-009.
 *
 * The Platform Console is served from its own hostname (`CONSOLE_HOST`,
 * e.g. console.aino.org.in). That single fact buys three properties that
 * middleware discipline alone cannot:
 *
 *   1. COOKIE ISOLATION. Cookies are host-scoped by the browser when no
 *      `domain` attribute is set (see utils/cookie.ts). A console session
 *      cookie is therefore physically unable to be sent to the application
 *      host, and vice-versa. There is no code path that can leak one into
 *      the other because the browser will not do it.
 *   2. UNAMBIGUOUS REALM. The host tells us which realm a request belongs to
 *      before any token is parsed, so `middleware/auth.ts` knows which cookie
 *      to read and which `aud` to require.
 *   3. NO TENANT RESOLUTION. `middleware/tenant.ts` must never map a reserved
 *      host onto a tenant, or a tenant that claimed the console domain would
 *      hijack the control plane.
 *
 * This mirrors how the market separates provider consoles from the product:
 * Atlassian (admin.atlassian.com), AWS (console.aws.amazon.com), Auth0
 * (manage.auth0.com).
 */

/** Realm a request belongs to. Encoded in the JWT `aud` claim. */
export type Realm = "tenant" | "platform";

export const TENANT_REALM: Realm = "tenant";
export const PLATFORM_REALM: Realm = "platform";

/**
 * Hostnames that always belong to the control plane and can never be claimed
 * by a tenant as a custom domain.
 *
 * `CONSOLE_HOST` is the deployment's console hostname. The extra literals are
 * defensive: they are hostnames an operator would plausibly point at this
 * service, and letting a tenant claim one would be a takeover vector.
 * `RESERVED_HOSTS` may add more via a comma-separated env var.
 */
function buildReservedSet(): Set<string> {
    const extra = (process.env.RESERVED_HOSTS || "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

    return new Set(
        [
            process.env.CONSOLE_HOST,
            "console.aino.org.in",
            "admin.aino.org.in",
            ...extra,
        ]
            .filter((h): h is string => typeof h === "string" && h.length > 0)
            .map((h) => normalizeHost(h)),
    );
}

// Rebuilt on demand in tests (env is mutated between cases); cached otherwise
// because this runs on the hot path of every request.
let _cache: Set<string> | null = null;
let _cacheKey = "";

function reservedSet(): Set<string> {
    const key = `${process.env.CONSOLE_HOST || ""}|${process.env.RESERVED_HOSTS || ""}`;
    if (_cache && _cacheKey === key) return _cache;
    _cache = buildReservedSet();
    _cacheKey = key;
    return _cache;
}

/**
 * Headers that may carry the browser-visible hostname, in priority order.
 *
 * The vendor-prefixed header is set by the Cloudflare Worker and is checked
 * first because Railway's edge proxy replaces `X-Forwarded-Host` with its own
 * origin hostname before the request reaches this process. Keep this list in
 * sync with `FORWARDED_HOST_HEADER` in `infra/cloudflare/src/router.js`.
 */
const FORWARDED_HOST_HEADERS = ["x-aino-forwarded-host", "x-forwarded-host"] as const;

/**
 * Strip port, lowercase, drop a trailing dot (`example.com.` is the same host
 * as `example.com` — without this a tenant could bypass the reservation).
 */
export function normalizeHost(host: string | undefined | null): string {
    if (!host) return "";
    return String(host).split(":")[0].trim().toLowerCase().replace(/\.$/, "");
}

/**
 * The BROWSER-VISIBLE hostname for a request.
 *
 * CRITICAL behind the Cloudflare Worker (infra/cloudflare/src/index.js): the
 * Worker rewrites the request URL to a Railway origin, so `Host` arrives as
 * `aino-web.up.railway.app`, not `console.aino.org.in`. The Worker preserves
 * the real host precisely so cookies, CORS, WebAuthn and redirects keep
 * working — realm resolution has to use it too, or the console would never be
 * recognised and every request would resolve to the tenant realm.
 *
 * HEADER PRECEDENCE. `X-AINO-Forwarded-Host` is checked BEFORE
 * `X-Forwarded-Host` because Railway's edge proxy overwrites the standard
 * header with its own `*.up.railway.app` hostname before the request reaches
 * this process. Relying on `X-Forwarded-Host` alone made every console request
 * resolve to the tenant realm, so `POST /api/auth/login` answered a genuine
 * platform admin with 403 PLATFORM_LOGIN_HOST_REQUIRED — an unbreakable loop,
 * because the host it redirected to was the host already being used. The
 * standard header is still honoured as a fallback for deployments that sit
 * behind a proxy which preserves it.
 *
 * Either header may be a comma-separated chain when several proxies are
 * involved; the first entry is the client-facing one.
 *
 * TRUST: the app runs with `trust proxy = 2` (Cloudflare + Railway), so this
 * header is only meaningful because both hops are trusted. A direct-to-origin
 * request that spoofs `X-Forwarded-Host: console...` still cannot mint or read
 * a console cookie — the browser scopes cookies by the real hostname, and the
 * JWT `aud` check rejects a tenant token regardless. Spoofing gains nothing.
 */
export function requestHost(req: { headers?: Record<string, unknown> } | null | undefined): string {
    const headers = req?.headers || {};
    for (const name of FORWARDED_HOST_HEADERS) {
        const forwarded = headers[name];
        const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        if (typeof first === "string" && first.trim()) {
            return normalizeHost(first.split(",")[0]);
        }
    }
    return normalizeHost(headers.host as string | undefined);
}

/** True when this hostname belongs to the control plane. */
export function isReservedHost(host: string | undefined | null): boolean {
    const h = normalizeHost(host);
    if (!h) return false;
    return reservedSet().has(h);
}

/** The configured console hostname, or null when not deployed separately. */
export function consoleHost(): string | null {
    return process.env.CONSOLE_HOST ? normalizeHost(process.env.CONSOLE_HOST) : null;
}

/**
 * Which realm a request on this host belongs to.
 *
 * Only the console host implies the platform realm. Every other host — the
 * app domain, a tenant custom domain, localhost — is the tenant realm.
 *
 * NOTE: when CONSOLE_HOST is unset (local dev, existing single-host
 * deployments) this returns "tenant" for everything. Platform routes then fall
 * back to `requirePlatformIdentity`, which is exactly today's behaviour, so
 * the change is backwards compatible until DNS is cut over.
 */
export function realmForHost(host: string | undefined | null): Realm {
    return isReservedHost(host) ? PLATFORM_REALM : TENANT_REALM;
}

/**
 * Realm for a request, resolved from the browser-visible host.
 *
 * Always prefer this over `realmForHost(req.headers.host)` — behind the
 * Cloudflare Worker the raw `Host` header is the Railway origin, not the
 * hostname the user typed. See `requestHost()`.
 */
export function realmForRequest(req: { headers?: Record<string, unknown> } | null | undefined): Realm {
    return realmForHost(requestHost(req));
}

/** Test-only: drop the memoised set after mutating env. */
export function __resetForTests(): void {
    _cache = null;
    _cacheKey = "";
}
