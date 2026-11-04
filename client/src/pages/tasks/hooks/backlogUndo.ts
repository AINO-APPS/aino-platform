import { bulkTaskAction } from "../../../api/tasks";
import type { BulkAction, BulkResult } from "./useBulkSelection";

/** Undo through the same public write path, grouped by each previous value. */
export async function reverseBulkAction(action: BulkAction, applied: BulkResult[], onResults: (results: BulkResult[]) => void): Promise<void> {
    if (action === "delete" || applied.length === 0) return;
    if (action === "move_to_sprint") {
        const bySprint = new Map<number | null, number[]>();
        applied.forEach((result) => {
            const sprintId = (result.previous?.sprint_id ?? null) as number | null;
            bySprint.set(sprintId, [...(bySprint.get(sprintId) ?? []), result.id]);
        });
        for (const [sprintId, group] of bySprint) {
            const { data } = await bulkTaskAction({ ids: group, action: "move_to_sprint", value: sprintId });
            onResults(data.results || []);
        }
        return;
    }
    if (action === "status") {
        const byState = new Map<number, number[]>();
        applied.forEach((result) => {
            const stateId = result.previous?.workflow_state_id as number | undefined;
            if (stateId === undefined) return;
            byState.set(stateId, [...(byState.get(stateId) ?? []), result.id]);
        });
        for (const [stateId, group] of byState) {
            const { data } = await bulkTaskAction({ ids: group, action: "status", value: stateId });
            onResults(data.results || []);
        }
        return;
    }
    if (action === "assign") {
        const byAssignee = new Map<number | null, number[]>();
        applied.forEach((result) => {
            const assignee = (result.previous?.assigned_to ?? null) as number | null;
            byAssignee.set(assignee, [...(byAssignee.get(assignee) ?? []), result.id]);
        });
        for (const [assignee, group] of byAssignee) {
            const { data } = await bulkTaskAction({ ids: group, action: "assign", value: assignee });
            onResults(data.results || []);
        }
    }
}
