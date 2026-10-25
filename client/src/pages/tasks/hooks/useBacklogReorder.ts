import { useCallback, useRef, useState } from "react";
import { rankTask } from "../../../api/tasks";

export interface RankedTask {
    id: number | string;
    rank?: string | null;
    [key: string]: unknown;
}

interface UseBacklogReorderArgs {
    tasks: RankedTask[];
    setTasks: (updater: (tasks: RankedTask[]) => RankedTask[]) => void;
    onError?: (message: string) => void;
    onAnnounce?: (message: string) => void;
}

/**
 * Manual backlog ordering.
 *
 * The client never invents a rank: it sends the intended neighbours and the
 * server returns the computed value. The optimistic move is rolled back if the
 * server rejects it, so two people dragging at once cannot corrupt the list.
 */
export function useBacklogReorder({
    tasks,
    setTasks,
    onError,
    onAnnounce,
}: UseBacklogReorderArgs) {
    const [draggingId, setDraggingId] = useState<number | string | null>(null);
    const [overId, setOverId] = useState<number | string | null>(null);
    const lastAnnouncement = useRef<string>("");

    const announce = useCallback(
        (message: string) => {
            if (message === lastAnnouncement.current) return;
            lastAnnouncement.current = message;
            onAnnounce?.(message);
        },
        [onAnnounce],
    );

    const move = useCallback(
        async (taskId: number | string, targetIndex: number) => {
            const currentIndex = tasks.findIndex((task) => task.id === taskId);
            if (currentIndex === -1) return;
            const clamped = Math.max(0, Math.min(tasks.length - 1, targetIndex));
            if (clamped === currentIndex) return;

            const reordered = [...tasks];
            const [moved] = reordered.splice(currentIndex, 1);
            reordered.splice(clamped, 0, moved);

            const before = reordered[clamped - 1]?.rank ?? null;
            const after = reordered[clamped + 1]?.rank ?? null;

            const previous = tasks;
            setTasks(() => reordered);
            announce(`Moved ${moved.title ?? "task"} to position ${clamped + 1} of ${reordered.length}`);

            try {
                const res = await rankTask(taskId, {
                    beforeId: reordered[clamped - 1]?.id ?? null,
                    afterId: reordered[clamped + 1]?.id ?? null,
                });
                const rank = res?.data?.rank;
                if (rank) {
                    setTasks((current) =>
                        current.map((task) => (task.id === taskId ? { ...task, rank } : task)),
                    );
                }
            } catch (err) {
                // Restore the exact prior order, including position.
                setTasks(() => previous);
                const message = (err as { response?: { data?: { error?: string } } })
                    ?.response?.data?.error;
                onError?.(message || "Failed to reorder task");
                announce("Reorder failed; the previous order was restored");
            }
        },
        [tasks, setTasks, onError, announce],
    );

    /** Keyboard: lift, move, drop. */
    const onKeyDown = useCallback(
        (event: React.KeyboardEvent, taskId: number | string) => {
            const index = tasks.findIndex((task) => task.id === taskId);
            if (index === -1) return;

            if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                if (draggingId === taskId) {
                    setDraggingId(null);
                    announce("Dropped");
                } else {
                    setDraggingId(taskId);
                    announce("Lifted. Use the arrow keys to move, space to drop, escape to cancel.");
                }
                return;
            }

            if (draggingId !== taskId) return;

            if (event.key === "Escape") {
                event.preventDefault();
                setDraggingId(null);
                announce("Reorder cancelled");
                return;
            }

            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                event.preventDefault();
                const delta = event.key === "ArrowUp" ? -1 : 1;
                void move(taskId, index + delta);
            }
        },
        [tasks, draggingId, move, announce],
    );

    /** Pointer/touch: drag a row onto another row. */
    const onDragStart = useCallback((taskId: number | string) => {
        setDraggingId(taskId);
    }, []);

    const onDragOver = useCallback((taskId: number | string) => {
        setOverId(taskId);
    }, []);

    const onDrop = useCallback(
        (taskId: number | string) => {
            if (draggingId === null || draggingId === taskId) {
                setDraggingId(null);
                setOverId(null);
                return;
            }
            const targetIndex = tasks.findIndex((task) => task.id === taskId);
            setDraggingId(null);
            setOverId(null);
            void move(draggingId, targetIndex);
        },
        [draggingId, tasks, move],
    );

    /**
     * Touch drag.
     *
     * HTML5 drag-and-drop does not fire on touch, so a long press lifts the row
     * and the row under the finger becomes the drop target. The row is found by
     * hit-testing the element under the touch point, which works regardless of
     * how the list is nested.
     */
    const touchStart = useRef<{ x: number; y: number } | null>(null);
    const longPress = useRef<ReturnType<typeof setTimeout> | null>(null);

    const onTouchStart = useCallback(
        (event: React.TouchEvent, taskId: number | string) => {
            const touch = event.touches[0];
            if (!touch) return;
            touchStart.current = { x: touch.clientX, y: touch.clientY };
            if (longPress.current) clearTimeout(longPress.current);
            longPress.current = setTimeout(() => setDraggingId(taskId), 250);
        },
        [],
    );

    const onTouchMove = useCallback(
        (event: React.TouchEvent) => {
            const origin = touchStart.current;
            const touch = event.touches[0];
            if (!origin || !touch) return;
            // A real drag cancels the long-press timer only once it has moved
            // far enough; a small wobble should still lift the row.
            const moved = Math.hypot(touch.clientX - origin.x, touch.clientY - origin.y);
            if (moved > 8 && longPress.current && draggingId === null) {
                clearTimeout(longPress.current);
                longPress.current = null;
            }
            if (draggingId === null) return;
            const element = document.elementFromPoint(touch.clientX, touch.clientY);
            const row = element?.closest<HTMLElement>("[data-task-id]");
            const overTaskId = row?.dataset.taskId;
            if (overTaskId) setOverId(overTaskId);
        },
        [draggingId],
    );

    const onTouchEnd = useCallback(() => {
        if (longPress.current) {
            clearTimeout(longPress.current);
            longPress.current = null;
        }
        touchStart.current = null;
        if (draggingId !== null && overId !== null) onDrop(overId);
        else {
            setDraggingId(null);
            setOverId(null);
        }
    }, [draggingId, overId, onDrop]);

    return {
        draggingId,
        overId,
        move,
        onKeyDown,
        onDragStart,
        onDragOver,
        onDrop,
        onTouchStart,
        onTouchMove,
        onTouchEnd,
        cancel: () => setDraggingId(null),
    };
}
