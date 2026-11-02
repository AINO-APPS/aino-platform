import { useCallback, useState } from "react";
import { bulkTaskAction } from "../../../api/tasks";
import { actionDecision, reasonCopy, writeError } from "../ticketCapabilities";

export type BulkAction = "move_to_sprint" | "status" | "assign" | "delete";

interface UseBulkSelectionArgs {
    tasks?: any[];
    onApplied?: (action: BulkAction, changed: number, results: BulkResult[]) => void;
    onError?: (message: string) => void;
}

/** One task's outcome, including what it was before the action. */
export interface BulkResult {
    id: number;
    ok: boolean;
    error?: string;
    /** Stable machine code for a skipped ticket. */
    code?: string;
    previous?: Record<string, unknown>;
    task?: any;
}

/** The tickets the server skipped, named for the error banner. */
export function describeSkipped(
    results: BulkResult[],
    tasks: Array<{ id: number | string; title?: string }>,
): string | null {
    const skipped = results.filter((result) => !result.ok);
    if (skipped.length === 0) return null;
    const titles = skipped.map((result) => {
        const task = tasks.find((candidate) => String(candidate.id) === String(result.id));
        return `${task?.title || `#${result.id}`}: ${result.code ? reasonCopy(result.code) : result.error || reasonCopy()}`;
    });
    return `${skipped.length} ticket(s) skipped: ${titles.join("; ")}`;
}

/**
 * Multi-select for the backlog.
 *
 * Selection survives reordering (it is keyed by id, not position) and clears
 * on navigation. A bulk action applies to exactly the selected set, and the
 * whole batch is one undo step.
 */
export function useBulkSelection({ tasks = [], onApplied, onError }: UseBulkSelectionArgs = {}) {
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
                const skipped: BulkResult[] = [];
                const ids = [...selected].filter((id) => {
                    const task = tasks.find((entry) => String(entry.id) === String(id));
                    const decision = action === "status"
                        ? task?.capabilities?.transitions?.find((target: any) => String(target.to) === String(value))
                        : actionDecision(task, action === "move_to_sprint" ? "placeInSprint" : action === "delete" ? "delete" : "edit");
                    if (decision?.allowed === true) return true;
                    skipped.push({ id: Number(id), ok: false, ...(decision?.reason ? { code: decision.reason } : {}) });
                    return false;
                });
                const res = ids.length ? await bulkTaskAction({
                    ids,
                    action,
                    value,
                }) : null;
                const changed = res?.data?.changed ?? 0;
                const results = [...(res?.data?.results ?? []), ...skipped];
                onApplied?.(action, changed, results);
                return { ...res?.data, changed, results };
            } catch (err) {
                onError?.(writeError(err, "Failed to apply bulk action"));
                return null;
            } finally {
                setApplying(false);
            }
        },
        [selected, tasks, onApplied, onError],
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
