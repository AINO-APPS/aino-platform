import {
    buildVisibilityPredicate,
    canReadProjectTask,
    isOrgAdmin,
    resolveTaskVisibilityForRequest,
    type TaskActor,
} from "../modules/tasks/tasks.policy";

const access = {
    accessibleProjectIds: jest.fn(async () => [301, 302]),
    roleForProject: jest.fn(async (id: number) => id === 301 ? "member" as const : null),
};

function actor(overrides: Partial<TaskActor> = {}): TaskActor {
    return {
        userId: 7,
        orgId: 1,
        teamId: null,
        role: "employee",
        projectAccess: access,
        ...overrides,
    };
}

describe("project ticket visibility", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        access.accessibleProjectIds.mockResolvedValue([301, 302]);
        access.roleForProject.mockImplementation(async (id: number) => id === 301 ? "member" : null);
    });

    test("list scope contains accessible projects and the actor's own tasks", async () => {
        const visibility = await resolveTaskVisibilityForRequest(actor());
        expect(visibility).toEqual({ kind: "projects", projectIds: [301, 302], userId: 7 });
        expect(buildVisibilityPredicate(visibility, 3)).toEqual({
            sql: "(t.project_id = ANY($3::int[]) OR t.user_id = $4 OR t.assigned_to = $4)",
            params: [[301, 302], 7],
            nextIndex: 5,
        });
    });

    test("a requested project is accessible only when project membership grants a role", async () => {
        await expect(resolveTaskVisibilityForRequest(actor(), { projectId: 301 })).resolves.toEqual({
            kind: "project-scope", projectId: 301, accessible: true, userId: 7,
        });
        await expect(resolveTaskVisibilityForRequest(actor(), { projectId: 999 })).resolves.toEqual({
            kind: "project-scope", projectId: 999, accessible: false, userId: 7,
        });
    });

    test("read access is project-based and rejects cross-organization tasks", async () => {
        await expect(canReadProjectTask({ project_id: 301, org_id: 1 }, actor())).resolves.toBe(true);
        await expect(canReadProjectTask({ project_id: 301, org_id: 2 }, actor())).resolves.toBe(false);
        await expect(canReadProjectTask({ project_id: 999, org_id: 1 }, actor())).resolves.toBe(false);
    });

    test("personal scope remains reporter/assignee-only", async () => {
        await expect(resolveTaskVisibilityForRequest(actor({ role: "hr_admin" }), { scope: "personal" }))
            .resolves.toEqual({ kind: "personal", userId: 7 });
        expect(access.accessibleProjectIds).not.toHaveBeenCalled();
    });

    test("org-admin roles are recognized without a team-visibility flag", () => {
        expect(isOrgAdmin("super_admin")).toBe(true);
        expect(isOrgAdmin("hr_admin")).toBe(true);
        expect(isOrgAdmin("platform_admin")).toBe(true);
        expect(isOrgAdmin("team_lead")).toBe(false);
        expect(isOrgAdmin(null)).toBe(false);
    });
});
