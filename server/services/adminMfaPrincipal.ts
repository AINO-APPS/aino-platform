import { mfaRequiredForLevel } from "./adminMfa";
const { masterQuery } = require("./masterDatabase");
const { getTenantPool, getTenantById } = require("../utils/tenantManager");
const { levelForRole, getTenantRolesMap } = require("../middleware/rbac");

export interface MfaPrincipal {
    user: any;
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>; transaction?: unknown };
    tenantId: number | null;
    isPlatformUser: boolean;
    /** True when this account's role must use MFA (admins, platform operators). */
    required: boolean;
}

/** Loads the user row and its database for MFA flows; null when gone or deactivated. */
export async function loadMfaPrincipal(userId: number, tenantId: number | null, isPlatformUser: boolean): Promise<MfaPrincipal | null> {
    if (isPlatformUser) {
        const user = (await masterQuery("SELECT * FROM platform_users WHERE id = $1", [userId])).rows[0];
        if (!user || user.is_active === false) return null;
        return { user, db: { query: masterQuery }, tenantId: null, isPlatformUser: true, required: true };
    }
    if (!tenantId) return null;
    const tenant = await getTenantById(tenantId);
    if (!tenant || tenant.status !== "active") return null;
    const pool = await getTenantPool(tenant.db_name, tenant.db_host);
    const db = { query: pool.query, transaction: pool.transaction };
    const user = (await db.query("SELECT * FROM users WHERE id = $1", [userId])).rows[0];
    if (!user || user.is_active === false) return null;
    const level = levelForRole(user.role, await getTenantRolesMap(db, user.org_id, tenantId));
    return { user, db, tenantId, isPlatformUser: false, required: mfaRequiredForLevel(level) };
}
