import { insertNoteTicket } from "../modules/tasks/tasks.notes";

test("note-created tasks are assigned to the org's general project", async () => {
    const query = jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [{ id: 44 }], rowCount: 1 }));

    await expect(insertNoteTicket({ query }, {
        userId: 7,
        orgId: 3,
        title: "Follow up",
    })).resolves.toBe(44);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO tasks (user_id, org_id, project_id, title");
    expect(sql).toContain("p.org_id IS NOT DISTINCT FROM $2 AND p.is_general");
    expect(sql).not.toMatch(/team_id|planned_date/);
    expect(params).toEqual([7, 3, "Follow up"]);
});
