import type {
    TicketCapabilities,
    TicketCapability,
    TicketTransitionCapability,
} from "../../types/generated/tasks";

type Ticket = { capabilities?: TicketCapabilities | null } | null | undefined;
export type TicketAction = keyof TicketCapabilities["can"];

const REASONS: Record<string, string> = {
    INVALID_TRANSITION: "This workflow transition is not allowed.",
    ACCESS_DENIED: "You do not have permission to do this.",
    READ_ONLY_ROLE: "Your project role allows reading and commenting only.",
    PROJECT_ARCHIVED: "This project is archived. Tickets are read-only; comments are still open.",
    PROJECT_NOT_FOUND: "This project is no longer available. Choose another project.",
    PROJECT_UNCHANGED: "This ticket already belongs to that project.",
    WORKFLOW_NOT_FOUND: "The destination project needs an active initial workflow state.",
    SPRINT_PROJECT_MISMATCH: "The sprint belongs to another project.",
    SPRINT_FROZEN: "This sprint is frozen. Move the ticket out first.",
    IN_SPRINT: "This ticket is in a sprint. Move it out before scheduling a day.",
    SPRINT_TEAM_MISMATCH: "The sprint belongs to another team.",
    CANCELLED_TERMINAL: "Cancelled tickets cannot be changed.",
    WORKLOG_CANCELLED: "Work cannot be logged on a cancelled ticket.",
    WORKLOG_FOR_OTHERS_DENIED: "Only an org admin can log work for another person.",
    WIP_EXCEEDED: "This column has reached its work-in-progress limit.",
};

export function reasonCopy(code?: string): string {
    return (code && REASONS[code]) || "This action is unavailable. Refresh the ticket and try again.";
}

export function actionDecision(ticket: Ticket, action: TicketAction): TicketCapability {
    return ticket?.capabilities?.can?.[action] ?? { allowed: false };
}

export function isReadOnlyTicket(ticket: Ticket): boolean {
    const reason = actionDecision(ticket, "edit").reason;
    return reason === "READ_ONLY_ROLE" || reason === "PROJECT_ARCHIVED";
}

export function decisionProps(decision: TicketCapability | undefined) {
    return {
        disabled: decision?.allowed !== true,
        title: decision?.allowed === true ? undefined : reasonCopy(decision?.reason),
    };
}

/** Interpret the server's transition and column decisions for drop rendering. */
export function boardTargetDecision(
    ticket: { capabilities?: { transitions: TicketTransitionCapability[] } | null } | null | undefined,
    column: { stateId: number | string; accepting: boolean },
): TicketTransitionCapability {
    const transition = ticket?.capabilities?.transitions?.find(
        (candidate) => String(candidate.to) === String(column.stateId),
    );
    if (!ticket?.capabilities?.transitions) return { to: Number(column.stateId), allowed: false };
    if (!transition?.allowed) {
        return transition ?? {
            to: Number(column.stateId),
            allowed: false,
            reason: "INVALID_TRANSITION",
        };
    }
    if (!column.accepting) {
        return {
            to: transition.to,
            allowed: false,
            reason: "WIP_EXCEEDED",
        };
    }
    return transition;
}

/** Labels come from config, but the server alone supplies targets and decisions. */
export function transitionOptions(ticket: Ticket, states: any[] = []) {
    return (ticket?.capabilities?.transitions ?? []).map((decision) => {
        const state = states.find((candidate) => String(candidate.id) === String(decision.to));
        return {
            ...decision,
            key: String(decision.to),
            label: state?.name || `State #${decision.to}`,
            color: state?.color || "var(--primary)",
        };
    });
}

export function writeError(error: unknown, fallback: string): string {
    const data = (error as { response?: { data?: { code?: string; error?: string } } })?.response?.data;
    const code = data?.code || (data?.error && REASONS[data.error] ? data.error : undefined);
    return code ? reasonCopy(code) : data?.error || fallback;
}
