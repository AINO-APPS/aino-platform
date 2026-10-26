/**
 * Team ownership checks used by the organization routes.
 *
 * A team that still owns tickets or sprints cannot be deleted: deleting it
 * would orphan tickets and cascade away its sprints. The admin must transfer
 * the tickets and remove the sprints first.
 */

export interface TeamOwnershipDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface TeamWorkCounts {
    tasks: number;
    sprints: number;
}

export async function countTeamWork(
    db: TeamOwnershipDb,
    teamId: unknown,
): Promise<TeamWorkCounts> {
    const [taskCount, sprintCount] = await Promise.all([
        db.query("SELECT COUNT(*)::int AS c FROM tasks WHERE team_id = $1", [teamId]),
        db.query("SELECT COUNT(*)::int AS c FROM sprints WHERE team_id = $1", [teamId]),
    ]);
    return {
        tasks: taskCount.rows[0]?.c ?? 0,
        sprints: sprintCount.rows[0]?.c ?? 0,
    };
}

/** Members about to be detached, so their cached team context can be cleared. */
export async function findTeamMemberIds(
    db: TeamOwnershipDb,
    teamId: unknown,
): Promise<number[]> {
    return (await db.query(
        "SELECT id FROM users WHERE team_id = $1",
        [teamId],
    )).rows.map((row: any) => row.id);
}

export interface RemoveTeamOutcome {
    team: any | null;
    /** Present when the team still owns work and was not deleted. */
    counts?: TeamWorkCounts;
    /** Present after a successful delete: members to evict from the cache. */
    memberIds?: number[];
}

/**
 * Delete a team only when it owns no tickets or sprints, detaching its members
 * first. Returns the team row so the caller can audit and respond.
 */
export async function removeTeam(
    db: TeamOwnershipDb,
    options: { teamId: unknown; orgId: number | null; isPlatformAdmin: boolean },
): Promise<RemoveTeamOutcome> {
    const team = options.isPlatformAdmin
        ? (await db.query("SELECT * FROM teams WHERE id = $1", [options.teamId])).rows[0]
        : (await db.query(
            "SELECT * FROM teams WHERE id = $1 AND org_id = $2",
            [options.teamId, options.orgId],
        )).rows[0];
    if (!team) return { team: null };

    const counts = await countTeamWork(db, options.teamId);
    if (counts.tasks > 0 || counts.sprints > 0) return { team, counts };

    const memberIds = await findTeamMemberIds(db, options.teamId);
    await db.query("UPDATE users SET team_id = NULL WHERE team_id = $1", [options.teamId]);
    await db.query("DELETE FROM teams WHERE id = $1", [options.teamId]);
    return { team, counts, memberIds };
}
