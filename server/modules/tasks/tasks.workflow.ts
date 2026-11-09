export * from "./tasks.workflowRules";

import { decideTicket, lifecycleForTicket, loadTicketDecisionContext, type DecisionTicket, type TicketDecisionContext } from "./tasks.capabilities";
import { capabilityConflict } from "./tasks.writeGuards";
import type { TaskActor } from "./tasks.policy";
import { findBoardProject, targetBoardOccupancy } from "./tasks.boardRepository";
import { projectTypePolicy } from "./tasks.projectTypes";
import {
    loadLifecycleContext, transitionConflict, wipConflict,
    type Conflict, type LifecycleContext, type LifecycleDb, type WorkflowState,
} from "./tasks.workflowRules";

/** Capabilities decide legality; column capacity remains the final write check. */
export async function assertLifecycleMove(
    db: LifecycleDb,
    orgId: number | null | undefined,
    task: DecisionTicket,
    target: (Pick<WorkflowState, "id" | "name"> & { wip_limit?: number | null }) | null | undefined,
    context: LifecycleContext | undefined,
    actor: TaskActor,
    decisionContext?: TicketDecisionContext,
): Promise<Conflict | null> {
    if (!target) return null;
    const lifecycle = decisionContext ? lifecycleForTicket(actor, task, decisionContext)
        : context ?? await loadLifecycleContext(db, orgId, task.project_id == null ? null : Number(task.project_id));
    const loaded = decisionContext ?? await loadTicketDecisionContext(db, actor, [task], { lifecycle });
    const decision = decideTicket(actor, task, loaded);
    const sameState = Number(task.workflow_state_id) === Number(target.id);
    const transition = decision.capabilities.transitions.find((entry) => entry.to === Number(target.id));
    const general = decision.capabilities.can.changeState;
    const verdict = transition ?? (sameState || !general.allowed
        ? general : { allowed: false as const, reason: "INVALID_TRANSITION" as const });
    if (!verdict.allowed) {
        return verdict.reason === "INVALID_TRANSITION"
            ? transitionConflict(lifecycle, task.workflow_state_id, target) ?? capabilityConflict(verdict, task, actor)
            : capabilityConflict(verdict, task, actor);
    }
    if (sameState || !lifecycle.wipEnabled || !target.wip_limit) return null;
    if (task.project_id == null) return null;
    const project = await findBoardProject(db, orgId ?? null, Number(task.project_id));
    if (!project?.enable_wip_limits) return null;
    const state = lifecycle.stateById.get(Number(target.id));
    if (state?.key === "cancelled" || projectTypePolicy(project).boardScope === "open_except_initial" && state?.is_initial) return null;
    const occupancy = await targetBoardOccupancy(db, project, task, Number(target.id));
    return occupancy == null ? null : wipConflict(lifecycle, target, occupancy);
}
