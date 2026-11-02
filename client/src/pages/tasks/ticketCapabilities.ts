import type { TicketCapabilities, TicketCapability } from "../../types/generated/tasks";

type Ticket = { capabilities?: TicketCapabilities | null } | null | undefined;
export type TicketAction = keyof TicketCapabilities["can"];

const REASONS: Record<string, string> = {
    INVALID_TRANSITION: "This workflow transition is not allowed.",
    ACCESS_DENIED: "You do not have permission to do this.",
    SPRINT_FROZEN: "This sprint is frozen. Move the ticket out first.",
    IN_SPRINT: "This ticket is in a sprint. Move it out before scheduling a day.",
    SPRINT_TEAM_MISMATCH: "The sprint belongs to another team.",
    CANCELLED_TERMINAL: "Cancelled tickets cannot be changed.",
    WIP_EXCEEDED: "This column has reached its work-in-progress limit.",
};

export function reasonCopy(code?: string): string {
    return (code && REASONS[code]) || "This action is unavailable. Refresh the ticket and try again.";
}

export function actionDecision(ticket: Ticket, action: TicketAction): TicketCapability {
    return ticket?.capabilities?.can?.[action] ?? { allowed: false };
}

export function decisionProps(decision: TicketCapability | undefined) {
    return {
        disabled: decision?.allowed !== true,
        title: decision?.allowed === true ? undefined : reasonCopy(decision?.reason),
    };
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
