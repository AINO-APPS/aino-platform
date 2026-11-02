import { isCancelled, type LifecycleContext, type WorkflowState } from "./tasks.workflow";

export interface SprintBoardColumn {
    stateId: number;
    count: number;
    limit: number | null;
    accepting: boolean;
}

export function buildSprintBoardColumns(
    lifecycle: LifecycleContext,
    counts: Array<{ state_id: number | string; count: number | string }>,
): SprintBoardColumn[] {
    const countByState = new Map(counts.map((row) => [Number(row.state_id), Number(row.count)]));
    return lifecycle.states
        .filter((state: WorkflowState) => !isCancelled(state))
        .map((state) => {
            const count = countByState.get(Number(state.id)) ?? 0;
            const limit = state.wip_limit == null ? null : Number(state.wip_limit);
            return {
                stateId: Number(state.id),
                count,
                limit,
                accepting: !lifecycle.wipEnabled || !limit || count < limit,
            };
        });
}
