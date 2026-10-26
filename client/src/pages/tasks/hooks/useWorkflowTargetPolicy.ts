/**
 * The board's target policy, wired to the tenant's workflow config.
 *
 * Pointer drag and keyboard navigation both need the same answer to "may this
 * ticket move there?", so the policy is built once here rather than twice in
 * the two input paths.
 */
import { useMemo } from "react";
import { useAgileConfig } from "../../../AgileConfigContext";
import type { BoardTask, TargetPolicy } from "./boardTargets";
import { workflowTargetPolicy } from "./workflowTargets";

export function useWorkflowTargetPolicy(
    tasks: BoardTask[],
    override?: TargetPolicy,
): TargetPolicy {
    const { workflowStates, transitions, features } = useAgileConfig() as any;
    return useMemo<TargetPolicy>(
        () => override ?? workflowTargetPolicy({
            states: workflowStates,
            transitions,
            tasks,
            wipEnabled: features?.wipLimits,
        }),
        [override, workflowStates, transitions, tasks, features?.wipLimits],
    );
}
