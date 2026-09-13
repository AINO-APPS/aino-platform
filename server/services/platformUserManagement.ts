import type { Request, Response } from "express";
const { masterQuery } = require("./masterDatabase");
const { getTenantById, getTenantPool } = require("../utils/tenantManager");
const { logPlatformAction } = require("../utils/platformAudit");
const { logger } = require("../utils/logger");
const redis = require("../redis");
const bcrypt = require("bcryptjs");
const { validatePassword, validateUsername, BCRYPT_ROUNDS } = require("../utils/password");

export async function listPlatformUsers(_req: Request, res: Response) {
    try {
        const result = await masterQuery(`SELECT id, username, full_name, email, avatar, is_active, created_at,
            platform_role, mfa_required FROM platform_users ORDER BY created_at DESC`);
        res.json(result.rows);
    } catch (err) {
        logger.error({ err }, "List platform users error");
        res.status(500).json({ error: "Failed to list platform users" });
    }
}

export async function createPlatformUser(req: Request, res: Response) {
    try {
        const { username, password, full_name, email } = req.body;
        if (!username || !password || !full_name || !email) return res.status(400).json({ error: "username, password, full_name and email are required" });
        const pwError = await validatePassword(password);
        if (pwError) return res.status(400).json({ error: pwError });
        const usernameError = validateUsername(username);
        if (usernameError) return res.status(400).json({ error: usernameError });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Invalid email format" });
        const existing = await masterQuery("SELECT id FROM platform_users WHERE username = $1 OR email = $2", [username.toLowerCase(), email.toLowerCase()]);
        if (existing.rows[0]) return res.status(409).json({ error: "Username or email already exists" });
        const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const result = await masterQuery(
            "INSERT INTO platform_users (username, password, full_name, email) VALUES ($1, $2, $3, $4) RETURNING id, username, full_name, email, is_active, created_at",
            [username.toLowerCase(), hash, full_name, email.toLowerCase()],
        );
        logPlatformAction(req, "platform_admin_created", "platform_user", result.rows[0].id, { username, full_name });
        res.status(201).json({ user: result.rows[0], message: "Platform admin created successfully" });
    } catch (err) {
        logger.error({ err }, "Create platform user error");
        res.status(500).json({ error: "Failed to create platform admin" });
    }
}

export async function togglePlatformUser(req: Request, res: Response) {
    try {
        const uid = Number(req.params.id);
        if (uid === req.userId) return res.status(400).json({ error: "Cannot deactivate yourself" });
        const target = (await masterQuery("SELECT id, is_active, full_name FROM platform_users WHERE id = $1", [uid])).rows[0];
        if (!target) return res.status(404).json({ error: "Platform user not found" });
        const newActive = !target.is_active;
        if (!newActive && target.is_active) {
            const activeCount = parseInt((await masterQuery("SELECT COUNT(*) FROM platform_users WHERE is_active = TRUE")).rows[0].count, 10);
            if (activeCount <= 1) return res.status(400).json({
                error: "Cannot deactivate the last active platform admin. Create or reactivate another platform admin first.",
                code: "LAST_PLATFORM_ADMIN",
            });
        }
        await masterQuery(
            `UPDATE platform_users
                SET is_active = $1,
                    token_version = CASE WHEN $1 = FALSE THEN COALESCE(token_version, 0) + 1 ELSE token_version END,
                    updated_at = NOW()
              WHERE id = $2`,
            [newActive, uid],
        );
        if (!newActive) {
            await masterQuery("DELETE FROM user_sessions WHERE user_id = $1", [uid]);
            await redis.invalidateTokenVersion(null, uid);
            await redis.invalidateUserSessions(null, uid);
        }
        logPlatformAction(req, newActive ? "platform_admin_reactivated" : "platform_admin_deactivated", "platform_user", uid, { full_name: target.full_name });
        res.json({ message: `${target.full_name} has been ${newActive ? "reactivated" : "deactivated"}`, is_active: newActive });
    } catch (err) {
        logger.error({ err }, "Deactivate platform user error");
        res.status(500).json({ error: "Failed to update platform user" });
    }
}

export async function resetPlatformUserPassword(req: Request, res: Response) {
    try {
        const uid = Number(req.params.id);
        if (uid === req.userId) return res.status(400).json({
            error: "Use Change Password to update your own password without unexpectedly ending this console session.",
            code: "SELF_PASSWORD_RESET_DENIED",
        });
        const { new_password } = req.body;
        if (!new_password || new_password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });
        if (new_password.length > 72) return res.status(400).json({ error: "Password must be 72 characters or less" });
        const pwErr = await validatePassword(new_password);
        if (pwErr) return res.status(400).json({ error: pwErr });
        const target = (await masterQuery("SELECT id, full_name FROM platform_users WHERE id = $1", [uid])).rows[0];
        if (!target) return res.status(404).json({ error: "Platform user not found" });
        const hash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);
        await masterQuery("UPDATE platform_users SET password = $1, token_version = COALESCE(token_version, 0) + 1, updated_at = NOW() WHERE id = $2", [hash, uid]);
        await redis.invalidateTokenVersion(null, uid);
        logPlatformAction(req, "platform_admin_reset_password", "platform_user", uid, { full_name: target.full_name });
        res.json({ message: `Password reset for ${target.full_name}` });
    } catch (err) {
        logger.error({ err }, "Reset platform user password error");
        res.status(500).json({ error: "Failed to reset password" });
    }
}

async function requirePlatformOwner(req: Request, res: Response): Promise<boolean> {
    const actor = (await masterQuery("SELECT platform_role FROM platform_users WHERE id = $1 AND is_active = TRUE", [req.userId])).rows[0];
    if (actor?.platform_role === "platform_owner") return true;
    res.status(403).json({ error: "Platform owner role required", code: "PLATFORM_OWNER_REQUIRED" });
    return false;
}

export async function listPlatformUserLinks(req: Request, res: Response) {
    if (!(await requirePlatformOwner(req, res))) return;
    const result = await masterQuery(`SELECT pul.platform_user_id, pul.tenant_id, pul.tenant_user_id,
        pul.default_realm, pul.linked_at, t.org_name, t.slug, t.status FROM platform_user_links pul
        JOIN tenants t ON t.id = pul.tenant_id WHERE pul.platform_user_id = $1 ORDER BY pul.linked_at`, [Number(req.params.id)]);
    res.json({ links: result.rows });
}

export async function linkPlatformUser(req: Request, res: Response) {
    if (!(await requirePlatformOwner(req, res))) return;
    const platformUserId = Number(req.params.id);
    const tenantId = Number(req.body?.tenant_id);
    const tenantUserId = Number(req.body?.tenant_user_id);
    const defaultRealm = req.body?.default_realm === "platform" ? "platform" : "tenant";
    if (!platformUserId || !tenantId || !tenantUserId) return res.status(400).json({ error: "tenant_id and tenant_user_id are required" });
    const platformUser = (await masterQuery("SELECT id FROM platform_users WHERE id = $1", [platformUserId])).rows[0];
    const tenant = await getTenantById(tenantId);
    if (!platformUser || !tenant) return res.status(404).json({ error: "Platform user or tenant not found" });
    const db = await getTenantPool(tenant.db_name, tenant.db_host);
    const tenantUser = (await db.query("SELECT id, username, full_name, email, is_active, hidden_from_directory FROM users WHERE id = $1", [tenantUserId])).rows[0];
    if (!tenantUser || !tenantUser.is_active || tenantUser.hidden_from_directory) return res.status(400).json({ error: "An active, visible tenant user is required", code: "INVALID_TENANT_PRINCIPAL" });
    const result = await masterQuery(`INSERT INTO platform_user_links
        (platform_user_id, tenant_id, tenant_user_id, default_realm, linked_by) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (platform_user_id, tenant_id) DO UPDATE SET tenant_user_id = EXCLUDED.tenant_user_id,
        default_realm = EXCLUDED.default_realm, linked_by = EXCLUDED.linked_by, linked_at = NOW() RETURNING *`,
        [platformUserId, tenantId, tenantUserId, defaultRealm, req.userId]);
    await logPlatformAction(req, "platform_principal_linked", "platform_user", platformUserId, {
        tenant_id: tenantId, tenant_user_id: tenantUserId, default_realm: defaultRealm,
    }, tenantId);
    res.status(201).json({ link: result.rows[0], tenant_user: tenantUser });
}

export async function unlinkPlatformUser(req: Request, res: Response) {
    if (!(await requirePlatformOwner(req, res))) return;
    const platformUserId = Number(req.params.id);
    const tenantId = Number(req.params.tenantId);
    const result = await masterQuery("DELETE FROM platform_user_links WHERE platform_user_id = $1 AND tenant_id = $2 RETURNING *", [platformUserId, tenantId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Link not found" });
    await logPlatformAction(req, "platform_principal_unlinked", "platform_user", platformUserId, {
        tenant_id: tenantId, tenant_user_id: result.rows[0].tenant_user_id,
    }, tenantId);
    res.json({ message: "Linked tenant principal removed" });
}