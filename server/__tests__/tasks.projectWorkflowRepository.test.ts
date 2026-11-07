import * as workflow from "../modules/tasks/tasks.projectWorkflowRepository";

describe("project workflow repository organization boundary", () => {
    const orgId = 7;
    const projectId = 21;
    const stateId = 42;
    const cases: Array<[string, (db: workflow.WorkflowDb) => Promise<unknown>]> = [
        ["categories", (db) => workflow.missingProjectWorkflowCategories(db, orgId, projectId)],
        ["state lookup", (db) => workflow.findProjectWorkflowState(db, orgId, projectId, stateId)],
        ["create", (db) => workflow.createProjectWorkflowState(db, {
            orgId, projectId, key: "blocked", name: "Blocked", category: "in_progress",
            color: "#123456", icon: null, wipLimit: null, isInitial: true, isTerminal: false,
        })],
        ["reorder", (db) => workflow.reorderProjectWorkflowStates(db, orgId, projectId, [stateId])],
        ["update", (db) => workflow.updateProjectWorkflowState(db, orgId, projectId, stateId, { name: "Changed", is_active: false })],
        ["initial state", (db) => workflow.setOtherProjectWorkflowStatesNonInitial(db, orgId, projectId, stateId)],
        ["ticket count", (db) => workflow.countTasksInWorkflowState(db, orgId, stateId)],
        ["delete", (db) => workflow.deleteProjectWorkflowState(db, orgId, projectId, stateId)],
        ["active states", (db) => workflow.listActiveProjectWorkflowStates(db, orgId, projectId)],
        ["transitions", (db) => workflow.replaceProjectWorkflowTransitions(db, orgId, projectId, [{ from_state_id: 42, to_state_id: 43 }])],
    ];

    test.each(cases)("%s scopes every read and mutation to the request organization", async (_name, operation) => {
        const query = jest.fn().mockResolvedValue({ rows: [{ id: stateId, next: 3, count: 2 }], rowCount: 1 });
        const db: workflow.WorkflowDb = { query, transaction: async (run) => run(db) };
        await operation(db);

        const readsAndWrites = query.mock.calls.filter(([sql]) => !/^\s*INSERT/i.test(sql));
        expect(readsAndWrites.length).toBeGreaterThan(0);
        for (const [sql, params] of readsAndWrites) {
            const scope = sql.match(/\borg_id\s*=\s*\$(\d+)/);
            expect(scope).not.toBeNull();
            expect(params[Number(scope![1]) - 1]).toBe(orgId);
        }
    });
});
