import type { ShowConfirm } from "./useConfirmDialog";
import type { BoardColumn, BoardTask } from "./boardTargets";

interface StageStatusMoveArgs {
    /** The column the ticket is being dropped into. */
    column: BoardColumn;
    /** An advisory to show alongside the question (blocker, criteria). */
    notice?: string | null;
    showConfirm: ShowConfirm;
    closeConfirm: () => void;
    onConfirm: () => void;
    onCancel?: () => void;
}

/**
 * Ask before a status change, with one wording for pointer and keyboard.
 *
 * Staging lives here so every caller asks with the same wording. A pointer drop
 * may show the card in its new column first (Jira behaviour) and roll it back
 * on Cancel; a keyboard move changes nothing until the user accepts.
 * the dialog names the ticket and the target state, and `onConfirm` only runs
 * after the user accepts.
 */
export function stageStatusMove(
    task: BoardTask,
    {
        column,
        notice,
        showConfirm,
        closeConfirm,
        onConfirm,
        onCancel,
    }: StageStatusMoveArgs,
) {
    const label = column.name ?? column.key ?? column.id ?? "column";
    const prefix = notice ? `${notice} ` : "";
    showConfirm(
        "Change Status",
        `${prefix}Move "${task.title ?? "this ticket"}" to ${label}?`,
        () => {
            closeConfirm();
            onConfirm();
        },
        { confirmText: "Move", onCancel },
    );
}
