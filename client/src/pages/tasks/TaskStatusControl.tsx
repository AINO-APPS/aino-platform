import { useAgileConfig } from "../../AgileConfigContext";
import { canChangeTaskStatus, currentStatusOption, statusOptions, STATUS_FORBIDDEN, type StatusOption } from "./taskStatus";
import s from "./TaskDetailModal.module.css";

interface Props {
    task: any;
    currentUser: { id?: number; role?: string } | null | undefined;
    onChange: (task: any, option: { id: string; label: string }) => void;
}

/**
 * "Status" row in the ticket detail view. Shown for every ticket — sprint,
 * scheduled and backlog alike — matching the mobile apps, and limited to the
 * people the server lets change status.
 */
export default function TaskStatusControl({ task, currentUser, onChange }: Props) {
    const { workflowStates } = (useAgileConfig() as any) || {};
    const options = statusOptions(workflowStates);
    const current = currentStatusOption(task, workflowStates, options);
    const allowed = canChangeTaskStatus(task, currentUser?.id, currentUser?.role);

    return (
        <div className={s["detail-status-bar"]} title={allowed ? undefined : STATUS_FORBIDDEN} data-testid="task-status-control">
            <span className={s["detail-status-label"]}>Status:</span>
            {options.map((option: StatusOption) => {
                const active = current?.key === option.key;
                return (
                    <button
                        key={option.key}
                        type="button"
                        className={`${s["detail-status-btn"]} ${active ? s["detail-status-active"] : ""}`}
                        style={{ "--col-color": option.color } as React.CSSProperties}
                        disabled={active || !allowed}
                        aria-pressed={active}
                        onClick={() => onChange(task, { id: option.key, label: option.label })}
                    >
                        {option.icon ? `${option.icon} ` : ""}
                        {option.label}
                    </button>
                );
            })}
        </div>
    );
}
