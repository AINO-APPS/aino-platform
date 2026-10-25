import {
    displaySprintStatus,
    isSprintActive,
    isSprintFrozen,
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
});
