import {
    displaySprintStatus,
    isSprintActive,
    isSprintFrozen,
    sprintDurationDays,
    planCarryover,
} from "../modules/tasks/tasks.sprintLifecycle";

describe("sprint lifecycle", () => {
    test("a completed sprint is frozen", () => {
        expect(isSprintFrozen({ id: 1, status: "completed" })).toBe(true);
        expect(isSprintFrozen({ id: 1, status: "active" })).toBe(false);
        expect(isSprintFrozen(null)).toBe(false);
    });

    test("paused sprints count as active", () => {
        expect(isSprintActive({ id: 1, status: "paused" })).toBe(true);
        expect(isSprintActive({ id: 1, status: "active" })).toBe(true);
        expect(isSprintActive({ id: 1, status: "planned" })).toBe(false);
        expect(displaySprintStatus({ id: 1, status: "paused" })).toBe("active");
    });

    test("unfinished work moves and finished work stays", () => {
        const plan = planCarryover(
            [
                { id: 1, title: "Open", completed: false, story_points: 5 },
                { id: 2, title: "Done", completed: true, story_points: 3 },
                { id: 3, title: "Also open", completed: false, story_points: 2 },
            ],
            12,
        );

        expect(plan.moving.map((task) => task.id)).toEqual([1, 3]);
        expect(plan.staying.map((task) => task.id)).toEqual([2]);
        expect(plan.movingPoints).toBe(7);
        expect(plan.target).toBe(12);
    });

    test("the default target is the next planned sprint, else the backlog", () => {
        const tasks = [{ id: 1, completed: false }];
        expect(planCarryover(tasks, 12).target).toBe(12);
        expect(planCarryover(tasks, null).target).toBe("backlog");
    });

    test("the target can be overridden", () => {
        const tasks = [{ id: 1, completed: false }];
        expect(planCarryover(tasks, 12, "backlog").target).toBe("backlog");
        expect(planCarryover(tasks, 12, 15).target).toBe(15);
    });

    test("finished work is never carried", () => {
        const plan = planCarryover(
            [{ id: 1, completed: true, story_points: 8 }],
            12,
        );
        expect(plan.moving).toHaveLength(0);
        expect(plan.movingPoints).toBe(0);
        expect(plan.staying).toHaveLength(1);
    });

    test("terminal parents with open subtasks move with every subtask and finished work stays", () => {
        const plan = planCarryover(
            [
                { id: 1, title: "Open parent", is_terminal: false, story_points: 5 },
                { id: 2, title: "Open parent subtask", parent_task_id: 1, is_subtask: true, is_terminal: false, story_points: 2 },
                { id: 3, title: "Done parent with open subtask", is_terminal: true, story_points: 8 },
                { id: 4, title: "Done subtask", parent_task_id: 3, is_subtask: true, is_terminal: true, story_points: 3 },
                { id: 5, title: "Open subtask", parent_task_id: 3, is_subtask: true, is_terminal: false, story_points: 1 },
                { id: 6, title: "Finished parent", is_terminal: true, story_points: 13 },
                { id: 7, title: "Finished subtask", parent_task_id: 6, is_subtask: true, is_terminal: true, story_points: 1 },
            ],
            12,
        );

        expect(plan.movingParents.map((task) => task.id)).toEqual([1, 3]);
        expect(plan.moving.map((task) => task.id)).toEqual([1, 2, 3, 4, 5]);
        expect(plan.movingSubtasks).toBe(3);
        expect(plan.staying.map((task) => task.id)).toEqual([6, 7]);
        expect(plan.movingPoints).toBe(19);
        expect(plan.target).toBe(12);
    });

    test("a new destination remains selected and is not confused with backlog", () => {
        const plan = planCarryover([{ id: 1, is_terminal: false }], 12, "new");

        expect(plan.target).toBe("new");
    });

    test("new sprint duration matches the closing sprint inclusive of both dates", () => {
        expect(sprintDurationDays("2026-11-01", "2026-11-14")).toBe(14);
        expect(sprintDurationDays("2026-11-14", "2026-11-01")).toBeNull();
        expect(sprintDurationDays(null, "2026-11-14")).toBeNull();
    });
});
