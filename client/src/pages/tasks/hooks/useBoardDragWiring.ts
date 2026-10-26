import { useState } from "react";
import { useBoardDrag, type BoardColumn, type MoveOutcome } from "./useBoardDrag";
import type { TargetPolicy } from "./boardTargets";
import type { ShowConfirm } from "./useConfirmDialog";
import { stageStatusMove } from "./stageStatusMove";

interface UseBoardDragWiringArgs {
    tasks: any[];
    columns: any[];
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
    /** Commit an accepted move. Returns false when the server refused it. */
    onMove: (task: any, column: BoardColumn) => Promise<boolean> | boolean;
    targetPolicy?: TargetPolicy;
}

/**
 * Wire keyboard board navigation to the Tasks page.
 *
 * Kept out of the page so the page stays within the file-size ratchet. Every
 * keyboard move is staged behind the one confirmation dialog; dismissing it
 * resolves the staged move as cancelled, so a later confirm cannot fire.
 */
export function useBoardDragWiring({
    tasks,
    columns,
    showConfirm,
    closeConfirm,
    onMove,
    targetPolicy,
}: UseBoardDragWiringArgs) {
    const [announcement, setAnnouncement] = useState("");

    const boardDrag = useBoardDrag({
        tasks,
        columns,
        targetPolicy,
        onAnnounce: setAnnouncement,
        onRequestMove: (task, column, notice) =>
            new Promise<MoveOutcome>((resolve) => {
                stageStatusMove(task, {
                    column,
                    notice,
                    showConfirm,
                    closeConfirm,
                    onConfirm: () => {
                        Promise.resolve(onMove(task, column)).then(
                            (moved) => resolve(moved === false ? "failed" : "accepted"),
                            () => resolve("failed"),
                        );
                    },
                    onCancel: () => resolve("cancelled"),
                });
            }),
    });

    return { boardDrag, announcement };
}
