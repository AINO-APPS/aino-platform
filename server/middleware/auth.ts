import type { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import * as redis from "../redis";
import { masterQuery } from "../db";
import { validateSession } from "../services/authSessions";
import { readAuthToken } from "../utils/cookie";
import { verifyRealmToken, expectedRealm } from "../platform/realm";

// ── Impersonation revocation cache ────────────────────────────────────────
// Cache the per-request liveness check for an access-request row for 10s so
// the master DB doesn't get hammered during a busy impersonation session.
// 10s is short enough that a tenant revoke takes effect almost immediately.
const _impCache = new Map<number, { allowed: boolean; expiresAt: number }>();   // requestId -> { allowed, expiresAt }
const IMP_CACHE_TTL_MS = 10_000;

async function checkImpersonationStillAllowed(requestId: number): Promise<boolean> {
    const now = Date.now();
    const cached = _impCache.get(requestId);
    if (cached && cached.expiresAt > now) return cached.allowed;

    const row = (await masterQuery(
        `SELECT status, revoked_at, session_ends_at
           FROM tenant_access_requests WHERE id = $1`,
        [requestId],
    )).rows[0];

    let allowed = true;
    if (!row) {
        allowed = false;
    } else if (row.status === "revoked" || row.revoked_at) {
        allowed = false;
    } else if (row.session_ends_at && new Date(row.session_ends_at) < new Date(now)) {
        allowed = false;
    }

    _impCache.set(requestId, { allowed, expiresAt: now + IMP_CACHE_TTL_MS });
    // Bound the cache to avoid an unbounded growth in pathological cases.
    if (_impCache.size > 1000) {
        const oldest = _impCache.keys().next().value;
        if (oldest !== undefined) _impCache.delete(oldest);
    }
    return allowed;
}

async function authMiddleware(req: any, res: Response, next: NextFunction): Promise<void | Response> {
    // Which cookie to read depends on the realm, which depends on the Host
    // header — the console host uses `aino_console`, everything else `token`.
    // Native mobile clients (tenant realm only) may still use a Bearer header.
    const token = readAuthToken(req);
    if (!token) {
        return res.status(401).json({ error: "No token provided" });
    }
    try {
        // The tenant-resolution middleware already verified this exact token
        // and stashed the payload on req.decodedToken. Reuse it to avoid a
        // second jwt.verify() per request; otherwise verify here.
        //
        // REALM CHECK (PR-B): a token minted for one plane must never
        // authenticate a request on the other. resolveTenant performs the same
        // check and only sets req.decodedToken when it passed, so reusing the
        // stashed payload is safe.
        let decoded: any = req.decodedToken;
        if (!decoded) {
            const verified = verifyRealmToken(token, req);
            if (!verified.ok) {
                if (verified.reason === "wrong_realm") {
                    logger.warn(
                        { expected: verified.expected, actual: verified.actual, host: req.headers?.host },
                        "auth: token realm does not match host realm",
                    );
                    return res.status(401).json({
                        error: "This session is not valid for this site. Please sign in again.",
                        code: "WRONG_REALM",
                    });
                }
                throw verified.error;
            }
            decoded = verified.payload;
            req.realm = verified.realm;
        }
        req.realm = req.realm || expectedRealm(req);
        const tokenVersion = decoded.tv ?? 0;
        const isPlatformUser = !!decoded.platform;
        const isVirtualImpersonation = !!decoded.impersonated && !!decoded.is_virtual;
        // A platform_admin with a tenant_id has a linked user record in the tenant DB.
        // Token version should be checked against the tenant's users table, not platform_users.
        const hasTenantContext = !!decoded.tenant_id;

        // req.db is set by tenant middleware (or falls back to master DB)
        const dbQuery = req.db?.query;
        if (!dbQuery) {
            return res.status(500).json({ error: "Database context not available" });
        }

        // Skip token version & session checks for virtual impersonation (no real user in tenant)
        if (!isVirtualImpersonation) {
            // Try Redis cache first for token version check
            const tenantId = decoded.tenant_id || null;
            let dbTokenVersion = await redis.getTokenVersion(tenantId, decoded.id);
            if (dbTokenVersion === null) {
                const result = (isPlatformUser && !hasTenantContext)
                    ? await dbQuery("SELECT token_version FROM platform_users WHERE id = $1", [decoded.id])
                    : await dbQuery("SELECT token_version FROM users WHERE id = $1", [decoded.id]);
                const user = result.rows[0];
                if (!user) {
                    return res.status(401).json({ error: "User no longer exists" });
                }
                dbTokenVersion = user.token_version || 0;
                await redis.setTokenVersion(tenantId, decoded.id, dbTokenVersion as number);
            }

            if (tokenVersion !== dbTokenVersion) {
                return res.status(401).json({ error: "Session expired. Please sign in again." });
            }

            // Validate session is still active. New logins always carry a sid;
            // sid-less JWTs remain accepted only for the bounded lifetime of
            // tokens issued before this rollout.
            if (decoded.sid) {
                const state = await validateSession(decoded.id, decoded.sid, { query: dbQuery }, {
                    ignoreIdle: isPlatformUser && !hasTenantContext,
                });
                if (state === "missing") {
                    return res.status(401).json({ error: "Session ended. You may have signed in on another device." });
                }
                if (state === "idle") {
                    await redis.invalidateUserSessions(tenantId, decoded.id);
                    return res.status(401).json({ error: "Session expired due to inactivity.", code: "SESSION_IDLE_EXPIRED" });
                }
            }
        } // end !isVirtualImpersonation

        req.userId = decoded.id;
        req.username = decoded.username;
        req.sessionId = decoded.sid || null;
        req.tenantId = decoded.tenant_id || null;
        req.isPlatformUser = isPlatformUser;
        req.isImpersonated = !!decoded.impersonated;
        req.impersonatedBy = decoded.impersonated_by || null;
        req.impersonatedTenantName = decoded.impersonated_tenant_name || null;
        req.accessRequestId = decoded.access_request_id || null;

        // ── Impersonation session revocation check ──
        // If this is an impersonation token tied to a tenant_access_requests
        // row, verify the row hasn't been revoked / expired. We use a
        // tiny in-memory TTL cache so we don't hit the master DB on every
        // request during a long session (10 second TTL is plenty — a
        // revocation is meant to kill activity *promptly*, not instantly).
        if (req.isImpersonated && decoded.access_request_id) {
            try {
                const allowed = await checkImpersonationStillAllowed(decoded.access_request_id);
                if (!allowed) {
                    return res.status(401).json({
                        error: "Your impersonation session was revoked by the tenant.",
                        code: "IMPERSONATION_REVOKED",
                    });
                }
            } catch (e: any) {
                logger.warn({ err: e.message }, "auth: failed to verify impersonation session");
            }
        }
        next();
    } catch (err: any) {
        if (err.name === "TokenExpiredError") {
            return res.status(401).json({ error: "Token expired. Please sign in again." });
        }
        if (err.name === "JsonWebTokenError") {
            return res.status(401).json({ error: "Invalid token" });
        }
        logger.error({ err, tokenError: err.name }, "Auth middleware error");
        return res.status(401).json({ error: "Authentication failed" });
    }
}

export = authMiddleware;