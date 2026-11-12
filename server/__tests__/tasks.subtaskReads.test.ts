import { getTicketHierarchy } from "../modules/tasks/tasks.service";
import type { TaskActor } from "../modules/tasks/tasks.policy";
import { assertTicketHierarchy } from "../modules/tasks/tasks.hierarchy";

test.each([0, 5])("subtask points %s are refused at the hierarchy write boundary", async storyPoints => {
    const db = { query: async (sql: string) => ({
        rows: sql.includes("FROM work_item_types") ? [{ id: 2, is_subtask: true }]
            : sql.includes("WHERE t.id") ? [{ id: 1, org_id: 1, project_id: 10 }] : [],
        rowCount: 0,
    }) };
    await expect(assertTicketHierarchy(db, {
        org_id: 1, project_id: 10, parent_task_id: 1, work_item_type_id: 2, story_points: storyPoints,
    } as any)).rejects.toMatchObject({ code: "INVALID_HIERARCHY", message: expect.stringMatching(/story points/i) });
});

test("parent detail keeps own effort separate from subtask totals and counts done by completion", async () => {
    const ticket = { id: 1, org_id: 1, remaining_estimate_minutes: 30 };
    const children = [
        { id: 2, org_id: 1, is_subtask: true, completed_at: "2026-11-09", remaining_estimate_minutes: 0 },
        { id: 3, org_id: 1, is_subtask: true, completed_at: null, remaining_estimate_minutes: 90 },
    ];
    const db = { query: async (sql: string) => ({
        rows: sql.includes("parent_task_id") ? children : [{ id: 1, minutes: 20 }, { id: 2, minutes: 40 }, { id: 3, minutes: 10 }],
        rowCount: 0,
    }) };
    const detail = await getTicketHierarchy(db, ticket, { userId: 1, orgId: 1, teamId: null, role: "super_admin" } as TaskActor);
    expect(detail).toMatchObject({
        subtask_summary: { total: 2, done: 1 },
        effort: {
            own_time_spent_minutes: 20, total_time_spent_minutes: 70,
            own_remaining_estimate_minutes: 30, total_remaining_estimate_minutes: 120,
        },
    });
});
