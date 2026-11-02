import { useCallback, useRef, useState } from "react";
import {
    columnOf,
    columnRef,
    doneAdvisory,
    findColumn,
    sameColumn,
    type BoardColumn,
    type BoardTask,
} from "../boardTypes";
import { boardTargetDecision, reasonCopy } from "../ticketCapabilities";

export type { BoardColumn, BoardTask } from "../boardTypes";

/** What happened to a staged move once the confirmation closed. */
export type MoveOutcome = "accepted" | "cancelled" | "failed";

interface UseBoardDragArgs {
    tasks: BoardTask[];
    columns: BoardColumn[];
    /**
     * Stage a move behind the confirmation dialog. It must not mutate the
     * ticket or call the API itself; it resolves once the user has answered.
     * `notice` is an advisory (blocker or unchecked criteria) to include.
     */
    onRequestMove: (
        task: BoardTask,
        column: BoardColumn,
        notice: string | null,
    ) => Promise<MoveOutcome> | MoveOutcome;
    onAnnounce?: (message: string) => void;
}

/**
 * Keyboard navigation for the board.
 *
 * Space lifts a card, the arrow keys choose a column, and space drops it. The
 * drop is staged through `onRequestMove`, so nothing changes until the user
 * confirms. Pointer drag lives in `useDragDrop`; this hook never handles it.
 */
export function useBoardDrag({
    tasks,
    columns,
    onRequestMove,
    onAnnounce,
}: UseBoardDragArgs) {
    const [draggingId, setDraggingId] = useState<number | string | null>(null);
    const [overColumn, setOverColumn] = useState<string | number | null>(null);
    const lastAnnouncement = useRef("");

    const announce = useCallback(
        (message: string) => {
            if (message === lastAnnouncement.current) return;
            lastAnnouncement.current = message;
            onAnnounce?.(message);
        },
        [onAnnounce],
    );

    const reset = useCallback(() => {
        setDraggingId(null);
        setOverColumn(null);
    }, []);

    const move = useCallback(
        async (taskId: number | string, column: BoardColumn) => {
            const task = tasks.find((candidate) => candidate.id === taskId);
            if (!task) return;

            const decision = boardTargetDecision(task, column);
            if (!decision.allowed) {
                announce(
                    `${column.name ?? "That column"} cannot take this ticket: ${reasonCopy(decision.reason)}`,
                );
                return;
            }

            const outcome = await onRequestMove(
                task,
                column,
                doneAdvisory(task, column),
            );
            if (outcome === "accepted") {
                announce(
                    `Moved ${task.title ?? "ticket"} to ${column.name ?? "column"}`,
                );
            } else if (outcome === "cancelled") {
                announce("Move cancelled");
            }
        },
        [tasks, onRequestMove, announce],
    );

    /** Space lifts, arrows choose a column, space drops. Escape cancels. */
    const onKeyDown = useCallback(
        (event: React.KeyboardEvent, taskId: number | string) => {
            const task = tasks.find((candidate) => candidate.id === taskId);
            if (!task) return;
            const current = columnOf(task, columns);
            const currentIndex = columns.findIndex((column) =>
                sameColumn(current, column),
            );

            if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                if (draggingId !== taskId) {
                    setDraggingId(taskId);
                    setOverColumn(null);
                    announce(
                        "Lifted. Use the arrow keys to choose a column, space to drop, escape to cancel.",
                    );
                    return;
                }

                const target = findColumn(columns, overColumn);
                reset();
                if (!target || sameColumn(current, target)) {
                    announce(`Dropped in ${current?.name ?? "its column"}`);
                    return;
                }
                void move(taskId, target);
                return;
            }

            if (draggingId !== taskId) return;

            if (event.key === "Escape") {
                event.preventDefault();
                reset();
                announce("Move cancelled");
                return;
            }

            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                const delta = event.key === "ArrowLeft" ? -1 : 1;
                const selected = findColumn(columns, overColumn);
                const fromIndex = selected
                    ? columns.indexOf(selected)
                    : currentIndex;
                // Skip server-denied targets so keyboard navigation stays usable.
                let index = fromIndex + delta;
                const rejected: string[] = [];
                while (index >= 0 && index < columns.length) {
                    const candidate = columns[index];
                    const decision = boardTargetDecision(task, candidate);
                    if (decision.allowed) {
                        setOverColumn(columnRef(candidate));
                        announce(
                            `${rejected.join(" ")} ${candidate.name ?? "Column"} selected. Press space to drop.`.trim(),
                        );
                        return;
                    }
                    rejected.push(
                        `${candidate.name ?? "That column"} cannot take this ticket: ${reasonCopy(decision.reason)}`,
                    );
                    index += delta;
                }
                announce(
                    rejected.join(" ") || "No column in that direction",
                );
            }
        },
        [
            tasks,
            columns,
            draggingId,
            overColumn,
            move,
            reset,
            announce,
        ],
    );

    return {
        draggingId,
        overColumn,
        onKeyDown,
        reset,
    };
}
