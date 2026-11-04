import { projectRoleAllows, resolveEffectiveProjectRole } from "../modules/tasks/tasks.projectAccess";

describe("project access roles", () => {
    test("uses the highest personal or team grant", () => {
        expect(resolveEffectiveProjectRole({
            orgRole: "employee",
            personalRole: "viewer",
            teamRoles: ["member", "project_admin"],
        })).toBe("project_admin");
    });

    test("treats organization admins as project admins without a grant", () => {
        for (const orgRole of ["super_admin", "hr_admin", "platform_admin"]) {
            expect(resolveEffectiveProjectRole({
                orgRole,
                personalRole: null,
                teamRoles: [],
            })).toBe("project_admin");
        }
    });

    test("returns no role to an actor without a grant", () => {
        expect(resolveEffectiveProjectRole({
            orgRole: "employee",
            personalRole: null,
            teamRoles: [],
        })).toBeNull();
    });

    test("only project admins may manage members", () => {
        expect(projectRoleAllows("project_admin", "manageMembers")).toBe(true);
        expect(projectRoleAllows("member", "manageMembers")).toBe(false);
        expect(projectRoleAllows("viewer", "manageMembers")).toBe(false);
        expect(projectRoleAllows(null, "manageMembers")).toBe(false);
    });
});
