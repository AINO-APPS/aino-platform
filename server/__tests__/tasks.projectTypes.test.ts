import { projectTypePolicy, availableProjectTypes, projectTypeChangeRefusal } from "../modules/tasks/tasks.projectTypes";

describe("project type policy", () => {
    test.each([
        ["scrum", false, ["backlog", "sprint", "reports"], true, true, "current_sprint"],
        ["kanban", false, ["board"], false, false, "open_tickets"],
        ["kanban", true, ["backlog", "board"], false, true, "open_except_initial"],
        ["task_list", false, ["list", "board", "calendar"], false, false, "open_tickets"],
    ] as const)("%s exposes stable planning tabs and board scope (backlog %s)", (type, backlog, tabs, sprints, hasBacklog, boardScope) => {
        expect(projectTypePolicy({ type: type, kanban_backlog_enabled: backlog })).toEqual({
            planTabs: tabs, hasSprints: sprints, hasBacklog, boardScope,
            doneWindowDays: 14, includeCancelled: false,
        });
    });
    test("agile controls available destinations, not existing projects", () => {
        expect(availableProjectTypes(false)).toEqual(["task_list"]);
        expect(availableProjectTypes(true)).toEqual(["scrum", "kanban", "task_list"]);
        expect(projectTypeChangeRefusal("scrum", "scrum", false, ["active"])).toBeNull();
        expect(projectTypeChangeRefusal("task_list", "kanban", false, [])).toBe("PROJECT_TYPE_NOT_AVAILABLE");
    });
    test.each(["planned", "active", "paused"])("leaving Scrum refuses %s sprints", (status) => {
        expect(projectTypeChangeRefusal("scrum", "kanban", true, [status])).toBe("PROJECT_HAS_OPEN_SPRINTS");
    });
    test("completed sprint history does not prevent a type change", () => {
        expect(projectTypeChangeRefusal("scrum", "task_list", false, ["completed"])).toBeNull();
        expect(projectTypeChangeRefusal("kanban", "scrum", true, [])).toBeNull();
    });
});

