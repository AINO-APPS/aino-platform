import { addSprintManagementCapability } from "../modules/tasks/tasks.sprintProjects";
import type { TaskActor } from "../modules/tasks/tasks.policy";

describe("addSprintManagementCapability", () => {
    test("uses each project role and archive state for sprint management", async () => {
        const roleByProject = new Map([
            [10, "member" as const],
            [20, "viewer" as const],
            [30, "project_admin" as const],
        ]);
        const actor: TaskActor = {
            userId: 5,
            orgId: 1,
            teamId: null,
            role: "employee",
            projectAccess: {
                roleForProject: jest.fn(async () => null),
                rolesForProjects: jest.fn(async (ids) =>
                    new Map(ids.map((id) => [id, roleByProject.get(id) ?? null])),
                ),
                accessibleProjectIds: jest.fn(async () => []),
            },
        };
        const db = {
            query: jest.fn(async () => ({
                rows: [
                    { id: 10, is_archived: false },
                    { id: 20, is_archived: false },
                    { id: 30, is_archived: true },
                ],
                rowCount: 3,
            })),
        };
        const sprints = [
            { id: 1, project_id: 10, status: "active" },
            { id: 2, project_id: 20, status: "active" },
            { id: 3, project_id: 30, status: "planned" },
        ];

        const result = await addSprintManagementCapability(db, sprints, actor);

        expect(result.map((sprint) => sprint.can_manage)).toEqual([true, false, false]);
        expect(sprints.every((sprint) => !("can_manage" in sprint))).toBe(true);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(actor.projectAccess?.rolesForProjects).toHaveBeenCalledWith([10, 20, 30]);
    });

    test("a sprint without a project cannot be managed", async () => {
        const sprints = [{ id: 1 }];

        await expect(addSprintManagementCapability(
            { query: jest.fn() },
            sprints,
            {
                userId: 5,
                orgId: 1,
                teamId: 2,
                role: "team_lead",
            },
        )).resolves.toEqual([{ id: 1, can_manage: false }]);
    });
});
