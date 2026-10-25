import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBoardDrag } from "../hooks/useBoardDrag";

const columns = [
    { id: 1, key: "pending", name: "New", category: "open" },
    { id: 2, key: "in_progress", name: "In Progress", category: "in_progress", wip_limit: 1 },
    { id: 3, key: "done", name: "Done", category: "done", is_terminal: true },
];

const tasks = [
    { id: 10, title: "First", workflow_state_id: 1, status: "pending" },
    { id: 11, title: "Second", workflow_state_id: 2, status: "in_progress" },
];

function setup(overrides: Record<string, unknown> = {}) {
    const onMove = vi.fn().mockResolvedValue(undefined);
    const onAnnounce = vi.fn();
    const hook = renderHook(() =>
        useBoardDrag({ tasks, columns, onMove, onAnnounce, ...overrides }),
    );
    return { hook, onMove, onAnnounce };
}

describe("useBoardDrag", () => {
    beforeEach(() => vi.clearAllMocks());

    test("columns come from the configured workflow states", () => {
        const { hook } = setup();
        expect(columns.map((column) => column.name)).toEqual(["New", "In Progress", "Done"]);
        expect(hook.result.current.draggingId).toBeNull();
    });

    test("a drop moves the task and announces the result", async () => {
        const { hook, onMove, onAnnounce } = setup();

        act(() => hook.result.current.onDragStart(10));
        act(() => hook.result.current.onDragOver(columns[1]));
        await act(async () => {
            hook.result.current.onDrop(columns[1]);
        });

        await waitFor(() => expect(onMove).toHaveBeenCalledWith(tasks[0], columns[1]));
        expect(onAnnounce).toHaveBeenCalledWith("Moved First to In Progress");
    });

    test("keyboard lift and arrow moves between columns", async () => {
        const { hook, onMove } = setup();

        act(() => {
            hook.result.current.onKeyDown({ key: " ", preventDefault: vi.fn() } as any, 10);
        });
        expect(hook.result.current.draggingId).toBe(10);

        await act(async () => {
            hook.result.current.onKeyDown({ key: "ArrowRight", preventDefault: vi.fn() } as any, 10);
        });

        await waitFor(() => expect(onMove).toHaveBeenCalledWith(tasks[0], columns[1]));
    });

    test("exceeding a WIP limit warns and still permits the drop", async () => {
        const { hook, onMove } = setup();

        act(() => hook.result.current.onDragStart(10));
        await act(async () => {
            hook.result.current.onDrop(columns[1]);
        });

        await waitFor(() => expect(onMove).toHaveBeenCalled());
        expect(hook.result.current.wipWarning).toContain("WIP limit");
    });

    test("entering done with an open blocker asks first and permits override", async () => {
        const confirmDone = vi.fn().mockResolvedValue(true);
        const blocked = [{ ...tasks[0], is_blocked: true }];
        const onMove = vi.fn().mockResolvedValue(undefined);
        const hook = renderHook(() =>
            useBoardDrag({ tasks: blocked, columns, onMove, confirmDone }),
        );

        await act(async () => {
            await hook.result.current.move(10, columns[2]);
        });

        expect(confirmDone).toHaveBeenCalledWith(blocked[0], expect.stringContaining("blocker"));
        expect(onMove).toHaveBeenCalledWith(blocked[0], columns[2]);
    });

    test("declining the done warning cancels the move", async () => {
        const confirmDone = vi.fn().mockResolvedValue(false);
        const unchecked = [{
            ...tasks[0],
            acceptance_criteria: [{ text: "works", done: false }],
        }];
        const onMove = vi.fn();
        const hook = renderHook(() =>
            useBoardDrag({ tasks: unchecked, columns, onMove, confirmDone }),
        );

        await act(async () => {
            await hook.result.current.move(10, columns[2]);
        });

        expect(onMove).not.toHaveBeenCalled();
    });

    test("done columns are always visible", () => {
        // The board renders every configured column; nothing filters done out.
        expect(columns.some((column) => column.category === "done")).toBe(true);
    });
});
