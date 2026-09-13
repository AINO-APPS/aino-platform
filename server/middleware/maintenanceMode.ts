import type { Response, NextFunction } from "express";
const { isMaintenanceMode, getMaintenanceMessage } = require("../utils/platformConfig");
import { readAuthToken } from "../utils/cookie";
import { PLATFORM_REALM, verifyRealmToken } from "../platform/realm";
import { logger } from "../utils/logger";

let cachedMode = false;
let cachedMessage = "";
let lastCheck = 0;
const CACHE_TTL_MS = 30_000;

// This middleware is mounted at /api, so Express exposes paths relative to that
// mount point (for example, /auth/login rather than /api/auth/login).
const MAINTENANCE_BYPASS_PATHS = new Set([
    "/health",
    "/auth/login",
    "/auth/login/realm",
    "/auth/handoff",
    "/auth/biometric/login",
    "/auth/webauthn/login/options",
    "/auth/webauthn/login/verify",
]);

function isPlatformAdminRequest(req: any): boolean {
    const token = readAuthToken(req);
    if (!token) return false;

    const verified = verifyRealmToken(token, req);
    if (!verified.ok) return false;

    const claims = verified.payload;
    return verified.realm === PLATFORM_REALM
        && claims.platform === true
        && !claims.tenant_id;
}

async function refreshCache(): Promise<void> {
    const now = Date.now();
    if (now - lastCheck < CACHE_TTL_MS) return;
    lastCheck = now;
    try {
        cachedMode = await isMaintenanceMode();
        if (cachedMode) {
            cachedMessage = await getMaintenanceMessage();
        }
    } catch (err: any) {
        logger.warn({ err: err.message }, "maintenance: failed to refresh cache");
    }
}

async function maintenanceModeMiddleware(req: any, res: Response, next: NextFunction): Promise<void | Response> {
    await refreshCache();

    if (!cachedMode) return next();

    // The maintenance gate runs before each route's auth middleware, so fields
    // such as req.userRole / req.isPlatformUser do not exist yet. Verify the
    // realm-scoped cookie just enough to let a platform operator reach normal
    // route authentication, which still enforces session and token-version
    // checks before any protected action can run.
    if (isPlatformAdminRequest(req)) return next();

    if (MAINTENANCE_BYPASS_PATHS.has(req.path)) return next();

    return res.status(503).json({
        error: "maintenance",
        message: cachedMessage || "The system is currently under maintenance. Please try again later.",
    });
}

function invalidateMaintenanceCache(): void {
    lastCheck = 0;
}

export { maintenanceModeMiddleware, invalidateMaintenanceCache };