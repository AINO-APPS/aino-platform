import { COLUMNS } from "./constants";

/** Mirrors the server's `canChangeTaskStatus`: assignee, reporter, or an org admin. */
export function canChangeTaskStatus(
    task: { user_id?: number | null; assigned_to?: number | null } | null | undefined,
    userId: number | null | undefined,
    role: string | null | undefined,
): boolean {
    if (!task) return false;
    if (userId != null && (Number(task.user_id) === Number(userId) || Number(task.assigned_to) === Number(userId))) return true;
    return ["super_admin", "hr_admin", "platform_admin"].includes(String(role));
}

export const STATUS_FORBIDDEN = "Only the assignee or reporter can change the status";

export interface StatusOption {
    /** Sent to PATCH /tasks/:id/status as `status`; the server resolves it to a workflow state. */
    key: string;
    label: string;
    color: string;
    icon?: string;
}

/** The org's workflow states (agile config), falling back to the default columns. */
export function statusOptions(workflowStates: Array<{ key?: string; name?: string; color?: string }> | undefined): StatusOption[] {
    const states = (workflowStates || []).filter((state) => state.key);
    if (states.length === 0) return COLUMNS.map((c) => ({ key: String(c.id), label: c.label, color: c.color, icon: c.icon }));
    return states.map((state) => ({ key: String(state.key), label: state.name || String(state.key), color: state.color || "var(--primary)" }));
}

/** The option a task is currently in, by workflow state id first, then by legacy status key. */
export function currentStatusOption(
    task: { status?: string | null; workflow_state_id?: number | null } | null | undefined,
    workflowStates: Array<{ id?: number; key?: string }> | undefined,
    options: StatusOption[],
): StatusOption | undefined {
    if (!task) return undefined;
    const byId = (workflowStates || []).find((s) => s.id != null && s.id === task.workflow_state_id);
    const key = byId?.key ?? task.status;
    return options.find((o) => o.key === key) ?? options[0];
}
