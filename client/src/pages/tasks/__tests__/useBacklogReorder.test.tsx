import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBacklogReorder } from "../hooks/useBacklogReorder";

const rankTask = vi.fn();

vi.mock("../../../api/tasks", () => ({
    rankTask: (...args: unknown[]) => rankTask(...args),
}));

const initial = [
    { id: 1, title: "First", rank: "0|8:" },
    { id: 2, title: "Second", rank: "0|g:" },
    { id: 3, title: "Third", rank: "0|p:" },
];

function setup() {
    let tasks = [...initial];
    const setTasks = vi.fn((updater: any) => {
        tasks = typeof updater === "function" ? updater(tasks) : updater;
    });
    const onError = vi.fn();
    const onAnnounce = vi.fn();
    const hook = renderHook(() =>
        useBacklogReorder({ tasks, setTasks, onError, onAnnounce }),
    );
    return { hook, setTasks, onError, onAnnounce, getTasks: () => tasks };
}

describe("useBacklogReorder", () => {
    beforeEach(() => {
        rankTask.mockReset();
    });

    test("sends the intended neighbours and applies the returned rank", async () => {
        rankTask.mockResolvedValue({ data: { rank: "0|a:" } });
        const { hook, getTasks } = setup();

        await act(async () => {
            await hook.result.current.move(3, 0);
        });

        expect(rankTask).toHaveBeenCalledWith(3, { beforeId: null, afterId: 1 });
        await waitFor(() => expect(getTasks()[0].id).toBe(3));
        expect(getTasks()[0].rank).toBe("0|a:");
    });

    test("the client never invents a rank", async () => {
        rankTask.mockResolvedValue({ data: { rank: "0|a:" } });
        const { hook } = setup();

        await act(async () => {
            await hook.result.current.move(1, 2);
        });

        const [, neighbours] = rankTask.mock.calls[0];
        expect(Object.keys(neighbours).sort()).toEqual(["afterId", "beforeId"]);
    });

    test("a rejected move restores the exact prior order", async () => {
        rankTask.mockRejectedValue({ response: { data: { error: "Ranks are out of order" } } });
        const { hook, getTasks, onError } = setup();

        await act(async () => {
            await hook.result.current.move(3, 0);
        });

        expect(getTasks().map((task) => task.id)).toEqual([1, 2, 3]);
        expect(onError).toHaveBeenCalledWith("Ranks are out of order");
    });

    test("keyboard lift, move and drop reorders and announces", async () => {
        rankTask.mockResolvedValue({ data: { rank: "0|a:" } });
        const { hook, onAnnounce } = setup();

        act(() => {
            hook.result.current.onKeyDown(
                { key: " ", preventDefault: vi.fn() } as any,
                1,
            );
        });
        expect(hook.result.current.draggingId).toBe(1);

        await act(async () => {
            hook.result.current.onKeyDown(
                { key: "ArrowDown", preventDefault: vi.fn() } as any,
                1,
            );
        });

        expect(rankTask).toHaveBeenCalled();
        expect(onAnnounce).toHaveBeenCalledWith(expect.stringContaining("position 2"));
    });

    test("escape cancels a keyboard lift without moving", async () => {
        const { hook } = setup();

        act(() => {
            hook.result.current.onKeyDown({ key: " ", preventDefault: vi.fn() } as any, 2);
        });
        act(() => {
            hook.result.current.onKeyDown({ key: "Escape", preventDefault: vi.fn() } as any, 2);
        });

        expect(hook.result.current.draggingId).toBeNull();
        expect(rankTask).not.toHaveBeenCalled();
    });

    test("touch drag onto another row moves the task", async () => {
        rankTask.mockResolvedValue({ data: { rank: "0|a:" } });
        const { hook, getTasks } = setup();

        act(() => {
            hook.result.current.onDragStart(1);
        });
        act(() => {
            hook.result.current.onDragOver(3);
        });
        await act(async () => {
            hook.result.current.onDrop(3);
        });

        await waitFor(() => expect(getTasks()[2].id).toBe(1));
    });
});
