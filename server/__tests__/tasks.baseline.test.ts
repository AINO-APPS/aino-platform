import {
    captureBaseline,
    reasonForChange,
    scopeDelta,
} from "../modules/tasks/tasks.baseline";

const tasks = [
    { id: 1, story_points: 5 },
    { id: 2, story_points: 3 },
];

describe("sprint scope baseline", () => {
    test("starting a sprint records committed points and the task set", () => {
        expect(captureBaseline(tasks)).toEqual({
            committed_points: 8,
            committed_task_ids: [1, 2],
            reason: "start",
        });
    });

    test("a sprint with no scope change reports zero, not a blank", () => {
        const baseline = captureBaseline(tasks);
        expect(scopeDelta(baseline, tasks)).toEqual({
            addedPoints: 0,
            removedPoints: 0,
            addedCount: 0,
            removedCount: 0,
        });
    });

    test("adding scope reports the added points", () => {
        const baseline = captureBaseline(tasks);
        const delta = scopeDelta(baseline, [...tasks, { id: 3, story_points: 8 }]);

        expect(delta.addedPoints).toBe(8);
        expect(delta.addedCount).toBe(1);
        expect(delta.removedPoints).toBe(0);
        expect(reasonForChange(delta)).toBe("scope_add");
    });

    test("removing scope reports the removed points", () => {
        const baseline = captureBaseline(tasks);
        const delta = scopeDelta(baseline, [{ id: 1, story_points: 5 }]);

        expect(delta.removedPoints).toBe(3);
        expect(delta.removedCount).toBe(1);
        expect(reasonForChange(delta)).toBe("scope_remove");
    });

    test("a sprint with no baseline reports zero", () => {
        expect(scopeDelta(null, tasks)).toEqual({
            addedPoints: 0,
            removedPoints: 0,
            addedCount: 0,
            removedCount: 0,
        });
    });

    test("a mixed change has no single reason", () => {
        const baseline = captureBaseline(tasks);
        const delta = scopeDelta(baseline, [{ id: 1, story_points: 5 }, { id: 4, story_points: 2 }]);
        expect(reasonForChange(delta)).toBeNull();
    });
});
