import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTaskDeltas } from "../hooks/useTaskDeltas";
import { applyTaskDelta, isEmptyDelta } from "../hooks/taskDeltas";
import { REALTIME_EVENT } from "../../../hooks/useWebSocket";

function emit(data: unknown) {
    act(() => {
        window.dispatchEvent(
            new CustomEvent(REALTIME_EVENT, {
                detail: { type: "task_updated", data },
            }),
        );
    });
}

describe("useTaskDeltas", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("a delta patches only the fields it carries", () => {
        let tasks = [{ id: 7, title: "Original", priority: "medium", assigned_to: 2 }];
        const setTasks = vi.fn((updater: (t: any[]) => any[]) => {
            tasks = updater(tasks);
        });
        renderHook(() => useTaskDeltas(setTasks));

        emit({
            taskId: 7,
            fields: { title: "Renamed" },
            actor: { id: 3, name: "Ada" },
            at: "2026-10-25T10:00:00.000Z",
        });

        expect(tasks[0]).toMatchObject({
            title: "Renamed",
            priority: "medium",
            assigned_to: 2,
        });
    });

    test("the affected card is attributed to the actor", () => {
        const setTasks = vi.fn();
        const { result } = renderHook(() => useTaskDeltas(setTasks));

        emit({
            taskId: 7,
            fields: { title: "Renamed" },
            actor: { id: 3, name: "Ada Lovelace" },
            at: "2026-10-25T10:00:00.000Z",
        });

        expect(result.current.attribution["7"]).toMatchObject({ name: "Ada Lovelace" });
    });

    test("the attribution clears itself without blocking the card", () => {
        const setTasks = vi.fn();
        const { result } = renderHook(() => useTaskDeltas(setTasks, { attributionMs: 1000 }));

        emit({
            taskId: 7,
            fields: { title: "Renamed" },
            actor: { id: 3, name: "Ada" },
            at: "2026-10-25T10:00:00.000Z",
        });
        expect(result.current.attribution["7"]).toBeTruthy();

        act(() => {
            vi.advanceTimersByTime(1000);
        });
        expect(result.current.attribution["7"]).toBeUndefined();
    });

    test("an out-of-order frame is ignored", () => {
        let tasks = [{ id: 7, title: "Second" }];
        const setTasks = vi.fn((updater: (t: any[]) => any[]) => {
            tasks = updater(tasks);
        });
        renderHook(() => useTaskDeltas(setTasks));

        emit({
            taskId: 7,
            fields: { title: "Second" },
            actor: { id: 3, name: "Ada" },
            at: "2026-10-25T10:00:01.000Z",
        });
        emit({
            taskId: 7,
            fields: { title: "First" },
            actor: { id: 4, name: "Grace" },
            at: "2026-10-25T09:59:00.000Z",
        });

        expect(tasks[0].title).toBe("Second");
    });

    test("a frame without fields is ignored", () => {
        const setTasks = vi.fn();
        renderHook(() => useTaskDeltas(setTasks));
        emit({ taskId: 7, action: "deleted" });
        expect(setTasks).not.toHaveBeenCalled();
    });
});

describe("taskDeltas helpers", () => {
    test("applying a delta leaves untouched fields alone", () => {
        const task = { id: 1, title: "A", priority: "low" };
        expect(applyTaskDelta(task, { fields: { priority: "high" } })).toEqual({
            id: 1,
            title: "A",
            priority: "high",
        });
    });

    test("unknown fields are dropped", () => {
        const task = { id: 1, title: "A" };
        expect(applyTaskDelta(task, { fields: { secret: "leak" } as any })).toEqual(task);
    });

    test("an empty delta is recognised", () => {
        expect(isEmptyDelta({})).toBe(true);
        expect(isEmptyDelta({ title: "x" })).toBe(false);
    });
});
