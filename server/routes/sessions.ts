import express from "express";
import type { Request, Response } from "express";
import { listUserSessions, revokeUserSession } from "../services/authSessions";
import { endUserSessions, pushSessionRevoked } from "../services/sessionSignOut";
import { MOBILE_ACCESS_TTL_SECONDS, loadTokenUser, parseRefreshToken, rotateRefreshToken } from "../services/refreshTokens";
import { realmClaims, TENANT_REALM } from "../platform/realm";
import { MOBILE_CLIENT } from "../middleware/webOnly";
const auth = require("../middleware/auth");
const jwt = require("jsonwebtoken");
const { getTenantPool, getTenantById } = require("../utils/tenantManager");

/**
 * Signed-in devices and native token refresh (P2.7). Mounted at
 * `/api/sessions`; the device routes act on `req.userId` only.
 */
const router = express.Router();

/** Readable device name from the stored User-Agent (no fingerprinting, no IP). */
function deviceLabel(userAgent: string | null, clientClass: string | null): string {
    const ua = userAgent || "";
    if (/okhttp|android/i.test(ua) && clientClass === "mobile") return "AINO for Android";
    if (/CFNetwork|Darwin|iPhone|iPad/i.test(ua) && clientClass === "mobile") return "AINO for iPhone";
    if (/Electron|AINO-Desktop/i.test(ua)) return "AINO desktop app";
    const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
    return os ? `${browser} on ${os}` : browser;
}

router.get("/", auth, async (req: Request, res: Response) => {
    try {
        const rows = await listUserSessions(req.userId!, req.db!);
        res.json(rows.map((row) => ({
            id: row.id,
            device: deviceLabel(row.device, row.client_class),
            clientClass: row.client_class || (row.device_id ? "mobile" : "web"),
            createdAt: row.created_at,
            lastActiveAt: row.last_activity_at,
            current: row.id === req.sessionId,
        })));
    } catch (err) {
        req.log.error({ err }, "List sessions error");
        res.status(500).json({ error: "Failed to load signed-in devices" });
    }
});

router.delete("/:id", auth, async (req: Request, res: Response) => {
    try {
        const sid = String(req.params.id || "");
        if (sid === req.sessionId) {
            return res.status(400).json({ error: "Use Sign out to end this device's session", code: "CURRENT_SESSION" });
        }
        const revoked = await revokeUserSession(req.userId!, sid, req.db!);
        if (!revoked) return res.status(404).json({ error: "Session not found" });
        await endUserSessions(req.tenantId, req.userId!, "Signed out from another device", [sid]);
        pushSessionRevoked(req.db!, req.tenantId ? Number(req.tenantId) : null, req.userId!, [revoked.deviceId]);
        res.json({ ok: true });
    } catch (err) {
        req.log.error({ err }, "Revoke session error");
        res.status(500).json({ error: "Failed to sign out that device" });
    }
});

/**
 * Native apps (P2.7): swap a refresh token for a fresh 15-minute access token
 * and the next refresh token. No access token is required (it may have
 * expired); the refresh token names its tenant and session. A replayed
 * (already rotated) token ends the session and signs that device out.
 */
router.post("/token", async (req: Request, res: Response) => {
    try {
        const presented = (req.body || {}).refreshToken;
        const parsed = parseRefreshToken(presented);
        if (!parsed) return res.status(401).json({ error: "Session ended. Please sign in again.", code: "REFRESH_INVALID" });
        const tenant = await getTenantById(parsed.tenantId);
        if (!tenant || tenant.status !== "active") return res.status(401).json({ error: "Session ended. Please sign in again.", code: "REFRESH_INVALID" });
        const pool = await getTenantPool(tenant.db_name, tenant.db_host);
        const db = { query: pool.query };

        const rotated = await rotateRefreshToken(presented, db);
        if (rotated.status === "reused") {
            await endUserSessions(parsed.tenantId, rotated.userId, "Session ended", [rotated.sid]);
            pushSessionRevoked(db, parsed.tenantId, rotated.userId, [rotated.deviceId]);
            req.log.warn({ tenantId: parsed.tenantId, userId: rotated.userId }, "Refresh token reuse: session revoked");
            return res.status(401).json({ error: "Session ended. Please sign in again.", code: "REFRESH_REUSED" });
        }
        if (rotated.status !== "rotated") return res.status(401).json({ error: "Session ended. Please sign in again.", code: "REFRESH_INVALID" });

        const user = await loadTokenUser(rotated.userId, db);
        if (!user || user.is_active === false) {
            await revokeUserSession(rotated.userId, rotated.sid, db);
            return res.status(401).json({ error: "Session ended. Please sign in again.", code: "REFRESH_INVALID" });
        }
        const token = jwt.sign(
            { id: user.id, username: user.username, tv: user.token_version || 0, sid: rotated.sid, tenant_id: parsed.tenantId, ...realmClaims(TENANT_REALM), cli: MOBILE_CLIENT },
            process.env.JWT_SECRET,
            { expiresIn: MOBILE_ACCESS_TTL_SECONDS },
        );
        res.json({ token, refreshToken: rotated.refreshToken, expiresIn: MOBILE_ACCESS_TTL_SECONDS });
    } catch (err) {
        req.log.error({ err }, "Refresh token exchange error");
        res.status(500).json({ error: "Failed to refresh the session" });
    }
});

export default router;
