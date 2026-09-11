import type { Request, Response, NextFunction } from "express";
import { PLATFORM_REALM } from "../platform/realm";
import { consoleHost } from "../platform/reservedHosts";

/**
 * Master/platform routes require an identity issued from `platform_users`.
 * A tenant user must never gain platform authority merely by storing a role key
 * named `platform_admin` (or by configuring a custom role at a high level).
 *
 * PR-B adds a second, independent condition: when the deployment has a
 * dedicated console host, the request must also arrive in the PLATFORM realm.
 * The two checks answer different questions —
 *
 *   isPlatformUser  → "is this principal from platform_users?"  (who)
 *   realm           → "did this arrive on the control plane?"   (where)
 *
 * Requiring both means a stolen console token replayed at the app host, or an
 * app-host token replayed at the console, fails even if the principal is
 * legitimate.
 *
 * The realm check is skipped when CONSOLE_HOST is unset, so single-host
 * deployments behave exactly as before the split.
 */
function requirePlatformIdentity(req: Request, res: Response, next: NextFunction): void | Response {
    if (!req.isPlatformUser || req.tenantId !== null && req.tenantId !== undefined) {
        return res.status(403).json({
            error: "A tenantless platform administrator identity is required",
            code: "PLATFORM_IDENTITY_REQUIRED",
        });
    }
    if (consoleHost() && (req as any).realm !== PLATFORM_REALM) {
        return res.status(403).json({
            error: "The platform console must be used for this operation.",
            code: "PLATFORM_REALM_REQUIRED",
        });
    }
    next();
}

export = requirePlatformIdentity;