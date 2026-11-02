import * as repo from "../modules/tasks/tasks.sprintRepository";

describe("sprint lifecycle SQL organization scope", () => {
    test("lifecycle reads and writes all include the actor's organization", async () => {
        const query = jest.fn(async (_sql: string, _params: unknown[] = []) => ({ rows: [], rowCount: 0 }));
        const db = { query };
        const orgId = 7;

        await repo.findSprintCarryoverTasks(db, 10, orgId);
        await repo.findSprintStatusInOrg(db, 10, orgId);
        await repo.findNextPlannedSprint(db, 1, 10, orgId);
        await repo.findSprintBurndownInputs(db, 10, orgId);
        await repo.upsertBurndownSnapshot(db, 10, orgId, {
            total: 0,
            done: 0,
            remaining: 0,
            blocked: 0,
            openTasks: 0,
        });
        await repo.claimSprintCompletion(db, 10, orgId);
        await repo.findSprintCompletionActor(db, 10, 1, orgId);
        await repo.findRolloverTarget(db, 11, 1, orgId);
        await repo.lockSprintCompletionMembers(db, 10, orgId);
        await repo.findSprintCompletionVelocity(db, 10, orgId);
        await repo.stampTicketCarryover(db, 10, [2], orgId);
        await repo.linkSprintCarryover(db, 10, 11, orgId);
        await repo.finishSprint(db, 10, 3, orgId);
        await repo.lockSprintForDeletion(db, 10, orgId);
        await repo.pauseSprintForOrg(db, 10, 1, orgId);
        await repo.findSprintMemberIds(db, 10, orgId);
        await repo.deleteSprint(db, 10, orgId);
        await repo.findTeamMemberIds(db, 1, orgId);

        for (const [sql, params] of query.mock.calls) {
            expect(params).toContain(orgId);
            expect(sql).toMatch(/IS NOT DISTINCT FROM/);
        }
        const completionMemberLock = query.mock.calls.find(([sql]) => sql.includes("FOR UPDATE OF t"));
        expect(completionMemberLock?.[0]).toMatch(/ORDER BY t\.id[\s\S]*FOR UPDATE OF t/);
    });
});
