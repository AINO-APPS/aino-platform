/**
 * Native webview session exchange routes.
 *
 * A native client already holds a bearer token. Rather than injecting that
 * token into a web page — where any script on the page could read it — it
 * exchanges the token for a short-lived, single-use code, and the webview
 * redeems the code for a normal HttpOnly cookie session.
 *
 *   POST /api/auth/webview/code    (bearer)  -> { code, expiresIn }
 *   POST /api/auth/webview/session (cookie)  -> the normal login response
 *
 * Mounted inside the auth router so the cookie-mirroring wrapper and the
 * realm-aware cookie name apply unchanged.
 */
import express from "express";
import type { Request, Response } from "express";
import { masterQuery } from "../../db";
import { PLATFORM_REALM, TENANT_REALM, expectedRealm, type Realm } from "../../platform/realm";
import { availablePlatformPrincipal } from "../../services/realmPrincipals";
import { createWebviewCode, consumeWebviewCode, isNativeClient } from "../../services/webviewSession";

interface WebviewRouterDeps {
    auth: any;
    getTenantDb: (tenantId: number) => Promise<any>;
    finishLogin: (
        req: Request,
        res: Response,
        input: { user: any; db: any; tenantId: number | null; isPlatformUser?: boolean },
    ) => Promise<unknown>;
}

export function createWebviewRouter({ auth, getTenantDb, finishLogin }: WebviewRouterDeps) {
    const router = express.Router();

    router.post("/code", auth, async (req: Request, res: Response) => {
        const issuedTo = req.body?.client;
        if (!isNativeClient(issuedTo)) {
            return res.status(400).json({
                error: "client must be ios, android or desktop",
                code: "WEBVIEW_CLIENT_INVALID",
            });
        }
        // A platform session may only mint a platform code, and a tenant session
        // a tenant code — the exchange must not cross realms.
        const realm: Realm = req.realm === PLATFORM_REALM ? PLATFORM_REALM : TENANT_REALM;
        const { code, expiresIn } = await createWebviewCode({
            userId: req.userId!,
            tenantId: realm === PLATFORM_REALM ? null : (req.tenantId ? Number(req.tenantId) : null),
            realm,
            issuedTo,
        });
        res.json({ code, expiresIn });
    });

    router.post("/session", async (req: Request, res: Response) => {
        // Only a webview may redeem. A native client presenting a code is
        // refused, which is what stops the exchange being used to mint a
        // session for a surface it is not.
        const presentedBy = req.body?.presented_by ?? "webview";
        const claims = await consumeWebviewCode(String(req.body?.code || ""), {
            expectedRealm: expectedRealm(req),
            presentedBy,
        });
        if (!claims) {
            return res.status(401).json({
                error: "Session code expired or was already used",
                code: "WEBVIEW_CODE_INVALID",
            });
        }

        if (claims.realm === PLATFORM_REALM) {
            const platform = await availablePlatformPrincipal(claims.user_id);
            if (!platform) {
                return res.status(403).json({
                    error: "Platform account is no longer available",
                    code: "PLATFORM_ACCOUNT_UNAVAILABLE",
                });
            }
            return finishLogin(req, res, {
                user: platform,
                db: { query: masterQuery },
                tenantId: null,
                isPlatformUser: true,
            });
        }

        if (claims.tenant_id === null) {
            return res.status(401).json({
                error: "Session code expired or was already used",
                code: "WEBVIEW_CODE_INVALID",
            });
        }
        const tenantDb = await getTenantDb(claims.tenant_id);
        if (!tenantDb) {
            return res.status(403).json({
                error: "Tenant is no longer available",
                code: "TENANT_UNAVAILABLE",
            });
        }
        const user = (await tenantDb.query(
            "SELECT * FROM users WHERE id = $1 AND is_active = TRUE",
            [claims.user_id],
        )).rows[0];
        if (!user) {
            return res.status(403).json({
                error: "Account is no longer available",
                code: "ACCOUNT_UNAVAILABLE",
            });
        }
        return finishLogin(req, res, {
            user,
            db: tenantDb,
            tenantId: claims.tenant_id,
            isPlatformUser: false,
        });
    });

    return router;
}
