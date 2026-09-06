import type { Request, Response, NextFunction } from "express";

/**
 * Master/platform routes require an identity issued from `platform_users`.
 * A tenant user must never gain platform authority merely by storing a role key
 * named `platform_admin` (or by configuring a custom role at a high level).
 */
function requirePlatformIdentity(req: Request, res: Response, next: NextFunction): void | Response {
    if (!req.isPlatformUser || req.tenantId !== null && req.tenantId !== undefined) {
        return res.status(403).json({
            error: "A tenantless platform administrator identity is required",
            code: "PLATFORM_IDENTITY_REQUIRED",
        });
    }
    next();
}

export = requirePlatformIdentity;