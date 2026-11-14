/** Legacy team-container cleanup used by organization routes. */

export interface TeamOwnershipDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
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
    /** Present after a successful delete: members to evict from the cache. */
    memberIds?: number[];
}

/** Remove the legacy team container and its grants without touching project work. */
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

    const memberIds = await findTeamMemberIds(db, options.teamId);
    await db.query(
        `DELETE FROM project_members pm USING projects p
          WHERE pm.team_id = $1 AND pm.project_id = p.id AND p.org_id = $2`,
        [options.teamId, team.org_id],
    );
    await db.query("UPDATE users SET team_id = NULL WHERE team_id = $1", [options.teamId]);
    await db.query("DELETE FROM teams WHERE id = $1", [options.teamId]);
    return { team, memberIds };
}
