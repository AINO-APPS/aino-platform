import { removeTeam } from "../modules/organization/teamOwnership";

test.each([false, true])("team grant cleanup uses the selected team's org (platform admin=%s)", async (isPlatformAdmin) => {
    const query = jest.fn(async (sql: string, _params?: unknown[]) => ({
        rows: sql.startsWith("SELECT * FROM teams") ? [{ id: 21, org_id: 7 }] : [],
        rowCount: 1,
    }));
    await expect(removeTeam({ query }, {
        teamId: 21, orgId: isPlatformAdmin ? null : 7, isPlatformAdmin, projectOwnership: true,
    })).resolves.toMatchObject({ team: { id: 21, org_id: 7 } });

    const cleanup = query.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM project_members"));
    expect(cleanup).toBeDefined();
    expect(cleanup![0]).toMatch(/USING projects/);
    expect(cleanup![0]).toMatch(/project_id\s*=\s*p\.id/);
    expect(cleanup![0]).toMatch(/p\.org_id\s*=\s*\$2/);
    expect(cleanup![1]).toEqual([21, 7]);
});
