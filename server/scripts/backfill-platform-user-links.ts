#!/usr/bin/env node
/** Dry-run by default. Pass --apply to persist explicit dual-principal links. */
import { masterQuery, pool } from "../db";
import { getTenantPool } from "../utils/tenantManager";

async function run(apply = false) {
    const platforms = (await masterQuery("SELECT id,username,email FROM platform_users ORDER BY id")).rows;
    const tenants = (await masterQuery("SELECT id,slug,db_name,db_host FROM tenants WHERE status <> 'deleted' ORDER BY id")).rows;
    const candidates: any[] = [];
    for (const tenant of tenants) {
        const db = await getTenantPool(tenant.db_name, tenant.db_host);
        for (const platform of platforms) {
            const user = (await db.query(
                `SELECT id,username,email,role,is_active,hidden_from_directory
                   FROM users WHERE LOWER(username)=LOWER($1)
                      OR ($2::text IS NOT NULL AND LOWER(email)=LOWER($2))
                  LIMIT 1`, [platform.username, platform.email || null],
            )).rows[0];
            if (user && !String(user.username).startsWith("platform_inspector_")) {
                candidates.push({ tenant, platform, user });
            }
        }
    }
    console.log(`${apply ? "APPLY" : "DRY RUN"}: ${candidates.length} candidate link(s)`);
    for (const c of candidates) {
        const { tenant, platform, user } = c;
        const db = await getTenantPool(tenant.db_name, tenant.db_host);
        console.log(`${apply ? "LINK" : "WOULD LINK"} platform#${platform.id} -> ${tenant.slug}#${user.id} (${user.username})`);
        if (!apply) continue;
        // Repair only rows matching the precise historical pollution shape.
        if (!user.is_active && user.hidden_from_directory && user.role === "platform_admin") {
            await db.query("UPDATE users SET is_active=TRUE, hidden_from_directory=FALSE, role='employee' WHERE id=$1", [user.id]);
            await masterQuery(
                `INSERT INTO user_directory(email,username,tenant_id,user_id)
                 VALUES(LOWER($1),LOWER($2),$3,$4) ON CONFLICT DO NOTHING`,
                [user.email, user.username, tenant.id, user.id],
            );
        }
        await masterQuery(`INSERT INTO platform_user_links
            (platform_user_id,tenant_id,tenant_user_id,default_realm,linked_by)
            VALUES($1,$2,$3,'tenant',$1)
            ON CONFLICT(platform_user_id,tenant_id) DO UPDATE SET tenant_user_id=EXCLUDED.tenant_user_id`,
            [platform.id,tenant.id,user.id]);
    }
}

if (require.main === module) run(process.argv.includes("--apply"))
    .catch((e) => { console.error(e.message); process.exitCode=1; })
    .finally(() => pool.end());

export { run };