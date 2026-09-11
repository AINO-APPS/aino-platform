#!/usr/bin/env node
/**
 * PRE-FLIGHT GATE for the platform/tenant separation train (PR-A).
 *
 * See docs/PLATFORM_TENANT_SEPARATION_PLAN.md § "Pre-flight gate".
 *
 * PR-A removes the `is_default` bypass in hasTenantDataConsent(), so the
 * default (AINO) tenant stops being readable from the Platform Console and
 * becomes reachable only through the consent-gated access flow — where the
 * approver must be a tenant `super_admin` (decision D3).
 *
 * If AINO has no active, non-platform super_admin at that moment, nobody can
 * approve a platform access request and nobody can administer AINO. This
 * script proves the precondition holds BEFORE PR-A deploys.
 *
 * Read-only. Exit codes:
 *   0 — safe to deploy PR-A
 *   1 — precondition violated, or the check could not be completed
 *
 * Usage:
 *   npm run preflight:default-admin
 */
import { masterQuery } from "../db";
import { getTenantPool } from "../utils/tenantManager";

interface DefaultTenant {
    id: number;
    slug: string;
    org_name: string;
    db_name: string;
    db_host: string | null;
}

interface AdminRow {
    id: number;
    username: string;
    full_name: string;
    email: string | null;
}

interface DualPrincipal {
    email: string;
    username: string;
    tenant_id: number;
    tenant_slug: string;
    user_id: number;
    platform_user_id: number;
}

const ok = (m: string) => console.log(`  \u2713 ${m}`);
const bad = (m: string) => console.error(`  \u2717 ${m}`);
const info = (m: string) => console.log(`    ${m}`);

/**
 * Resolve the default tenant. Deliberately strict: only the `is_default` flag
 * counts. The slug/oldest fallbacks used by serviceDesk.ts are a runtime
 * convenience; for a safety gate an ambiguous answer must fail loudly.
 */
async function resolveDefaultTenant(): Promise<DefaultTenant | null> {
    const res = await masterQuery(
        `SELECT id, slug, org_name, db_name, db_host
           FROM tenants
          WHERE is_default = TRUE AND status != 'deleted'`,
    );
    if (res.rows.length > 1) {
        throw new Error(
            `${res.rows.length} tenants are flagged is_default — exactly one is required`,
        );
    }
    return (res.rows[0] as DefaultTenant) || null;
}

/**
 * Active super_admins in the default tenant, excluding synthetic Platform
 * Inspector rows (hidden_from_directory = TRUE), which are support artefacts
 * and cannot approve anything.
 */
async function findTenantSuperAdmins(tenant: DefaultTenant): Promise<AdminRow[]> {
    const db = await getTenantPool(tenant.db_name, tenant.db_host);
    const res = await db.query(
        `SELECT id, username, full_name, email
           FROM users
          WHERE role = 'super_admin'
            AND is_active = TRUE
            AND hidden_from_directory = FALSE
          ORDER BY id ASC`,
    );
    return res.rows as AdminRow[];
}

/**
 * Humans present in BOTH platform_users and user_directory.
 *
 * Today `resolveDefaultDomainUser()` (routes/auth.ts:104-144) resolves these
 * to the platform identity and, for non-default tenants, DEACTIVATES the
 * tenant row. PR-C replaces that with a platform_user_links row. This listing
 * is the backfill input — and, for the default tenant, tells us whether an
 * apparent super_admin is really a platform operator wearing a tenant hat.
 */
async function findDualPrincipals(): Promise<DualPrincipal[]> {
    const res = await masterQuery(
        `SELECT ud.email, ud.username, ud.tenant_id, t.slug AS tenant_slug,
                ud.user_id, pu.id AS platform_user_id
           FROM user_directory ud
           JOIN tenants t ON t.id = ud.tenant_id
           JOIN platform_users pu
             ON LOWER(pu.email) = LOWER(ud.email)
             OR LOWER(pu.username) = LOWER(ud.username)
          ORDER BY ud.tenant_id, ud.username`,
    );
    return res.rows as DualPrincipal[];
}

async function run(): Promise<boolean> {
    let passed = true;

    console.log("\nPre-flight: default tenant administrator\n");

    // ── Check 1: the default tenant exists and is unambiguous ──
    const tenant = await resolveDefaultTenant();
    if (!tenant) {
        bad("No tenant is flagged is_default — PR-A would leave AINO unreachable");
        return false;
    }
    ok(`Default tenant: ${tenant.org_name} (slug=${tenant.slug}, id=${tenant.id})`);

    // ── Check 2: at least one real, active super_admin ──
    const admins = await findTenantSuperAdmins(tenant);
    if (admins.length === 0) {
        bad("No active super_admin in the default tenant");
        info("PR-A gates AINO behind consent; with no approver, access is impossible.");
        info("Fix: promote an AINO employee to super_admin via Admin -> Users, then re-run.");
        passed = false;
    } else {
        ok(`${admins.length} active super_admin(s) in the default tenant`);
        for (const a of admins) info(`- ${a.full_name} <${a.email || "no email"}> (@${a.username})`);
    }

    // ── Check 3: at least one approver is NOT also a platform operator ──
    const dual = await findDualPrincipals();
    const dualInDefault = new Set(
        dual.filter((d) => d.tenant_id === tenant.id).map((d) => d.user_id),
    );
    const independent = admins.filter((a) => !dualInDefault.has(a.id));

    if (admins.length > 0 && independent.length === 0) {
        bad("Every default-tenant super_admin is also a platform_users account");
        info("Self-approval defeats the consent model (decision D3).");
        info("Fix: give at least one AINO super_admin who is not a platform operator, then re-run.");
        passed = false;
    } else if (independent.length > 0) {
        ok(`${independent.length} approver(s) independent of any platform account`);
    }

    // ── Report: dual principals (informational — PR-C backfill input) ──
    console.log("\nDual principals (platform_users \u2229 user_directory)\n");
    if (dual.length === 0) {
        info("None. No PR-C backfill needed.");
    } else {
        info(`${dual.length} found — these become platform_user_links rows in PR-C:`);
        for (const d of dual) {
            const flag = d.tenant_id === tenant.id ? " [default tenant]" : "";
            info(`- ${d.username} <${d.email}> -> tenant ${d.tenant_slug}#${d.tenant_id}${flag}`);
        }
        info("");
        info("NOTE: for non-default tenants, today's login path deactivates the");
        info("tenant row (routes/auth.ts:123-144). PR-C's backfill reactivates them.");
    }

    console.log("");
    console.log(passed
        ? "PRE-FLIGHT PASSED — safe to deploy PR-A."
        : "PRE-FLIGHT FAILED — resolve the items above before deploying PR-A.");
    console.log("");
    return passed;
}

async function main(): Promise<void> {
    const { pool } = require("../db");
    try {
        const passed = await run();
        process.exitCode = passed ? 0 : 1;
    } catch (err) {
        console.error(`\nPre-flight could not complete: ${(err as Error).message}`);
        console.error("Treating as FAILED — the precondition is unproven.\n");
        process.exitCode = 1;
    } finally {
        await pool.end().catch(() => { /* already closed */ });
    }
}

if (require.main === module) main();

export { resolveDefaultTenant, findTenantSuperAdmins, findDualPrincipals, run };
