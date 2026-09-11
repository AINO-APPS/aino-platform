/**
 * PR-B realm-migration telemetry.
 *
 * Tokens minted before PR-B carry no `aud` claim. `middleware/auth.ts` accepts
 * them during a grace window so the deploy does not sign every user out mid-
 * session. This counter is how we know when the window can close:
 *
 *   1. Deploy PR-B with STRICT_REALM unset. Legacy tokens still work.
 *   2. Watch `aino_legacy_realmless_token_total`. Every 8h-lifetime JWT is
 *      re-minted with an `aud` on refresh or next login, so the rate decays
 *      to zero within roughly one token lifetime.
 *   3. Once flat at zero, set STRICT_REALM=true. Realmless tokens are then
 *      rejected with 401 WRONG_REALM.
 *
 * `aino_realm_mismatch_total` counts genuine cross-realm attempts: a tenant
 * token presented to the console host or vice-versa. In steady state this
 * should be zero; a non-zero rate is either a client bug or an attack, and is
 * worth alerting on.
 */
import { Counter } from "prom-client";
import { registry } from "./registry";

/**
 * prom-client throws on duplicate registration. Jest resets modules between
 * suites while the registry singleton may survive, so reuse an existing series
 * when one is already present.
 */
function counter(name: string, help: string, labelNames: string[]): Counter<string> {
    const existing = registry.getSingleMetric(name);
    if (existing) return existing as Counter<string>;
    return new Counter({ name, help, labelNames, registers: [registry] });
}

const legacyRealmlessTokens = counter(
    "aino_legacy_realmless_token_total",
    "JWTs accepted without an `aud` realm claim (pre-PR-B tokens, grace window only).",
    ["realm"],
);

const realmMismatches = counter(
    "aino_realm_mismatch_total",
    "Requests rejected because the token realm did not match the host realm.",
    ["expected", "actual"],
);

/** A pre-PR-B token was accepted under the grace window. */
export function recordLegacyRealmlessToken(realm: string): void {
    try {
        legacyRealmlessTokens.inc({ realm });
    } catch { /* metrics must never break auth */ }
}

/** A token from the wrong realm was rejected. */
export function recordRealmMismatch(expected: string, actual: string): void {
    try {
        realmMismatches.inc({ expected, actual });
    } catch { /* metrics must never break auth */ }
}
