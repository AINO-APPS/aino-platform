import { useCallback, useEffect, useRef } from "react";
import { NEAR_BOTTOM_PX } from "./chatUtils";

interface ScrollPinOptions {
    /** Scrollable message list element. */
    containerRef: React.RefObject<HTMLDivElement | null>;
    /** Active conversation id — a change re-sticks to the bottom. */
    conversationId: string | number | null | undefined;
    /** True while the thread's history request is still in flight. */
    loading: boolean;
    /** True when the thread currently has no rows. */
    isEmpty: boolean;
}

interface ScrollPin {
    /**
     * True while the view should follow the newest message. Updated ONLY from
     * user scrolls, so it always reflects the state BEFORE content changed: a
     * tall new row can't make a stuck view look "scrolled up".
     */
    stuckToBottomRef: React.MutableRefObject<boolean>;
    /** Re-stick and jump (instantly) to the newest message. */
    scrollToBottom: () => void;
}

type ScrollMetrics = Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">;

export function isNearBottom(el: ScrollMetrics): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

/** A new newest message follows when it's our own, or the view was stuck before it arrived. */
export function shouldFollowNewMessage({ isOwn, wasStuck }: { isOwn: boolean; wasStuck: boolean }): boolean {
    return isOwn || wasStuck;
}

/**
 * Signal-style stick-to-bottom for the message list.
 *
 * While the user is at the newest message the thread stays glued there for
 * the life of the conversation: every growth of the scroll content (new rows,
 * the typing row, images / link previews decoding late) instantly re-pins
 * `scrollTop` to the bottom. Scrolling up to read history unsticks it, so
 * nothing yanks the view (including the load-older scroll restore); scrolling
 * back to the bottom, or sending a message, re-sticks it.
 */
export default function useScrollPin({
    containerRef,
    conversationId,
    loading,
    isEmpty,
}: ScrollPinOptions): ScrollPin {
    const stuckToBottomRef = useRef(true);
    // True while we are writing scrollTop, so the scroll listener can tell our
    // own jumps apart from a real user scroll.
    const programmaticScrollRef = useRef(false);

    const pinNow = useCallback(() => {
        const el = containerRef.current;
        if (!el) return;
        programmaticScrollRef.current = true;
        el.scrollTop = el.scrollHeight;
        // Released on the next frame: the `scroll` event this write queues is
        // delivered asynchronously.
        requestAnimationFrame(() => {
            programmaticScrollRef.current = false;
        });
    }, [containerRef]);

    const scrollToBottom = useCallback(() => {
        stuckToBottomRef.current = true;
        pinNow();
    }, [pinNow]);

    useEffect(() => {
        stuckToBottomRef.current = true;
    }, [conversationId]);

    useEffect(() => {
        const container = containerRef.current;
        if (!conversationId || loading || !container) return;
        // `isEmpty` is a dependency (not a bail-out) so the pin restarts as
        // soon as the first rows of an initially empty thread land.

        const pinIfStuck = () => {
            if (stuckToBottomRef.current) pinNow();
        };

        // First paint of the real rows, then once more for late-settling rows.
        const raf = requestAnimationFrame(() => {
            pinIfStuck();
            requestAnimationFrame(pinIfStuck);
        });

        // The container's own box never changes when content grows (it is a
        // fixed-height flex child), so observe the CONTENT rows as well; the
        // container is observed for window / composer resizes.
        const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(pinIfStuck) : null;
        const observeAll = (nodes: Iterable<Node>) => {
            for (const node of nodes) if (node instanceof Element) resize?.observe(node);
        };
        resize?.observe(container);
        observeAll(Array.from(container.children));
        // New rows (messages, the typing indicator) are new children: observe
        // them too, and re-pin on any add/remove.
        const mutations = typeof MutationObserver !== "undefined"
            ? new MutationObserver((records) => {
                for (const record of records) observeAll(Array.from(record.addedNodes));
                pinIfStuck();
            })
            : null;
        mutations?.observe(container, { childList: true });

        // `load` does not bubble, so it must be captured: attachments, avatars
        // and link-preview thumbnails finishing late (desktop proxies them).
        container.addEventListener("load", pinIfStuck, true);
        container.addEventListener("error", pinIfStuck, true);

        // A plain `scroll` listener covers wheel, touch, keyboard, scrollbar
        // drags and momentum alike.
        const onUserScroll = () => {
            if (programmaticScrollRef.current) return;
            const el = containerRef.current;
            if (el) stuckToBottomRef.current = isNearBottom(el);
        };
        container.addEventListener("scroll", onUserScroll, { passive: true });

        return () => {
            cancelAnimationFrame(raf);
            resize?.disconnect();
            mutations?.disconnect();
            container.removeEventListener("load", pinIfStuck, true);
            container.removeEventListener("error", pinIfStuck, true);
            container.removeEventListener("scroll", onUserScroll);
        };
    }, [containerRef, conversationId, loading, isEmpty, pinNow]);

    return { stuckToBottomRef, scrollToBottom };
}
