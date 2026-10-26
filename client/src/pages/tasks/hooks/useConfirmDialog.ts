import { useState } from "react";

export interface ConfirmDialogOptions {
    confirmText?: string;
    isDanger?: boolean;
    /** Runs when the dialog is dismissed without confirming. */
    onCancel?: (() => void) | null;
}

/** The page's confirmation entry point, as passed to feature hooks. */
export type ShowConfirm = (
    title: string,
    message: string,
    onConfirm: () => void,
    opts?: ConfirmDialogOptions,
) => void;

export interface ConfirmDialogState {
    open: boolean;
    title: string;
    message: string;
    confirmText: string;
    isDanger: boolean;
    onConfirm: (() => void) | null;
    onCancel: (() => void) | null;
}

export function useConfirmDialog() {
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
        open: false,
        title: "",
        message: "",
        confirmText: "Confirm",
        isDanger: false,
        onConfirm: null,
        onCancel: null,
    });

    const showConfirm = (
        title: string,
        message: string,
        onConfirm: () => void,
        {
            confirmText = "Confirm",
            isDanger = false,
            onCancel = null,
        }: ConfirmDialogOptions = {},
    ) => {
        setConfirmDialog({
            open: true,
            title,
            message,
            confirmText,
            isDanger,
            onConfirm,
            onCancel,
        });
    };

    /**
     * Close because the action is being confirmed. The confirm handler calls
     * this itself so it can never be mistaken for a dismissal.
     */
    const closeConfirm = () =>
        setConfirmDialog((prev) => ({
            ...prev,
            open: false,
            onConfirm: null,
            onCancel: null,
        }));

    /** Dismiss the dialog: close it and run its cancel hook exactly once. */
    const cancelConfirm = () => {
        const pending = confirmDialog.onCancel;
        closeConfirm();
        pending?.();
    };

    return { confirmDialog, showConfirm, closeConfirm, cancelConfirm };
}
