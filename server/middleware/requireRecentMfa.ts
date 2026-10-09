import type { Request, Response, NextFunction } from "express";
import { hasRecentStepUp } from "../services/adminMfa";
import { cookieOptions, cookieNameForRequest, readAuthToken } from "../utils/cookie";
import { AUTH_TOKEN_TTL_MS, AUTH_TOKEN_TTL_SECONDS } from "../services/authSessions";
const jwt = require("jsonwebtoken");

/**
 * Step-up for destructive administration (P2.1): the session token must carry
 * an `mfa_at` second-factor proof from the last 10 minutes. Otherwise answers
 * 403 `MFA_STEP_UP_REQUIRED`; the web app asks for a code
 * (`POST /api/auth/mfa/step-up`) and retries.
 *
 * Applied to every mutating request under the admin routers. Accounts that
 * are not admins never reach these routes (requireRole), and virtual
 * impersonation tokens inherit the operator's own verified sign-in.
 */
export function requireRecentMfa(req: Request, res: Response, next: NextFunction): void | Response {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (process.env.ADMIN_MFA_STEP_UP === "off") return next();
    // Mounted ahead of each router's own auth: an unauthenticated or invalid
    // request falls through so the router answers 401 as before.
    const decoded = (req as any).decodedToken || verifiedClaims(req);
    if (!decoded || decoded.impersonated) return next();
    if (hasRecentStepUp(decoded.mfa_at)) return next();
    return res.status(403).json({
        error: "Confirm it's you: enter the code from your authenticator app.",
        code: "MFA_STEP_UP_REQUIRED",
    });
}

/** Claims of a validly signed token for this request, or null (auth middleware reports why). */
function verifiedClaims(req: Request): any {
    const token = readAuthToken(req);
    if (!token) return null;
    try {
        return jwt.verify(token, process.env.JWT_SECRET);
    } catch {
        return null;
    }
}

/** Re-issue the caller's session cookie with a fresh `mfa_at` (same claims otherwise). */
export function reissueWithStepUp(req: Request, res: Response): void {
    const decoded = { ...((req as any).decodedToken || verifiedClaims(req) || {}) };
    delete decoded.iat;
    delete decoded.exp;
    delete decoded.nbf;
    decoded.mfa_at = Math.floor(Date.now() / 1000);
    const token = jwt.sign(decoded, process.env.JWT_SECRET, { expiresIn: AUTH_TOKEN_TTL_SECONDS });
    res.cookie(cookieNameForRequest(req), token, cookieOptions(req, AUTH_TOKEN_TTL_MS));
}
