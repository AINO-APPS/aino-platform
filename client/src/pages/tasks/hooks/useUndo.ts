import { useCallback, useRef } from "react";

export interface UndoAction {
    /** Human label, e.g. "Moved to sprint". */
    label: string;
    /** Restore the exact prior state, including position. */
    undo: () => Promise<void> | void;
}

const UNDO_WINDOW_MS = 10_000;

/**
 * A single-slot undo buffer.
 *
 * Every destructive or moving action registers its inverse here; the toast
 * offers it for ten seconds. A newer action replaces the older one, so undo
 * always reverses the most recent change.
 */
export function useUndo() {
    const pending = useRef<UndoAction | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clear = useCallback(() => {
        pending.current = null;
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
    }, []);

    const register = useCallback(
        (action: UndoAction) => {
            clear();
            pending.current = action;
            timer.current = setTimeout(clear, UNDO_WINDOW_MS);
        },
        [clear],
    );

    const undo = useCallback(async () => {
        const action = pending.current;
        clear();
        if (action) await action.undo();
        return action?.label ?? null;
    }, [clear]);

    const canUndo = useCallback(() => pending.current !== null, []);

    return { register, undo, clear, canUndo };
}
