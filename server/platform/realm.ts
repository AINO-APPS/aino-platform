/**
 * Realm-aware JWT verification — the single place that decides whether a token
 * is valid *for the plane it was presented to*.
 *
 * PR-B. See docs/PLATFORM_TENANT_SEPARATION_PLAN.md and ADR-011.
 *
 * Tokens carry an `aud` claim naming their realm ("tenant" | "platform"). A
 * token minted for one plane must never authenticate a request on the other,
 * even though both planes share a JWT secret and a process.
 *
 * GRACE WINDOW. Tokens issued before PR-B have no `aud`. Rejecting them on
 * deploy would sign out every active user, so they are accepted while
 * STRICT_REALM is unset — but only in the TENANT realm, which is what they
 * were. A realmless token can therefore never be used to reach the console.
 * `aino_legacy_realmless_token_total` tracks the decay; flip STRICT_REALM=true
 * once it reaches zero (~one 8h token lifetime).
 */
import jwt from "jsonwebtoken";
import { realmForRequest, TENANT_REALM, PLATFORM_REALM, type Realm } from "./reservedHosts";
import { recordLegacyRealmlessToken, recordRealmMismatch } from "./metrics/realmMetrics";

export type RealmVerifyFailure =
    | { ok: false; reason: "invalid"; error: Error }
    | { ok: false; reason: "wrong_realm"; expected: Realm; actual: Realm };

export type RealmVerifyResult =
    | { ok: true; payload: any; realm: Realm; legacy: boolean }
    | RealmVerifyFailure;

/** Strict mode rejects tokens with no `aud`. Enable after the grace window. */
export function isStrictRealm(): boolean {
    return process.env.STRICT_REALM === "true";
}

/**
 * The realm a request belongs to, derived from the BROWSER-VISIBLE host
 * (`X-Forwarded-Host` behind the Cloudflare Worker, else `Host`).
 */
export function expectedRealm(req: { headers?: Record<string, any> }): Realm {
    return realmForRequest(req);
}

/**
 * Read the realm a token claims. `aud` may be a string or an array (RFC 7519);
 * anything unrecognised is treated as absent rather than trusted.
 */
function claimedRealm(payload: any): Realm | null {
    const aud = payload?.aud;
    const value = Array.isArray(aud) ? aud[0] : aud;
    if (value === PLATFORM_REALM || value === TENANT_REALM) return value;
    return null;
}

/**
 * Verify a JWT and confirm it belongs to the realm this request targets.
 *
 * Signature verification runs WITHOUT an `audience` option so we can tell
 * "wrong realm" apart from "bad signature" — the two need different responses
 * and different metrics.
 */
export function verifyRealmToken(
    token: string,
    req: { headers?: Record<string, any> },
): RealmVerifyResult {
    const expected = expectedRealm(req);

    let payload: any;
    try {
        payload = jwt.verify(token, process.env.JWT_SECRET as string);
    } catch (error) {
        return { ok: false, reason: "invalid", error: error as Error };
    }

    const actual = claimedRealm(payload);

    if (actual === null) {
        // Pre-PR-B token. Honour it only in the tenant realm, only while the
        // grace window is open.
        if (isStrictRealm() || expected === PLATFORM_REALM) {
            return { ok: false, reason: "wrong_realm", expected, actual: TENANT_REALM };
        }
        recordLegacyRealmlessToken(expected);
        return { ok: true, payload, realm: TENANT_REALM, legacy: true };
    }

    if (actual !== expected) {
        recordRealmMismatch(expected, actual);
        return { ok: false, reason: "wrong_realm", expected, actual };
    }

    return { ok: true, payload, realm: actual, legacy: false };
}

/**
 * Claims to merge into every signed token so the realm travels with it.
 * Callers spread this into their payload before `jwt.sign`.
 */
export function realmClaims(realm: Realm): { aud: Realm } {
    return { aud: realm };
}

export { TENANT_REALM, PLATFORM_REALM };
export type { Realm };
