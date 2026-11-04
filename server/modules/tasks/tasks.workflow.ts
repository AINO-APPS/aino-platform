export * from "./tasks.workflowRules";

import { decideTicket, loadTicketDecisionContext, type DecisionTicket, type TicketDecisionContext } from "./tasks.capabilities";
import { capabilityConflict } from "./tasks.writeGuards";
import type { TaskActor } from "./tasks.policy";
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
    const projectLifecycle = decisionContext?.lifecyclesByProject?.get(Number(task.project_id));
    const lifecycle = projectLifecycle ?? context ?? await loadLifecycleContext(db, orgId, task.project_id == null ? null : Number(task.project_id));
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
    const row = (await db.query(
        `SELECT COUNT(*)::int AS c FROM tasks
          WHERE workflow_state_id = $1 AND id != $2 AND org_id = $3`,
        [target.id, task.id, orgId ?? null],
    )).rows[0];
    return wipConflict(lifecycle, target, Number(row?.c ?? 0));
}
