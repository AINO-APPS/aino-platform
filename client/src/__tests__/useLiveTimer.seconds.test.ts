import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveTimer, statusSeconds } from "../hooks/useLiveTimer";

type Status = Parameters<typeof useLiveTimer>[0];

function setup(initial: Status) {
    return renderHook(({ status }: { status: Status }) => useLiveTimer(status), {
        initialProps: { status: initial },
    });
}

describe("useLiveTimer seconds anchoring", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-21T10:00:00Z"));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("anchors on floorSeconds instead of snapping to whole minutes", () => {
        const { result } = setup({ state: "on_floor", floorMinutes: 61, floorSeconds: 3700, breakMinutes: 0, breakSeconds: 0 });
        expect(result.current.liveFloorSec).toBe(3700);
        act(() => { vi.advanceTimersByTime(5000); });
        expect(result.current.liveFloorSec).toBe(3705);
    });

    it("keeps the live seconds when a refresh lands within the latency tolerance", () => {
        const { result, rerender } = setup({ state: "on_floor", floorMinutes: 61, floorSeconds: 3700 });
        act(() => { vi.advanceTimersByTime(10_000); });
        expect(result.current.liveFloorSec).toBe(3710);
        // Server value computed slightly before the client tick: 1s behind.
        rerender({ status: { state: "on_floor", floorMinutes: 61, floorSeconds: 3709 } });
        expect(result.current.liveFloorSec).toBe(3710);
        act(() => { vi.advanceTimersByTime(1000); });
        expect(result.current.liveFloorSec).toBe(3711);
        // 2s ahead is also absorbed.
        rerender({ status: { state: "on_floor", floorMinutes: 61, floorSeconds: 3713 } });
        expect(result.current.liveFloorSec).toBe(3711);
    });

    it("re-anchors when the refreshed seconds drift beyond the tolerance", () => {
        const { result, rerender } = setup({ state: "on_floor", floorMinutes: 61, floorSeconds: 3700 });
        act(() => { vi.advanceTimersByTime(3000); });
        rerender({ status: { state: "on_floor", floorMinutes: 63, floorSeconds: 3800 } });
        expect(result.current.liveFloorSec).toBe(3800);
        act(() => { vi.advanceTimersByTime(2000); });
        expect(result.current.liveFloorSec).toBe(3802);
    });

    it("never snaps back to :00 on a refresh (old minute-only behaviour)", () => {
        const { result, rerender } = setup({ state: "on_floor", floorMinutes: 61, floorSeconds: 3685 });
        act(() => { vi.advanceTimersByTime(30_000); });
        rerender({ status: { state: "on_floor", floorMinutes: 61, floorSeconds: 3715 } });
        expect(result.current.liveFloorSec % 60).not.toBe(0);
        expect(result.current.liveFloorSec).toBe(3715);
    });

    it("tracks break seconds while on break and anchors exactly on state change", () => {
        const { result, rerender } = setup({ state: "on_floor", floorMinutes: 10, floorSeconds: 630, breakMinutes: 0, breakSeconds: 0 });
        rerender({ status: { state: "on_break", floorMinutes: 10, floorSeconds: 631, breakMinutes: 0, breakSeconds: 1 } });
        expect(result.current.liveFloorSec).toBe(631);
        expect(result.current.liveBreakSec).toBe(1);
        act(() => { vi.advanceTimersByTime(4000); });
        expect(result.current.liveBreakSec).toBe(5);
        expect(result.current.liveFloorSec).toBe(631);
    });

    it("falls back to minutes * 60 when floorSeconds/breakSeconds are missing", () => {
        const { result } = setup({ state: "on_floor", floorMinutes: 5, breakMinutes: 2 });
        expect(result.current.liveFloorSec).toBe(300);
        expect(result.current.liveBreakSec).toBe(120);
        act(() => { vi.advanceTimersByTime(3000); });
        expect(result.current.liveFloorSec).toBe(303);
    });
});

describe("statusSeconds", () => {
    it("prefers exact seconds and falls back to minutes", () => {
        expect(statusSeconds({ floorMinutes: 1, floorSeconds: 75 }, "floor")).toBe(75);
        expect(statusSeconds({ breakMinutes: 2, breakSeconds: 0 }, "break")).toBe(0);
        expect(statusSeconds({ floorMinutes: 3 }, "floor")).toBe(180);
        expect(statusSeconds(null, "break")).toBe(0);
    });
});
