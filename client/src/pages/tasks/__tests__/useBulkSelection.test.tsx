import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useBulkSelection } from "../hooks/useBulkSelection";

const bulkTaskAction = vi.fn();

vi.mock("../../../api/tasks", () => ({
    bulkTaskAction: (...args: unknown[]) => bulkTaskAction(...args),
}));

describe("useBulkSelection", () => {
    beforeEach(() => {
        bulkTaskAction.mockReset();
    });

    test("multi-select toggles individual items", () => {
        const { result } = renderHook(() => useBulkSelection());

        act(() => result.current.toggle(1));
        act(() => result.current.toggle(2));
        expect(result.current.count).toBe(2);
        expect(result.current.isSelected(1)).toBe(true);

        act(() => result.current.toggle(1));
        expect(result.current.count).toBe(1);
        expect(result.current.isSelected(1)).toBe(false);
    });

    test("the selection bar clears in one action", () => {
        const { result } = renderHook(() => useBulkSelection());

        act(() => result.current.selectAll([1, 2, 3]));
        expect(result.current.count).toBe(3);
        act(() => result.current.clear());
        expect(result.current.count).toBe(0);
    });

    test("the action applies to exactly the selected set", async () => {
        bulkTaskAction.mockResolvedValue({ data: { changed: 2 } });
        const { result } = renderHook(() => useBulkSelection());

        act(() => result.current.selectAll([4, 7]));
        await act(async () => {
            await result.current.apply("status", "done");
        });

        expect(bulkTaskAction).toHaveBeenCalledWith({
            ids: [4, 7],
            action: "status",
            value: "done",
        });
    });

    test("selection survives reordering because it is keyed by id", () => {
        const { result } = renderHook(() => useBulkSelection());

        act(() => result.current.selectAll([1, 2]));
        // Reordering changes positions, not ids.
        expect(result.current.isSelected(1)).toBe(true);
        expect(result.current.isSelected(2)).toBe(true);
    });

    test("a failed action reports the server message", async () => {
        bulkTaskAction.mockRejectedValue({ response: { data: { error: "No tasks selected" } } });
        const onError = vi.fn();
        const { result } = renderHook(() => useBulkSelection({ onError }));

        act(() => result.current.selectAll([1]));
        await act(async () => {
            await result.current.apply("delete", null);
        });

        expect(onError).toHaveBeenCalledWith("No tasks selected");
    });

    test("an empty selection does nothing", async () => {
        const { result } = renderHook(() => useBulkSelection());

        await act(async () => {
            await result.current.apply("delete", null);
        });

        expect(bulkTaskAction).not.toHaveBeenCalled();
    });

    test("one undo reverses the whole batch", async () => {
        bulkTaskAction.mockResolvedValue({
            data: {
                changed: 3,
                results: [
                    { id: 1, ok: true, previous: { assigned_to: 4 } },
                    { id: 2, ok: true, previous: { assigned_to: 4 } },
                    { id: 3, ok: true, previous: { assigned_to: 5 } },
                ],
            },
        });
        const onApplied = vi.fn();
        const { result } = renderHook(() => useBulkSelection({ onApplied }));

        act(() => result.current.selectAll([1, 2, 3]));
        await act(async () => {
            await result.current.apply("assign", 9);
        });

        // The prior value of every task travels with the result, which is what
        // lets the caller reverse the batch instead of merely refetching.
        await waitFor(() => expect(onApplied).toHaveBeenCalledWith("assign", 3, [
            { id: 1, ok: true, previous: { assigned_to: 4 } },
            { id: 2, ok: true, previous: { assigned_to: 4 } },
            { id: 3, ok: true, previous: { assigned_to: 5 } },
        ]));
    });
});
