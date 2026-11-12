import fs from "fs";
import path from "path";
import type { QueryFn } from "../../types/domain";
import { assertProjectTypesRemovalReady } from "./projectTypesRemoval";

const MIGRATION_NAME = "0035_project_types_contraction";
const MIGRATION_PATH = path.join(__dirname, "../../platform/db/guardedMigrations", `${MIGRATION_NAME}.sql`);

export interface ProjectTypesContractionTarget {
    name: string;
    transaction(callback: (query: QueryFn) => Promise<unknown>): Promise<unknown>;
}

export async function runProjectTypesContraction(options: {
    env?: () => NodeJS.ProcessEnv;
    verifyOwnership: () => Promise<void>;
    tenantQueries: ProjectTypesContractionTarget[];
}): Promise<string[]> {
    const env = (options.env ?? (() => process.env))();
    await assertProjectTypesRemovalReady(env, options.verifyOwnership);
    if (options.tenantQueries.length === 0) throw new Error("Project ownership inventory is empty");

    const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
    const applied: string[] = [];
    for (const target of options.tenantQueries) {
        const didApply = await target.transaction(async (query) => {
            await query("SELECT pg_advisory_xact_lock(hashtext($1))", [`aino:${MIGRATION_NAME}:${target.name}`]);
            await query(`CREATE TABLE IF NOT EXISTS _migrations (
                name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW()
            )`);
            const existing = await query("SELECT 1 FROM _migrations WHERE name = $1", [MIGRATION_NAME]);
            if (existing.rows.length) return false;
            await query("SELECT set_config('aino.project_types_contraction', 'ready', true)");
            await query(sql);
            await query("INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [MIGRATION_NAME]);
            return true;
        });
        if (didApply === true) applied.push(target.name);
    }
    return applied;
}
