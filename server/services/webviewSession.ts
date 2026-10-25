/**
 * Single-use session exchange for native webviews.
 *
 * A native client (iOS, Android, desktop) already holds a bearer token. Rather
 * than injecting that token into a web page — where any script on the page
 * could read it — the client exchanges it for a short-lived, single-use code
 * and the webview redeems the code for a normal HttpOnly cookie session.
 *
 * Guarantees:
 *   - the code is single-use (an atomic UPDATE … WHERE consumed_at IS NULL)
 *   - the code expires within sixty seconds
 *   - the bearer token never leaves the native client
 *   - a code issued to a native client cannot be redeemed by one
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { masterQuery } from "../db";
import type { Realm } from "../platform/realm";

/** Codes live for sixty seconds — long enough to open a webview, short enough to be useless if leaked. */
const WEBVIEW_CODE_TTL_SECONDS = 60;

/** Surfaces that may request a code. Only a webview may redeem one. */
export type WebviewClient = "ios" | "android" | "desktop";

const NATIVE_CLIENTS: WebviewClient[] = ["ios", "android", "desktop"];

function jwtSecret(): string {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");
    return process.env.JWT_SECRET;
}

export interface WebviewCodeClaims {
    jti: string;
    user_id: number;
    tenant_id: number | null;
    realm: Realm;
    issued_to: WebviewClient;
}

/** True when the caller is a native client that may request a code. */
export function isNativeClient(value: unknown): value is WebviewClient {
    return typeof value === "string" && (NATIVE_CLIENTS as string[]).includes(value);
}

/**
 * Mint a single-use code for a webview.
 *
 * `issuedTo` records which native surface asked, so the redemption path can
 * refuse a code presented by a native client.
 */
export async function createWebviewCode(input: {
    userId: number;
    tenantId: number | null;
    realm: Realm;
    issuedTo: WebviewClient;
}): Promise<{ code: string; expiresIn: number }> {
    const jti = crypto.randomUUID();
    await masterQuery(
        `INSERT INTO webview_session_codes
            (jti, user_id, tenant_id, realm, issued_to, expires_at)
         VALUES ($1,$2,$3,$4,$5,NOW() + INTERVAL '60 seconds')`,
        [jti, input.userId, input.tenantId, input.realm, input.issuedTo],
    );
    const code = jwt.sign(
        {
            jti,
            user_id: input.userId,
            tenant_id: input.tenantId,
            realm: input.realm,
            issued_to: input.issuedTo,
        },
        jwtSecret(),
        { audience: "webview-session", expiresIn: `${WEBVIEW_CODE_TTL_SECONDS}s` },
    );
    return { code, expiresIn: WEBVIEW_CODE_TTL_SECONDS };
}

/**
 * Redeem a code exactly once.
 *
 * Returns `null` for a replay, an expired code, a claim mismatch, or a code
 * presented by a native client. The UPDATE is the atomic gate: two concurrent
 * redemptions cannot both succeed.
 */
export async function consumeWebviewCode(
    code: string,
    options: { expectedRealm?: Realm; presentedBy?: "webview" | WebviewClient } = {},
): Promise<WebviewCodeClaims | null> {
    // A native client must never redeem a code — that would let it mint a
    // session for a surface it is not, and defeats the point of the exchange.
    if (options.presentedBy && options.presentedBy !== "webview") return null;

    let claims: any;
    try {
        claims = jwt.verify(code, jwtSecret(), { audience: "webview-session" });
    } catch {
        return null;
    }
    if (!Number.isInteger(claims.user_id) || !isNativeClient(claims.issued_to)) return null;
    if (claims.realm !== "tenant" && claims.realm !== "platform") return null;
    if (options.expectedRealm && claims.realm !== options.expectedRealm) return null;

    const result = await masterQuery(
        `UPDATE webview_session_codes SET consumed_at = NOW()
          WHERE jti = $1 AND consumed_at IS NULL AND expires_at > NOW()
            AND user_id = $2 AND realm = $3 AND issued_to = $4
            AND tenant_id IS NOT DISTINCT FROM $5
          RETURNING jti`,
        [claims.jti, claims.user_id, claims.realm, claims.issued_to, claims.tenant_id],
    );
    return result.rows[0] ? (claims as WebviewCodeClaims) : null;
}

export { WEBVIEW_CODE_TTL_SECONDS };
