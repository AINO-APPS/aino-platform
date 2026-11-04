import {
    decideTicket, loadTicketDecisionContext,
    type Capability, type DecisionTicket, type TicketAction, type TicketDecisionContext,
} from "./tasks.capabilities";
import type { TaskActor } from "./tasks.policy";
import type { Conflict, LifecycleDb } from "./tasks.workflowRules";
import { CAPABILITY_DENIAL_MESSAGES } from "./tasks.denialMessages";

export function capabilityConflict(verdict: Capability, ticket: DecisionTicket, actor: TaskActor): Conflict | null {
    if (verdict.allowed) return null;
    const foreign = actor.orgId != null && ticket.org_id != null && Number(ticket.org_id) !== Number(actor.orgId);
    return {
        status: foreign ? 404 : verdict.reason === "ACCESS_DENIED" || verdict.reason === "READ_ONLY_ROLE" ? 403 : 409,
        body: { error: foreign ? "Task not found" : CAPABILITY_DENIAL_MESSAGES[verdict.reason], code: verdict.reason },
    };
}

export async function ticketActionConflict(
    db: LifecycleDb,
    actor: TaskActor,
    ticket: DecisionTicket,
    action: TicketAction,
    context?: TicketDecisionContext,
): Promise<Conflict | null> {
    const loaded = context ?? await loadTicketDecisionContext(db, actor, [ticket]);
    return capabilityConflict(decideTicket(actor, ticket, loaded).capabilities.can[action], ticket, actor);
}
