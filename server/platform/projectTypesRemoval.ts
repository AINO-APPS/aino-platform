import { Pool } from "pg";
import { masterQuery } from "./db/pool";

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export async function verifyAllProjectOwnership(options: {
    masterQuery: Query;
    tenantQuery: (database: string, host: string | null) => Promise<Query>;
}): Promise<void> {
    // Include suspended/deleted retained databases: inactive does not mean migrated.
    const catalog = await options.masterQuery("SELECT db_name, db_host FROM tenants ORDER BY id");
    const legacy = await options.masterQuery("SELECT to_regclass('public.organizations') IS NOT NULL AS present");
    if (catalog.rows.length === 0 && legacy.rows[0]?.present !== true) throw new Error("Ownership inventory is empty");
    for (const tenant of catalog.rows) {
        if (typeof tenant.db_name !== "string" || !tenant.db_name) throw new Error("Incomplete ownership inventory");
        await verifyProjectOwnership(await options.tenantQuery(tenant.db_name, tenant.db_host ?? null));
    }
    if (legacy.rows[0]?.present === true) {
        await verifyProjectOwnership(options.masterQuery, { allowEmptyOrganizations: true });
    }
    const after = await options.masterQuery("SELECT db_name, db_host FROM tenants ORDER BY id");
    if (JSON.stringify(catalog.rows) !== JSON.stringify(after.rows)) throw new Error("Ownership inventory changed during verification");
}

export async function verifyProjectOwnership(
    query: Query,
    options: { allowEmptyOrganizations?: boolean } = {},
): Promise<void> {
    const schema = await query(`SELECT table_name || '.' || column_name AS column_name
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND ((table_name = 'organizations' AND column_name IN ('project_ownership', 'project_ownership_switched_at'))
            OR (table_name = 'tasks' AND column_name IN ('planned_date', 'pre_sprint_due_date', 'team_id', 'logged_minutes', 'estimated_minutes'))
            OR (table_name = 'sprints' AND column_name IN ('team_id', 'is_auto', 'auto_managed', 'sprint_number'))
            OR (table_name = 'teams' AND column_name IN ('sprint_mode', 'sprint_paused', 'sprint_start_date', 'sprint_duration_weeks')))`);
    const columns = new Set(schema.rows.map((row) => row.column_name));
    if (!columns.has("organizations.project_ownership")) {
        const timer = await query("SELECT to_regclass('public.task_timers') IS NOT NULL AS present");
        if (columns.size || timer.rows[0]?.present === true) throw new Error("Project-types contraction is incomplete");
        await verifyProjectOwnedData(query);
        return;
    }

    const result = await query(`SELECT COUNT(*)::int AS organizations,
        COUNT(*) FILTER (WHERE project_ownership IS NOT TRUE OR project_ownership_switched_at IS NULL)::int AS unswitched
        FROM organizations`);
    const row = result.rows[0];
    if (!row || !Number.isInteger(row.organizations)
        || row.organizations < (options.allowEmptyOrganizations ? 0 : 1) || row.unswitched !== 0) {
        throw new Error("Project ownership is not verified for every organization");
    }
    await verifyProjectOwnedData(query);
}

async function verifyProjectOwnedData(query: Query): Promise<void> {
    const invalid = await query(`SELECT 1 FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
        WHERE p.id IS NULL OR p.org_id IS DISTINCT FROM t.org_id
        UNION ALL SELECT 1 FROM sprints s LEFT JOIN projects p ON p.id = s.project_id WHERE p.id IS NULL LIMIT 1`);
    if (invalid.rows.length) throw new Error("Project-owned data has not been migrated");
}

/** Uses read-only direct connections because tenant-pool acquisition can migrate. */
export async function verifyPlatformProjectOwnership(): Promise<void> {
    const pools: Pool[] = [];
    try {
        await verifyAllProjectOwnership({ masterQuery, tenantQuery: async (database, host) => {
            const url = new URL(process.env.DATABASE_URL!);
            url.pathname = `/${database}`;
            if (host) url.hostname = host;
            const pool = new Pool({ connectionString: url.toString(), max: 1,
                connectionTimeoutMillis: 5000, statement_timeout: 5000,
                options: "-c default_transaction_read_only=on",
                ssl: url.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: false } : false });
            pools.push(pool);
            return (sql, params) => pool.query(sql, params as any[]);
        } });
    } finally {
        await Promise.all(pools.map(pool => pool.end()));
    }
}
