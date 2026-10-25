import { useCallback, useRef } from "react";

/** The minimum distance a horizontal swipe must travel to count. */
export const SWIPE_THRESHOLD_PX = 48;

export interface SwipeHandlers {
    onTouchStart: (event: React.TouchEvent) => void;
    onTouchEnd: (event: React.TouchEvent) => void;
}

/**
 * Horizontal swipe between adjacent items.
 *
 * Used by the single-column board so a phone can move between columns without a
 * horizontal scrollbar. A swipe shorter than the threshold is ignored, so a
 * vertical scroll or a tap never changes the column.
 */
export function useSwipe(
    onSwipeLeft: () => void,
    onSwipeRight: () => void,
    threshold = SWIPE_THRESHOLD_PX,
): SwipeHandlers {
    const start = useRef<{ x: number; y: number } | null>(null);

    const onTouchStart = useCallback((event: React.TouchEvent) => {
        const touch = event.touches[0];
        start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
    }, []);

    const onTouchEnd = useCallback(
        (event: React.TouchEvent) => {
            const origin = start.current;
            start.current = null;
            if (!origin) return;
            const touch = event.changedTouches[0];
            if (!touch) return;

            const dx = touch.clientX - origin.x;
            const dy = touch.clientY - origin.y;
            // A mostly-vertical gesture is a scroll, not a swipe.
            if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return;
            if (dx < 0) onSwipeLeft();
            else onSwipeRight();
        },
        [onSwipeLeft, onSwipeRight, threshold],
    );

    return { onTouchStart, onTouchEnd };
}
