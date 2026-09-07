import type { DbContext } from "../../types/domain";

export async function countAppliedMigrations(db: DbContext): Promise<number> {
    const result = await db.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM _migrations");
    return result.rows[0]?.count || 0;
}