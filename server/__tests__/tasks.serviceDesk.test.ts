import { createServiceDeskBacklogTask } from "../modules/tasks/tasks.serviceDesk";
import { cancelServiceDeskCopy, syncServiceDeskStatus } from "../modules/tasks/tasks.serviceDeskRepository";

describe("service-desk task workflow placement", () => {
    test.each(["sync", "cancel"])("%s locks org-consistent copies in ticket id order", async (operation) => {
        const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
        if (operation === "sync") await syncServiceDeskStatus({ query }, 99, "resolved");
        else await cancelServiceDeskCopy({ query }, 99);

        const sql = query.mock.calls[0][0].replace(/\s+/g, " ");
        expect(sql).toContain("JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id");
        expect(sql).toContain("w.org_id = p.org_id AND w.project_id = p.id");
        expect(sql).toContain("WHERE t.service_desk_ticket_id = $1 ORDER BY t.id FOR UPDATE OF t");
    });

    test("uses the selected project's initial workflow state", async () => {
        const query = jest.fn()
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

        const [insertSql, params] = query.mock.calls[1];
        expect(insertSql).toContain("org_id, project_id");
        expect(insertSql).not.toContain("team_id");
        expect(insertSql).toContain("workflow_state_id, service_desk_ticket_id");
        expect(params).toEqual([3, "Mirrored issue", "", "medium", 1, 21, 42, 99]);
    });
});
