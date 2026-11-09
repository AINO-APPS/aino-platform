import { buildProjectBoardColumns } from "../modules/tasks/tasks.board";
import { buildLifecycleContext, loadLifecycleContext, type WorkflowState } from "../modules/tasks/tasks.workflow";

const states: WorkflowState[] = [
    { id: 1, key: "pending", name: "New", category: "open", is_initial: true },
    { id: 2, key: "doing", name: "Doing", category: "in_progress", wip_limit: 2 },
    { id: 3, key: "done", name: "Done", category: "done" },
    { id: 4, key: "cancelled", name: "Cancelled", category: "done" },
];

test("columns use the board population, omit Cancelled, and exclude initial only for an enabled Kanban backlog", () => {
    const lifecycle = buildLifecycleContext(states, [], true);
    const tickets = [{ workflow_state_id: 2 }, { workflow_state_id: 2 }, { workflow_state_id: 3 }];
    const board = buildProjectBoardColumns(lifecycle, { type: "kanban", kanban_backlog_enabled: true }, tickets);
    expect(board.map((column) => column.stateId)).toEqual([2, 3]);
    expect(board[0]).toMatchObject({ count: 2, limit: 2, accepting: false, state: { name: "Doing" } });
    const taskList = buildProjectBoardColumns(lifecycle, { type: "task_list", kanban_backlog_enabled: true }, []);
    expect(taskList.map((column) => column.stateId)).toEqual([1, 2, 3]);
    expect(taskList[1]).toMatchObject({ count: 0, accepting: true });
});

test("disabled project WIP preserves occupancy and limits but accepts the column", () => {
    const columns = buildProjectBoardColumns(buildLifecycleContext(states, [], false), { type: "kanban" },
        [{ workflow_state_id: 2 }, { workflow_state_id: 2 }]);
    expect(columns[1]).toMatchObject({ count: 2, limit: 2, accepting: true });
});

test("lifecycle reads project WIP and never the former organization switch", async () => {
    const queries: string[] = [];
    const db = { query: async (sql: string) => {
        queries.push(sql);
        return { rows: sql.includes("FROM workflow_states") ? states : sql.includes("FROM projects") ? [{ enable_wip_limits: true }] : [] };
    } };
    expect((await loadLifecycleContext(db, 1, 10)).wipEnabled).toBe(true);
    expect((await loadLifecycleContext(db, 1)).wipEnabled).toBe(false);
    expect(queries.some((sql) => sql.includes("org_agile_settings"))).toBe(false);
});
