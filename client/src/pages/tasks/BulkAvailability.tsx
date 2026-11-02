import { actionDecision, reasonCopy, transitionOptions } from "./ticketCapabilities";

export default function BulkAvailability({ tickets, states }: { tickets: any[]; states: any[] }) {
    const labels = { edit: "Edit", placeInSprint: "Add to sprint", delete: "Delete" };
    return (
        <details>
            <summary>Per-ticket availability</summary>
            <ul aria-label="Per-ticket availability">
                {tickets.map((ticket) => (
                    <li key={ticket.id}>
                        {ticket.title || `#${ticket.id}`}:{" "}
                        {(["edit", "placeInSprint", "delete"] as const).map((action) => {
                            const decision = actionDecision(ticket, action);
                            return <span key={action}>{labels[action]}: {decision.allowed ? "Available" : reasonCopy(decision.reason)}. </span>;
                        })}
                        {transitionOptions(ticket, states).map((target) => (
                            <span key={target.to}>{target.label}: {target.allowed ? "Available" : reasonCopy(target.reason)}. </span>
                        ))}
                    </li>
                ))}
            </ul>
        </details>
    );
}
