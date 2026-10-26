/** Team list queries for the organization routes. */

export interface TeamListDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

export interface TeamListOptions {
    userId: number;
    effectiveOrgId: number | null;
    departmentId?: string;
    /** hr_admin and above see every team with member counts. */
    canSeeAll: boolean;
}

/**
 * Teams the requester may see. Admins get the whole org (optionally filtered by
 * department); everyone else gets only their own team and no member counts.
 */
export async function listTeamsForActor(db: TeamListDb, options: TeamListOptions): Promise<any[]> {
    if (options.canSeeAll) {
        if (!options.effectiveOrgId) return [];
        const where = ["t.org_id = $1"];
        const params: unknown[] = [options.effectiveOrgId];
        let nextIndex = 2;
        if (options.departmentId) {
            where.push(`t.department_id = $${nextIndex++}`);
            params.push(Number(options.departmentId));
        }

        return (await db.query(`
            SELECT t.*, u.full_name as lead_name, d.name as department_name,
                   (SELECT COUNT(*) FROM users WHERE team_id = t.id AND is_active = TRUE)::integer as member_count
            FROM teams t
            LEFT JOIN users u ON u.id = t.lead_id
            LEFT JOIN departments d ON d.id = t.department_id
            WHERE ${where.join(" AND ")}
            ORDER BY t.name
        `, params)).rows;
    }

    const user = (await db.query("SELECT team_id FROM users WHERE id = $1", [options.userId])).rows[0];
    if (!user?.team_id) return [];
    return (await db.query(`
        SELECT t.id, t.name, t.department_id, t.sprint_duration_weeks, t.sprint_start_date,
               u.full_name as lead_name, d.name as department_name
        FROM teams t
        LEFT JOIN users u ON u.id = t.lead_id
        LEFT JOIN departments d ON d.id = t.department_id
        WHERE t.id = $1 AND t.org_id = $2
    `, [user.team_id, options.effectiveOrgId])).rows;
}
