import type { Request, Response, NextFunction } from "express";
import { cookieNameForRequest, readAuthToken } from "../utils/cookie";
const jwt = require("jsonwebtoken");

/**
 * Administration is web-only (product + security decision 2026-10-01).
 *
 * Mobile sessions are long-lived bearer tokens on a device that can be lost,
 * so admin routes refuse any request that looks like the native app:
 *   - the token came from `Authorization: Bearer` (browsers use the cookie),
 *   - the token was minted for the app (`cli: "mobile"`) — this catches a
 *     stolen app token replayed as a `Cookie:` header,
 *   - the app identifies itself with `X-AINO-Client: android`.
 * Every signal can only make a request *more* restricted, so none of them
 * being spoofable weakens the gate — which is also why the claim is read with
 * an unverified decode (auth still verifies the token afterwards).
 */
const MOBILE_CLIENT = "mobile";

function tokenClient(req: any): unknown {
    const token = readAuthToken(req);
    return token ? jwt.decode(token)?.cli : undefined;
}

function isMobileClient(req: any): boolean {
    const header = req?.headers?.authorization;
    const viaBearer = !req?.cookies?.[cookieNameForRequest(req)]
        && typeof header === "string" && header.startsWith("Bearer ");
    return viaBearer
        || tokenClient(req) === MOBILE_CLIENT
        || String(req?.headers?.["x-aino-client"] || "").toLowerCase() === "android";
}

/** Claims to spread into every auth JWT so the client kind survives refreshes. */
function clientClaims(req: any): { cli?: string } {
    return isMobileClient(req) ? { cli: MOBILE_CLIENT } : {};
}

function webOnly(req: Request, res: Response, next: NextFunction): void | Response {
    if (isMobileClient(req)) {
        return res.status(403).json({
            error: "Administration is available in the AINO web app.",
            code: "WEB_ONLY",
        });
    }
    next();
}

/** [webOnly] for every request except those [allow] lets through (e.g. self-service reads). */
function webOnlyExcept(allow: (req: Request) => boolean) {
    return (req: Request, res: Response, next: NextFunction) => (allow(req) ? next() : webOnly(req, res, next));
}

export { webOnly, webOnlyExcept, clientClaims, isMobileClient, MOBILE_CLIENT };
