#!/usr/bin/env node
/**
 * One-off for the web-only admin rollout (2026-10-01). Ends the Android app
 * sessions of admin-level users (permission level >= 4) so tokens minted
 * before the `cli: "mobile"` claim existed cannot be replayed as a cookie
 * against admin routes. Those users simply sign in again on their phones.
 *
 * Dry-run by default. Pass --apply to delete the sessions.
 */
import { masterQuery, pool } from "../db";
import { getTenantPool } from "../utils/tenantManager";

// The native app's HTTP stacks: HttpURLConnection (Dalvik) and OkHttp (legacy app).
const APP_DEVICE = "(s.device ILIKE 'Dalvik/%' OR s.device ILIKE 'okhttp/%')";
const ADMIN_USER = `(u.role IN ('hr_admin','super_admin','platform_admin')
    OR EXISTS (SELECT 1 FROM tenant_roles tr
                WHERE tr.org_id = u.org_id AND tr.role_key = u.role AND tr.permission_level >= 4))`;
// Legacy DBs without tenant_roles only have the system roles.
const ADMIN_USER_LEGACY = "u.role IN ('hr_admin','super_admin','platform_admin')";

async function findSessions(db: { query: Function }, adminUser: string) {
    return (await db.query(
        `SELECT s.id, u.id AS user_id, u.username, u.role, s.device
           FROM user_sessions s JOIN users u ON u.id = s.user_id
          WHERE ${APP_DEVICE} AND ${adminUser}`,
    )).rows;
}

async function run(apply = false) {
    const tenants = (await masterQuery("SELECT id,slug,db_name,db_host FROM tenants WHERE status <> 'deleted' ORDER BY id")).rows;
    let total = 0;
    for (const tenant of tenants) {
        const db = await getTenantPool(tenant.db_name, tenant.db_host);
        const rows = await findSessions(db, ADMIN_USER).catch(() => findSessions(db, ADMIN_USER_LEGACY));
        for (const row of rows) {
            console.log(`${apply ? "END" : "WOULD END"} ${tenant.slug}#${row.user_id} (${row.username}, ${row.role}) ${row.device}`);
            if (apply) await db.query("DELETE FROM user_sessions WHERE id = $1", [row.id]);
        }
        total += rows.length;
    }
    console.log(`${apply ? "APPLY" : "DRY RUN"}: ${total} app session(s) of admin-level users`);
}

if (require.main === module) run(process.argv.includes("--apply"))
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => pool.end());

export { run };
