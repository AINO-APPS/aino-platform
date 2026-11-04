import { createServiceDeskBacklogTask } from "../modules/tasks/tasks.serviceDesk";

describe("service-desk task workflow placement", () => {
    test("uses the selected project's initial workflow state", async () => {
        const query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ team_id: 7 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 21, workflow_state_id: 42 }], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [], rowCount: 1 });

        await createServiceDeskBacklogTask({ query }, {
            creatorId: 3,
            orgId: 1,
            title: "Mirrored issue",
            description: "",
            priority: "medium",
            ticketId: 99,
        });

        const [insertSql, params] = query.mock.calls[2];
        expect(insertSql).toContain("team_id, project_id");
        expect(insertSql).toContain("workflow_state_id, service_desk_ticket_id");
        expect(params).toEqual([3, "Mirrored issue", "", "medium", 1, 7, 21, 42, 99]);
    });
});
