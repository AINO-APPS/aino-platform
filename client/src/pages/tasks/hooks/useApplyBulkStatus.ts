/**
 * Bulk status changes render each selected ticket's server decision.
 *
 * Before the request the page names the tickets that cannot move, so the
 * confirmation is honest about what applying will do. The server stays the
 * authority: its per-ticket results are repeated afterwards by
 * `describeSkipped` in `useBulkSelection.ts`.
 */

import { useCallback } from "react";
import { useAgileConfig } from "../../../AgileConfigContext";
import { reasonCopy } from "../ticketCapabilities";

interface BulkSelectionLike {
    count: number;
    selectedIds: Array<number | string>;
    apply: (action: any, value: unknown) => Promise<unknown>;
}

interface BulkStatusArgs {
    bulk: BulkSelectionLike;
    tasks: any[];
    showConfirm: (
        title: string,
        message: string,
        onConfirm: () => void,
        opts?: { confirmText?: string; isDanger?: boolean },
    ) => void;
    closeConfirm: () => void;
}

export function useApplyBulkStatus({ bulk, tasks, showConfirm, closeConfirm }: BulkStatusArgs) {
    const { workflowStates } = useAgileConfig() as any;

    return useCallback(
        (targetKey: string) => {
            if (bulk.count === 0) return;
            const selected = new Set(bulk.selectedIds.map(String));
            const chosen = tasks.filter((task) => selected.has(String(task.id)));
            const target = (workflowStates || []).find((state: any) => String(state.id) === targetKey);
            const blocked = chosen
                .map((task) => ({
                    task,
                    decision: task.capabilities?.transitions?.find((entry: any) => String(entry.to) === targetKey),
                }))
                .filter((entry) => entry.decision?.allowed !== true);

            if (blocked.length === 0) {
                void bulk.apply("status", targetKey);
                return;
            }
            const label = target?.name || targetKey;
            const names = blocked.map((entry) => `${entry.task.title}: ${reasonCopy(entry.decision?.reason)}`).join("; ");
            showConfirm(
                "Some tickets can't move",
                `${blocked.length} of ${chosen.length} selected ticket(s) can't move to ${label}: ${names}. ` +
                    "The rest will move.",
                () => {
                    closeConfirm();
                    void bulk.apply("status", targetKey);
                },
                { confirmText: "Move the rest" },
            );
        },
        [bulk, tasks, workflowStates, showConfirm, closeConfirm],
    );
}
