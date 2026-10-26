import React from "react";
import ConfirmDialog from "../../components/common/ConfirmDialog";

interface TasksConfirmDialogsProps {
    /** The ticket awaiting a cancel confirmation, or null. */
    taskToCancel: any;
    onConfirmCancel: () => void;
    onDismissCancel: () => void;
    /** The shared confirm dialog driven by `useConfirmDialog`. */
    confirmDialog: {
        open: boolean;
        title: string;
        message: string;
        confirmText: string;
        isDanger: boolean;
        onConfirm: (() => void) | null;
    };
    onCloseConfirm: () => void;
}

/**
 * The Tasks page's confirmation dialogs.
 *
 * Cancelling a ticket is the only destructive action here, and it is worded as
 * a cancel rather than a delete because the ticket and its history survive.
 */
export default function TasksConfirmDialogs({
    taskToCancel,
    onConfirmCancel,
    onDismissCancel,
    confirmDialog,
    onCloseConfirm,
}: TasksConfirmDialogsProps) {
    return (
        <>
            <ConfirmDialog
                isOpen={!!taskToCancel}
                title="Cancel ticket"
                message={`Cancel "${taskToCancel?.title}"? The ticket and its history are kept, and it leaves the open work. You can move it back to an open state later.`}
                confirmText="Cancel ticket"
                isDanger
                onConfirm={onConfirmCancel}
                onCancel={onDismissCancel}
            />

            <ConfirmDialog
                isOpen={confirmDialog.open}
                title={confirmDialog.title}
                message={confirmDialog.message}
                confirmText={confirmDialog.confirmText}
                isDanger={confirmDialog.isDanger}
                onConfirm={() => {
                    if (confirmDialog.onConfirm) confirmDialog.onConfirm();
                }}
                onCancel={onCloseConfirm}
            />
        </>
    );
}
