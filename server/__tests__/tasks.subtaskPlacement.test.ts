import { placeTickets } from "../modules/tasks/tasks.placement";

/** Database boundary double; exercise the real placement policy and writers. */
test("placing a parent publishes a move and sprint history for both tickets", async () => {
    const tickets = [
        { id: 1, org_id: 1, project_id: 10, sprint_id: null, planned_date: null },
        { id: 2, org_id: 1, project_id: 10, sprint_id: null, planned_date: null, parent_task_id: 1, is_subtask: true },
    ];
    const history: unknown[][] = [];
    const changes: any[] = [];
    const callbacks: Array<() => unknown> = [];
    const db = { query: async (sql: string, params: any[] = []) => {
        const text = sql.replace(/\s+/g, " ");
        let rows: any[] = [];
        if (text.includes("FROM tasks") && text.includes("FOR UPDATE")) rows = tickets.filter(t => params[0].includes(t.id));
        else if (text.includes("FROM tasks") && text.includes("parent_task_id = ANY")) rows = tickets.filter(t => t.parent_task_id && params[0].includes(t.parent_task_id));
        else if (text.includes("FROM sprints")) rows = [{ id: 10, project_id: 10, status: "planned", name: "First" }];
        else if (text.includes("is_subtask") && text.includes("FROM tasks")) rows = tickets.filter(t => t.is_subtask && params[0].includes(t.id));
        else if (text.startsWith("UPDATE tasks")) {
            const ticket = tickets.find(t => t.id === params[1])!;
            ticket.sprint_id = params[0];
            rows = [{ ...ticket }];
        } else if (text.includes("INSERT INTO task_history")) history.push(params);
        return { rows: rows.map(row => ({ ...row })), rowCount: rows.length };
    } };
    const result = await placeTickets({
        db, actor: { userId: 1, orgId: 1 },
        afterCommit: fn => { callbacks.push(fn); },
        effects: { changed: change => { changes.push(change); } },
    }, [1], { sprint: 10 });
    for (const callback of callbacks) await callback();
    expect(result).toMatchObject([{ id: 1, ok: true, task: { sprint_id: 10 } }]);
    expect(changes.map(change => change.after.id)).toEqual([1, 2]);
    expect(history.map(row => row[0])).toEqual([1, 2]);
});
