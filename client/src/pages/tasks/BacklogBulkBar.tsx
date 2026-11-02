import React from "react";
import BulkActionBar from "./BulkActionBar";
import { transitionOptions } from "./ticketCapabilities";
import { useAgileConfig } from "../../AgileConfigContext";

interface BacklogBulkBarProps {
    bulk: {
        count: number;
        applying: boolean;
        apply: (action: any, value: unknown) => Promise<unknown>;
        /** Lifecycle-aware status apply: names skipped tickets before sending. */
        applyStatus?: (status: string) => void;
        clear: () => void;
        selectedIds?: Array<number | string>;
    };
    tasks?: any[];
    availableSprints: any[];
    assignableUsers: any[];
    onOfferUndo: (label: string) => void;
    /** Ask before cancelling a batch; cancelling is reversible but not silent. */
    onConfirmCancel: (count: number, onConfirm: () => void) => void;
}

/**
 * The backlog's bulk-action bar, wired to the selection hook.
 *
 * Kept out of the Tasks page so the page stays within the file-size ratchet.
 */
export default function BacklogBulkBar({
    bulk,
    availableSprints,
    assignableUsers,
    onOfferUndo,
    onConfirmCancel,
    tasks = [],
}: BacklogBulkBarProps) {
    const { workflowStates } = useAgileConfig() as any;
    const tickets = (bulk.selectedIds || []).map((id) =>
        tasks.find((task) => String(task.id) === String(id)) || { id, title: `#${id}` });
    const targets = tickets.flatMap((ticket) => transitionOptions(ticket, workflowStates));
    const statuses = [...new Set(targets.map((target) => target.key))].map((key) => {
        const entries = targets.filter((target) => target.key === key);
        return { ...entries[0], allowed: entries.some((entry) => entry.allowed) };
    });

    return (
        <BulkActionBar
            count={bulk.count}
            applying={bulk.applying}
            sprints={availableSprints}
            statuses={statuses}
            tickets={tickets}
            states={workflowStates}
            users={assignableUsers}
            onMoveToSprint={(sprintId) => {
                void bulk.apply("move_to_sprint", sprintId);
                onOfferUndo("Moved to sprint");
            }}
            onStatus={(status) => {
                // `applyStatus` names the tickets the lifecycle will skip.
                if (bulk.applyStatus) bulk.applyStatus(status);
                else void bulk.apply("status", status);
                onOfferUndo("Status changed");
            }}
            onAssign={(userId) => {
                void bulk.apply("assign", userId);
                onOfferUndo("Assignee changed");
            }}
            onDelete={() => {
                onConfirmCancel(bulk.count, () => {
                    void bulk.apply("delete", null);
                    onOfferUndo("Cancelled");
                });
            }}
            onClear={bulk.clear}
        />
    );
}
