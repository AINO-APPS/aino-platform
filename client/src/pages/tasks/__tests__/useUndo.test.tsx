import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndo } from "../hooks/useUndo";

describe("useUndo", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    test("undo restores the exact prior state", async () => {
        const restore = vi.fn();
        const { result } = renderHook(() => useUndo());

        act(() => {
            result.current.register({ label: "Moved to sprint", undo: restore });
        });
        await act(async () => {
            await result.current.undo();
        });

        expect(restore).toHaveBeenCalledTimes(1);
    });

    test("the affordance expires after ten seconds", async () => {
        const restore = vi.fn();
        const { result } = renderHook(() => useUndo());

        act(() => {
            result.current.register({ label: "Deleted", undo: restore });
        });
        act(() => {
            vi.advanceTimersByTime(10_001);
        });

        expect(result.current.canUndo()).toBe(false);
        await act(async () => {
            await result.current.undo();
        });
        expect(restore).not.toHaveBeenCalled();
    });

    test("a newer action replaces the older one", async () => {
        const first = vi.fn();
        const second = vi.fn();
        const { result } = renderHook(() => useUndo());

        act(() => {
            result.current.register({ label: "First", undo: first });
        });
        act(() => {
            result.current.register({ label: "Second", undo: second });
        });
        await act(async () => {
            await result.current.undo();
        });

        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
    });

    test("undo is single-use", async () => {
        const restore = vi.fn();
        const { result } = renderHook(() => useUndo());

        act(() => {
            result.current.register({ label: "Once", undo: restore });
        });
        await act(async () => {
            await result.current.undo();
        });
        await act(async () => {
            await result.current.undo();
        });

        expect(restore).toHaveBeenCalledTimes(1);
    });
});
