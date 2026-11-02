import {
    decideTicket, loadTicketDecisionContext,
    type Capability, type DecisionTicket, type TicketAction, type TicketDecisionContext,
} from "./tasks.capabilities";
import type { TaskActor } from "./tasks.policy";
import type { Conflict, LifecycleDb } from "./tasks.workflowRules";
import { sprintTeamMismatchBody } from "./tasks.ownership";

const MESSAGES = {
    ACCESS_DENIED: "Access denied",
    SPRINT_FROZEN: "This sprint is completed and no longer accepts task changes.",
    CANCELLED_TERMINAL: "This ticket is cancelled and cannot change state.",
    INVALID_TRANSITION: "This ticket cannot perform that action in its current state.",
    IN_SPRINT: "This ticket is in a sprint. Take it out of the sprint before planning it onto a day.",
    SPRINT_TEAM_MISMATCH: String(sprintTeamMismatchBody().error),
};

export function capabilityConflict(verdict: Capability, ticket: DecisionTicket, actor: TaskActor): Conflict | null {
    if (verdict.allowed) return null;
    const foreign = actor.orgId != null && ticket.org_id != null && Number(ticket.org_id) !== Number(actor.orgId);
    return {
        status: foreign ? 404 : verdict.reason === "ACCESS_DENIED" ? 403 : 409,
        body: { error: foreign ? "Task not found" : MESSAGES[verdict.reason], code: verdict.reason },
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
