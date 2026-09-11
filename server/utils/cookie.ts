/**
 * Shared cookie configuration for JWT tokens.
 *
 * REALM SCOPING (PR-B). There are two authentication realms, each with its own
 * cookie name:
 *
 *   tenant   -> "token"         on the app host / tenant custom domains
 *   platform -> "aino_console"  on CONSOLE_HOST (e.g. console.aino.org.in)
 *
 * Neither sets a `domain` attribute, so the browser scopes each cookie to the
 * host that issued it. Once the console runs on its own hostname the two
 * sessions are physically incapable of reaching each other — a stronger
 * guarantee than any server-side check, and the reason PR-B provisions a
 * separate host rather than a path prefix.
 *
 * The tenant cookie name is intentionally unchanged so existing sessions
 * survive the deploy.
 */
import type { Request } from "express";
import type { CookieOptions } from "express";
import { realmForRequest, type Realm } from "../platform/reservedHosts";

/** Cookie carrying the tenant-realm session. Unchanged for back-compat. */
const TENANT_COOKIE = "token";
/** Cookie carrying the platform (control-plane) session. */
const PLATFORM_COOKIE = "aino_console";

/** Cookie name for a realm. */
function cookieNameForRealm(realm: Realm): string {
    return realm === "platform" ? PLATFORM_COOKIE : TENANT_COOKIE;
}

/**
 * Cookie name to read/write for this request, derived from the Host header.
 *
 * Host-derived rather than token-derived on purpose: we must know which cookie
 * to *read* before we have a token to inspect.
 */
function cookieNameForRequest(req: Request): string {
    return cookieNameForRealm(realmForRequest(req as any));
}

const isProduction = process.env.NODE_ENV === "production";
const useSecureCookie = isProduction && process.env.USE_HTTPS === "true";

/**
 * Origins that are allowed to receive a cross-site (`sameSite: 'none'`) auth
 * cookie. This exists solely for the desktop (Electron) app, which loads from a
 * custom-protocol origin and therefore needs a cross-site cookie. The list is
 * an explicit allowlist (overridable via DESKTOP_COOKIE_ORIGINS) rather than a
 * broad `startsWith` so the relaxed cookie can't be coaxed out for unexpected
 * scheme prefixes. Note: the browser sets `Origin`, so a third-party web page
 * cannot spoof this to weaken a victim's cookie — relaxation only affects the
 * caller's own session — but keeping a tight allowlist is good hygiene.
 *
 * REBRAND (WorkPulse -> AINO): both `workpulse://` and `aino://` are allowed
 * so an already-installed desktop build still receives its cross-site auth
 * cookie during the migration. Omitting the legacy scheme would silently fall
 * through to `sameSite: "strict"`, which a custom-protocol origin cannot send
 * back — the user would appear to log in and be immediately logged out.
 */
const DESKTOP_COOKIE_ORIGINS = (process.env.DESKTOP_COOKIE_ORIGINS || "workpulse://,aino://")
    .split(",")
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

function isDesktopOrigin(origin: unknown): boolean {
    const o = String(origin || "").toLowerCase();
    return DESKTOP_COOKIE_ORIGINS.some(allowed => o === allowed || o.startsWith(allowed));
}

/**
 * Generate cookie options for a request.
 * @param req - Express request object
 * @param maxAge - Cookie max age in ms (default: 8 hours)
 * @returns Cookie options
 */
function cookieOptions(req: Request, maxAge?: number): CookieOptions {
    const defaultMaxAge = maxAge || 8 * 60 * 60 * 1000;
    // Desktop (Electron) app uses a custom protocol origin — needs cross-site cookies.
    // A cross-site cookie must also be Secure per the cookie spec, so only relax
    // when we can actually mark it Secure (always true here for the desktop branch).
    //
    // The console is a browser-only surface: never relax SameSite for it, even
    // if something presents a desktop origin. Keeping it `strict` means the
    // control-plane cookie is never sent on a cross-site request.
    const origin = req?.headers?.origin || "";
    const isConsole = realmForRequest(req as any) === "platform";
    if (!isConsole && isDesktopOrigin(origin)) {
        return { httpOnly: true, secure: true, sameSite: "none", maxAge: defaultMaxAge, path: "/" };
    }
    return {
        httpOnly: true,
        secure: useSecureCookie,
        sameSite: "strict",
        maxAge: defaultMaxAge,
        path: "/",
    };
}

/**
 * Read the auth token for this request's realm.
 *
 * Priority: realm cookie, then `Authorization: Bearer` (native mobile, which
 * cannot manage cookies). Mobile is tenant-realm only — the console is a
 * browser surface — so the bearer fallback is not applied on the console host.
 */
function readAuthToken(req: any): string | null {
    const name = cookieNameForRequest(req);
    const fromCookie = req?.cookies?.[name];
    if (fromCookie) return fromCookie;

    if (name === TENANT_COOKIE) {
        const header = req?.headers?.authorization;
        if (typeof header === "string" && header.startsWith("Bearer ")) {
            return header.slice(7);
        }
    }
    return null;
}

export {
    cookieOptions,
    cookieNameForRealm,
    cookieNameForRequest,
    readAuthToken,
    TENANT_COOKIE,
    PLATFORM_COOKIE,
};