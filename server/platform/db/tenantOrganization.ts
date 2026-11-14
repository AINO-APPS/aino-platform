import { seedAgileDefaults } from "./agileDefaults";

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/**
 * Mark a newly created organization project-owned.
 *
 * The ownership switch is retired, so nothing can switch an organization later.
 * Left at the historical default it would read as unswitched and fail the
 * all-tenant readiness check that guards project-types removal, taking every
 * other tenant's API down with it. After contraction the column is gone and
 * every organization is project-owned by construction, so this does nothing.
 */
export async function markOrganizationProjectOwned(query: Query, orgId: number): Promise<void> {
    const hasSwitch = (await query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = 'organizations' AND column_name = 'project_ownership'`,
    )).rows.length > 0;
    if (!hasSwitch) return;
    await query(
        "UPDATE organizations SET project_ownership = TRUE, project_ownership_switched_at = NOW() WHERE id = $1",
        [orgId],
    );
}

/** Create a new tenant database's organization, project-owned and with agile defaults. */
export async function provisionTenantOrganization(
    query: Query,
    input: { orgName: string; slug: string },
): Promise<void> {
    const inserted = await query(
        `INSERT INTO organizations (id, name, slug, created_by)
         VALUES (1, $1, $2, NULL)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [input.orgName, input.slug],
    );
    if (inserted.rows.length > 0) await markOrganizationProjectOwned(query, 1);
    await seedAgileDefaults(query as any);
}
