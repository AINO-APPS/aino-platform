import React from "react";
import BulkActionBar from "./BulkActionBar";
import { COLUMNS } from "./constants";

interface BacklogBulkBarProps {
    bulk: {
        count: number;
        applying: boolean;
        apply: (action: any, value: unknown) => Promise<unknown>;
        clear: () => void;
    };
    availableSprints: any[];
    assignableUsers: any[];
    onOfferUndo: (label: string) => void;
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
}: BacklogBulkBarProps) {
    return (
        <BulkActionBar
            count={bulk.count}
            applying={bulk.applying}
            sprints={availableSprints}
            statuses={COLUMNS.map((col: any) => ({ key: col.id, label: col.label }))}
            users={assignableUsers}
            onMoveToSprint={(sprintId) => {
                void bulk.apply("move_to_sprint", sprintId);
                onOfferUndo("Moved to sprint");
            }}
            onStatus={(status) => {
                void bulk.apply("status", status);
                onOfferUndo("Status changed");
            }}
            onAssign={(userId) => {
                void bulk.apply("assign", userId);
                onOfferUndo("Assignee changed");
            }}
            onDelete={() => {
                void bulk.apply("delete", null);
                onOfferUndo("Deleted");
            }}
            onClear={bulk.clear}
        />
    );
}
