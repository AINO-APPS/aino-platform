import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBoardDrag } from "../hooks/useBoardDrag";
import { boardColumns } from "../hooks/boardTargets";

const columns = [
    { id: 1, key: "pending", name: "New", category: "open" },
    { id: 2, key: "in_progress", name: "In Progress", category: "in_progress", wip_limit: 1 },
    { id: 3, key: "done", name: "Done", category: "done", is_terminal: true },
];

const tasks = [
    { id: 10, title: "First", workflow_state_id: 1, workflow_state_key: "pending" },
    { id: 11, title: "Second", workflow_state_id: 2, workflow_state_key: "in_progress" },
];

function setup(overrides: Record<string, unknown> = {}) {
    const onRequestMove = vi.fn().mockResolvedValue("accepted");
    const onAnnounce = vi.fn();
    const hook = renderHook(() =>
        useBoardDrag({ tasks, columns, onRequestMove, onAnnounce, ...overrides }),
    );
    return { hook, onRequestMove, onAnnounce };
}

function press(
    hook: ReturnType<typeof setup>["hook"],
    key: string,
    taskId: number | string = 10,
) {
    return act(() => {
        hook.result.current.onKeyDown(
            { key, preventDefault: vi.fn() } as any,
            taskId,
        );
    });
}

describe("useBoardDrag (keyboard only)", () => {
    beforeEach(() => vi.clearAllMocks());

    test("starts idle and hands no pointer handlers to the board", () => {
        const { hook } = setup();
        expect(hook.result.current.draggingId).toBeNull();
        expect(hook.result.current.overColumn).toBeNull();
        expect((hook.result.current as any).onDrop).toBeUndefined();
        expect((hook.result.current as any).onDragStart).toBeUndefined();
    });

    test("space lifts the card without moving it", () => {
        const { hook, onRequestMove, onAnnounce } = setup();

        press(hook, " ");

        expect(hook.result.current.draggingId).toBe(10);
        expect(onRequestMove).not.toHaveBeenCalled();
        expect(onAnnounce).toHaveBeenCalledWith(expect.stringContaining("Lifted"));
    });

    test("arrow keys choose a column without changing the ticket", () => {
        const { hook, onRequestMove } = setup();

        press(hook, " ");
        press(hook, "ArrowRight");

        // Keys are the stable handle, because fallback states share id 0.
        expect(hook.result.current.overColumn).toBe("in_progress");
        expect(onRequestMove).not.toHaveBeenCalled();
    });

    test("space on the chosen column stages one move", async () => {
        const { hook, onRequestMove, onAnnounce } = setup();

        press(hook, " ");
        press(hook, "ArrowRight");
        await act(async () => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                10,
            );
        });

        expect(onRequestMove).toHaveBeenCalledTimes(1);
        // In Progress is already at its WIP limit, so the advisory travels
        // with the staged move.
        expect(onRequestMove).toHaveBeenCalledWith(
            tasks[0],
            columns[1],
            expect.stringContaining("WIP limit"),
        );
        await waitFor(() =>
            expect(onAnnounce).toHaveBeenCalledWith("Moved First to In Progress"),
        );
    });

    test("a cancelled confirmation announces it and changes nothing", async () => {
        const onRequestMove = vi.fn().mockResolvedValue("cancelled");
        const onAnnounce = vi.fn();
        const hook = renderHook(() =>
            useBoardDrag({ tasks, columns, onRequestMove, onAnnounce }),
        );

        press(hook, " ");
        press(hook, "ArrowRight");
        await act(async () => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                10,
            );
        });

        expect(onRequestMove).toHaveBeenCalledTimes(1);
        expect(onAnnounce).toHaveBeenCalledWith("Move cancelled");
        expect(onAnnounce).not.toHaveBeenCalledWith(expect.stringContaining("Moved"));
    });

    test("escape drops the lift and the selected column", () => {
        const { hook, onRequestMove, onAnnounce } = setup();

        press(hook, " ");
        press(hook, "ArrowRight");
        press(hook, "Escape");

        expect(hook.result.current.draggingId).toBeNull();
        expect(hook.result.current.overColumn).toBeNull();
        expect(onAnnounce).toHaveBeenCalledWith("Move cancelled");
        expect(onRequestMove).not.toHaveBeenCalled();
    });

    test("entering done passes the blocker advisory to the confirmation", async () => {
        const blocked = [{ ...tasks[0], is_blocked: true }];
        const onRequestMove = vi.fn().mockResolvedValue("accepted");
        const hook = renderHook(() =>
            useBoardDrag({ tasks: blocked, columns, onRequestMove }),
        );

        press(hook, " ");
        press(hook, "ArrowRight");
        press(hook, "ArrowRight");
        await act(async () => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                10,
            );
        });

        expect(onRequestMove).toHaveBeenCalledWith(
            blocked[0],
            columns[2],
            expect.stringContaining("open blocker"),
        );
    });

    test("unchecked acceptance criteria are part of the same advisory", async () => {
        const unchecked = [
            {
                ...tasks[0],
                acceptance_criteria: [{ text: "works", done: false }],
            },
        ];
        const onRequestMove = vi.fn().mockResolvedValue("accepted");
        const hook = renderHook(() =>
            useBoardDrag({ tasks: unchecked, columns, onRequestMove }),
        );

        press(hook, " ");
        press(hook, "ArrowRight");
        press(hook, "ArrowRight");
        await act(async () => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                10,
            );
        });

        expect(onRequestMove).toHaveBeenCalledWith(
            unchecked[0],
            columns[2],
            expect.stringContaining("unchecked acceptance criteria"),
        );
    });

    test("a refused column is skipped, with the reason announced", () => {
        const onAnnounce = vi.fn();
        const targetPolicy = vi.fn((_task: any, column: any) =>
            column.key === "in_progress" ? "In Progress requires a review first" : null,
        );
        const hook = renderHook(() =>
            useBoardDrag({ tasks, columns, onRequestMove: vi.fn(), onAnnounce, targetPolicy }),
        );

        press(hook, " ");
        press(hook, "ArrowRight");

        // In Progress is refused, so the next legal column is selected rather
        // than trapping the keyboard on the illegal one.
        expect(hook.result.current.overColumn).toBe("done");
        expect(onAnnounce).toHaveBeenCalledWith(
            expect.stringContaining("In Progress requires a review first"),
        );
        expect(onAnnounce).toHaveBeenCalledWith(
            expect.stringContaining("Done selected"),
        );
    });

    test("when no column is legal the move is never staged", async () => {
        const onRequestMove = vi.fn().mockResolvedValue("accepted");
        const onAnnounce = vi.fn();
        const targetPolicy = () => "This ticket cannot change state yet";
        const hook = renderHook(() =>
            useBoardDrag({ tasks, columns, onRequestMove, onAnnounce, targetPolicy }),
        );

        press(hook, " ");
        press(hook, "ArrowRight");
        expect(hook.result.current.overColumn).toBeNull();
        expect(onAnnounce).toHaveBeenCalledWith(
            expect.stringContaining("This ticket cannot change state yet"),
        );

        await act(async () => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                10,
            );
        });
        expect(onRequestMove).not.toHaveBeenCalled();
    });

    test("fallback states that share id 0 are told apart by key", async () => {
        // Before `/agile` resolves every state has `id: 0`; matching by id
        // would put every ticket in the first column.
        const fallback = [
            { id: 0, key: "pending", name: "New", category: "open" },
            { id: 0, key: "in_progress", name: "In Progress", category: "in_progress" },
            { id: 0, key: "done", name: "Done", category: "done" },
        ];
        const onRequestMove = vi.fn().mockResolvedValue("accepted");
        const hook = renderHook(() =>
            useBoardDrag({ tasks, columns: fallback, onRequestMove }),
        );

        press(hook, " ");
        press(hook, "ArrowRight");
        expect(hook.result.current.overColumn).toBe("in_progress");

        await act(async () => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                10,
            );
        });
        expect(onRequestMove).toHaveBeenCalledWith(tasks[0], fallback[1], null);
    });

    test("exceeding a WIP limit warns", async () => {
        const { hook } = setup();

        press(hook, " ");
        press(hook, "ArrowRight");
        await act(async () => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                10,
            );
        });

        expect(hook.result.current.wipWarning).toContain("WIP limit");
    });
});

describe("boardColumns", () => {
    test("shows every workflow state except Cancelled", () => {
        const states = [
            ...columns,
            { id: 4, key: "cancelled", name: "Cancelled", category: "done" },
        ];
        expect(boardColumns(states).map((column) => column.key)).toEqual([
            "pending",
            "in_progress",
            "done",
        ]);
    });
});
