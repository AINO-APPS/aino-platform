import { useAgileConfig } from "../../AgileConfigContext";
import { decisionProps, isReadOnlyTicket, transitionOptions } from "./ticketCapabilities";
import s from "./TaskDetailModal.module.css";

interface Props {
    task: any;
    currentUser: { id?: number; role?: string; team_id?: number | null } | null | undefined;
    onChange: (task: any, option: { id: string; label: string }) => void;
}

/**
 * "Status" row in the ticket detail view. Shown for every ticket — sprint,
 * scheduled and backlog alike — matching the mobile apps, and limited to the
 * people the server lets change status.
 */
export default function TaskStatusControl({ task, onChange }: Props) {
    const { workflowStates } = (useAgileConfig() as any) || {};
    const options = transitionOptions(task, workflowStates);
    if (isReadOnlyTicket(task)) return <span>{task.workflow_state_name}</span>;

    return (
        <div className={s["detail-status-bar"]} data-testid="task-status-control">
            <span className={s["detail-status-label"]}>Status:</span>
            {!task?.capabilities && <button type="button" {...decisionProps(undefined)}>Change status</button>}
            {options.map((option) => {
                return (
                    <button
                        key={option.key}
                        type="button"
                        className={s["detail-status-btn"]}
                        style={{ "--col-color": option.color, "--col-ink": "var(--text)" } as React.CSSProperties}
                        {...decisionProps(option)}
                        onClick={() => onChange(task, { id: option.key, label: option.label })}
                    >
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
