import React, { useCallback } from "react";

interface ToastApi {
    success: (message: React.ReactNode, duration?: number) => number;
}

/**
 * The undo affordance.
 *
 * Every destructive or moving action offers its inverse for ten seconds. The
 * button is a real focusable control, so undo is reachable and operable by
 * keyboard alone.
 */
export function useUndoToast(toast: ToastApi, undo: () => Promise<unknown> | unknown) {
    return useCallback(
        (label: string) => {
            toast.success(
                <span>
                    {label}{" "}
                    <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ marginLeft: 8 }}
                        onClick={() => {
                            void undo();
                        }}
                    >
                        Undo
                    </button>
                </span>,
                10_000,
            );
        },
        [toast, undo],
    );
}
