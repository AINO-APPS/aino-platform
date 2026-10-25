import { useCallback, useState } from "react";
import { bulkTaskAction } from "../../../api/tasks";

export type BulkAction = "move_to_sprint" | "status" | "assign" | "delete";

interface UseBulkSelectionArgs {
    onApplied?: (action: BulkAction, changed: number, results: BulkResult[]) => void;
    onError?: (message: string) => void;
}

/** One task's outcome, including what it was before the action. */
export interface BulkResult {
    id: number;
    ok: boolean;
    error?: string;
    previous?: Record<string, unknown>;
}

/**
 * Multi-select for the backlog.
 *
 * Selection survives reordering (it is keyed by id, not position) and clears
 * on navigation. A bulk action applies to exactly the selected set, and the
 * whole batch is one undo step.
 */
export function useBulkSelection({ onApplied, onError }: UseBulkSelectionArgs = {}) {
    const [selected, setSelected] = useState<Set<number | string>>(new Set());
    const [applying, setApplying] = useState(false);

    const toggle = useCallback((id: number | string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const selectAll = useCallback((ids: Array<number | string>) => {
        setSelected(new Set(ids));
    }, []);

    const clear = useCallback(() => setSelected(new Set()), []);

    const isSelected = useCallback((id: number | string) => selected.has(id), [selected]);

    const apply = useCallback(
        async (action: BulkAction, value: unknown) => {
            if (selected.size === 0) return null;
            setApplying(true);
            try {
                const res = await bulkTaskAction({
                    ids: [...selected],
                    action,
                    value,
                });
                const changed = res?.data?.changed ?? 0;
                onApplied?.(action, changed, res?.data?.results ?? []);
                return res?.data ?? null;
            } catch (err) {
                const message = (err as { response?: { data?: { error?: string } } })
                    ?.response?.data?.error;
                onError?.(message || "Failed to apply bulk action");
                return null;
            } finally {
                setApplying(false);
            }
        },
        [selected, onApplied, onError],
    );

    return {
        selected,
        selectedIds: [...selected],
        count: selected.size,
        applying,
        toggle,
        selectAll,
        clear,
        isSelected,
        apply,
    };
}
