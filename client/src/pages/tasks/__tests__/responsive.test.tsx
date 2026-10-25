import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import { useSwipe, SWIPE_THRESHOLD_PX } from "../hooks/useSwipe";
import {
    MIN_SUPPORTED_WIDTH,
    PHONE_MAX_WIDTH,
    TABLET_MAX_WIDTH,
    useIsNarrowCalendar,
    useIsPhone,
    useViewportWidth,
} from "../../../hooks/useViewportWidth";

function setWidth(width: number) {
    Object.defineProperty(window, "innerWidth", {
        writable: true,
        configurable: true,
        value: width,
    });
    act(() => {
        window.dispatchEvent(new Event("resize"));
    });
}

describe("useViewportWidth", () => {
    const original = window.innerWidth;

    afterEach(() => {
        setWidth(original);
    });

    test("reports the current width and follows resizes", () => {
        setWidth(1024);
        const { result } = renderHook(() => useViewportWidth());
        expect(result.current).toBe(1024);
        setWidth(360);
        expect(result.current).toBe(360);
    });

    test("a phone viewport is at or below the phone breakpoint", () => {
        setWidth(PHONE_MAX_WIDTH);
        expect(renderHook(() => useIsPhone()).result.current).toBe(true);
        setWidth(PHONE_MAX_WIDTH + 1);
        expect(renderHook(() => useIsPhone()).result.current).toBe(false);
    });

    test("the calendar narrows before the board does", () => {
        setWidth(TABLET_MAX_WIDTH);
        expect(renderHook(() => useIsNarrowCalendar()).result.current).toBe(true);
        setWidth(TABLET_MAX_WIDTH + 1);
        expect(renderHook(() => useIsNarrowCalendar()).result.current).toBe(false);
    });

    test("the supported floor is 360px", () => {
        expect(MIN_SUPPORTED_WIDTH).toBe(360);
    });
});

describe("useSwipe", () => {
    function touch(clientX: number, clientY = 0) {
        return { clientX, clientY } as Touch;
    }

    test("a left swipe calls the left handler", () => {
        const onLeft = vi.fn();
        const onRight = vi.fn();
        const { result } = renderHook(() => useSwipe(onLeft, onRight));

        act(() => {
            result.current.onTouchStart({
                touches: [touch(300)],
            } as unknown as React.TouchEvent);
            result.current.onTouchEnd({
                changedTouches: [touch(300 - SWIPE_THRESHOLD_PX - 10)],
            } as unknown as React.TouchEvent);
        });

        expect(onLeft).toHaveBeenCalled();
        expect(onRight).not.toHaveBeenCalled();
    });

    test("a right swipe calls the right handler", () => {
        const onLeft = vi.fn();
        const onRight = vi.fn();
        const { result } = renderHook(() => useSwipe(onLeft, onRight));

        act(() => {
            result.current.onTouchStart({
                touches: [touch(100)],
            } as unknown as React.TouchEvent);
            result.current.onTouchEnd({
                changedTouches: [touch(100 + SWIPE_THRESHOLD_PX + 10)],
            } as unknown as React.TouchEvent);
        });

        expect(onRight).toHaveBeenCalled();
        expect(onLeft).not.toHaveBeenCalled();
    });

    test("a short movement is not a swipe", () => {
        const onLeft = vi.fn();
        const onRight = vi.fn();
        const { result } = renderHook(() => useSwipe(onLeft, onRight));

        act(() => {
            result.current.onTouchStart({
                touches: [touch(200)],
            } as unknown as React.TouchEvent);
            result.current.onTouchEnd({
                changedTouches: [touch(210)],
            } as unknown as React.TouchEvent);
        });

        expect(onLeft).not.toHaveBeenCalled();
        expect(onRight).not.toHaveBeenCalled();
    });

    test("a mostly-vertical gesture is a scroll, not a swipe", () => {
        const onLeft = vi.fn();
        const onRight = vi.fn();
        const { result } = renderHook(() => useSwipe(onLeft, onRight));

        act(() => {
            result.current.onTouchStart({
                touches: [touch(200, 100)],
            } as unknown as React.TouchEvent);
            result.current.onTouchEnd({
                changedTouches: [touch(200 - SWIPE_THRESHOLD_PX - 10, 400)],
            } as unknown as React.TouchEvent);
        });

        expect(onLeft).not.toHaveBeenCalled();
    });
});
