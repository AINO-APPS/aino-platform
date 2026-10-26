import React from "react";
import BulkActionBar from "./BulkActionBar";
import { COLUMNS } from "./constants";
import { useAgileConfig } from "../../AgileConfigContext";

interface BacklogBulkBarProps {
    bulk: {
        count: number;
        applying: boolean;
        apply: (action: any, value: unknown) => Promise<unknown>;
        /** Lifecycle-aware status apply: names skipped tickets before sending. */
        applyStatus?: (status: string) => void;
        clear: () => void;
    };
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
}: BacklogBulkBarProps) {
    const { workflowStates } = useAgileConfig() as any;
    // Tenant states when configured; the built-in columns otherwise. Cancelled
    // has its own action (Cancel tickets), so it is not a status choice here.
    const statuses = (workflowStates && workflowStates.length > 0
        ? workflowStates.map((state: any) => ({ key: state.key, label: state.name }))
        : COLUMNS.map((col: any) => ({ key: col.id, label: col.label }))
    ).filter((status: any) => status.key !== "cancelled");

    return (
        <BulkActionBar
            count={bulk.count}
            applying={bulk.applying}
            sprints={availableSprints}
            statuses={statuses}
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
