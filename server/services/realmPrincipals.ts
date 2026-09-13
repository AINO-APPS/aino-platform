const { masterQuery } = require("./masterDatabase");
import { consoleHost } from "../platform/reservedHosts";

export function tenantAppUrl(tenant: any): string {
    const host = tenant?.custom_domain || process.env.APP_HOST || "aino.org.in";
    return `https://${host}`;
}

export function platformConsoleUrl(): string {
    return `https://${consoleHost() || "console.aino.org.in"}`;
}

/** Revalidate a platform principal immediately before establishing a session. */
export async function availablePlatformPrincipal(userId: number): Promise<any | null> {
    const user = (await masterQuery(
        "SELECT * FROM platform_users WHERE id = $1 AND is_active = TRUE",
        [userId],
    )).rows[0];
    return user || null;
}

export async function linkedPrincipals(
    platformUserId: number,
    tenantId: number,
    tenantUserId: number,
    getTenantDb: (id: number) => Promise<any>,
) {
    const link = (await masterQuery(
        `SELECT pul.*, t.org_name, t.slug, t.custom_domain, t.status, t.db_name, t.db_host
           FROM platform_user_links pul
           JOIN tenants t ON t.id = pul.tenant_id
          WHERE pul.platform_user_id = $1 AND pul.tenant_id = $2 AND pul.tenant_user_id = $3`,
        [platformUserId, tenantId, tenantUserId],
    )).rows[0];
    if (!link || link.status !== "active") return null;
    const platform = (await masterQuery("SELECT * FROM platform_users WHERE id = $1", [platformUserId])).rows[0];
    const tenantDb = await getTenantDb(tenantId);
    if (!platform || !platform.is_active || !tenantDb) return null;
    const tenantUser = (await tenantDb.query("SELECT * FROM users WHERE id = $1", [tenantUserId])).rows[0];
    if (!tenantUser || !tenantUser.is_active) return null;
    return { link, platform, tenantUser, tenantDb };
}

export async function platformProfile(userId: number): Promise<any | null> {
    const platformUser = (await masterQuery(`
        SELECT id, username, full_name, email, avatar, role, must_change_password, platform_role
        FROM platform_users
        WHERE id = $1 AND is_active = TRUE
    `, [userId])).rows[0];
    if (!platformUser) return null;
    const hasLinkedRealm = !!(await masterQuery(
        "SELECT 1 FROM platform_user_links WHERE platform_user_id = $1 LIMIT 1",
        [userId],
    )).rows[0];
    return {
        ...platformUser,
        has_linked_realm: hasLinkedRealm,
        must_change_password: !!platformUser.must_change_password,
        org_id: null,
        team_id: null,
        department_id: null,
        tenant_id: null,
        has_reports: false,
    };
}

export async function hasLinkedTenantRealm(tenantId: number, tenantUserId: number): Promise<boolean> {
    return !!(await masterQuery(
        "SELECT 1 FROM platform_user_links WHERE tenant_id = $1 AND tenant_user_id = $2 LIMIT 1",
        [tenantId, tenantUserId],
    )).rows[0];
}

export async function findLinkedPrincipal(filters: {
    platformUserId?: number;
    tenantId?: number;
    tenantUserId?: number;
}) {
    if (filters.platformUserId) {
        const params: number[] = [filters.platformUserId];
        let tenantFilter = "";
        if (filters.tenantId) { params.push(filters.tenantId); tenantFilter = " AND pul.tenant_id = $2"; }
        return masterQuery(`SELECT * FROM platform_user_links pul WHERE pul.platform_user_id = $1${tenantFilter} ORDER BY pul.linked_at`, params);
    }
    return masterQuery(
        "SELECT * FROM platform_user_links WHERE tenant_id = $1 AND tenant_user_id = $2",
        [filters.tenantId, filters.tenantUserId],
    );
}