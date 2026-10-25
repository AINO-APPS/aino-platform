import { useEffect, useState } from "react";

/** The narrowest viewport the Tasks area supports. */
export const MIN_SUPPORTED_WIDTH = 360;

/** Below this width the board is a single column and detail is a bottom sheet. */
export const PHONE_MAX_WIDTH = 640;

/** Below this width the calendar drops to a scrollable day column. */
export const TABLET_MAX_WIDTH = 900;

function readWidth(): number {
    if (typeof window === "undefined") return 1024;
    return window.innerWidth || MIN_SUPPORTED_WIDTH;
}

/**
 * The current viewport width, kept in sync with resizes.
 *
 * Layout decisions that cannot be expressed in CSS alone (which calendar mode
 * to render, whether the board is swipeable) read this instead of duplicating
 * media-query numbers.
 */
export function useViewportWidth(): number {
    const [width, setWidth] = useState(readWidth);

    useEffect(() => {
        const onResize = () => setWidth(readWidth());
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);

    return width;
}

/** True on a phone-sized viewport, where detail is a bottom sheet. */
export function useIsPhone(): boolean {
    return useViewportWidth() <= PHONE_MAX_WIDTH;
}

/** True on a tablet-or-narrower viewport, where the calendar is a day column. */
export function useIsNarrowCalendar(): boolean {
    return useViewportWidth() <= TABLET_MAX_WIDTH;
}
