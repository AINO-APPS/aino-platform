import {
    applyTaskDelta,
    buildTaskDelta,
    diffTask,
    isEmptyDelta,
} from "../modules/tasks/tasks.deltas";

describe("task field deltas", () => {
    const before = {
        id: 7,
        title: "Refund webhook",
        priority: "medium",
        assigned_to: 2,
        story_points: "5.00",
        due_date: "2026-11-01",
        status: "pending",
    };

    test("only changed fields travel", () => {
        const fields = diffTask(before, { ...before, title: "Refund webhook retries" });
        expect(fields).toEqual({ title: "Refund webhook retries" });
    });

    test("an unchanged task produces no delta at all", () => {
        expect(isEmptyDelta(diffTask(before, { ...before }))).toBe(true);
        expect(buildTaskDelta(7, {}, { id: 1, name: "Ada" })).toBeNull();
    });

    test("numeric columns compare numerically, not as strings", () => {
        // Postgres returns NUMERIC as "5.00" while the client sends 5.
        expect(diffTask(before, { ...before, story_points: 5 })).toEqual({});
        expect(diffTask(before, { ...before, story_points: 8 })).toEqual({ story_points: 8 });
    });

    test("null and empty string are the same absence", () => {
        expect(diffTask({ due_date: null }, { due_date: "" })).toEqual({});
        expect(diffTask({ due_date: "2026-11-01" }, { due_date: null })).toEqual({
            due_date: null,
        });
    });

    test("fields outside the allow-list are never broadcast", () => {
        const fields = diffTask(before, { ...before, org_id: 99, secret: "leak" });
        expect(fields).toEqual({});
    });

    test("two simultaneous edits to different fields both survive", () => {
        const base = { id: 7, title: "Original", priority: "medium", assigned_to: 2 };
        // User A renames; user B reassigns. Each delta carries one field.
        const afterA = applyTaskDelta(base, { fields: { title: "Renamed" } });
        const afterB = applyTaskDelta(afterA, { fields: { assigned_to: 9 } });
        expect(afterB).toMatchObject({ title: "Renamed", assigned_to: 9 });
    });

    test("the same field edited twice resolves to the later write", () => {
        const base = { id: 7, title: "Original" };
        const first = applyTaskDelta(base, {
            fields: { title: "First" },
            at: "2026-10-25T10:00:00.000Z",
        });
        const second = applyTaskDelta(
            first,
            { fields: { title: "Second" }, at: "2026-10-25T10:00:01.000Z" },
            "2026-10-25T10:00:00.000Z",
        );
        expect(second.title).toBe("Second");
    });

    test("an out-of-order frame cannot roll a field back", () => {
        const current = { id: 7, title: "Second" };
        const stale = applyTaskDelta(
            current,
            { fields: { title: "First" }, at: "2026-10-25T09:59:00.000Z" },
            "2026-10-25T10:00:01.000Z",
        );
        expect(stale.title).toBe("Second");
    });

    test("the delta carries the actor and a timestamp", () => {
        const delta = buildTaskDelta(
            7,
            { title: "Renamed" },
            { id: 3, name: "Ada Lovelace" },
            "2026-10-25T10:00:00.000Z",
        );
        expect(delta).toEqual({
            taskId: 7,
            fields: { title: "Renamed" },
            actor: { id: 3, name: "Ada Lovelace" },
            at: "2026-10-25T10:00:00.000Z",
        });
    });

    test("a delta never carries the whole object", () => {
        const delta = buildTaskDelta(7, { title: "Renamed" }, { id: 3, name: "Ada" });
        expect(Object.keys(delta!.fields)).toEqual(["title"]);
        expect(delta).not.toHaveProperty("task");
    });
});
