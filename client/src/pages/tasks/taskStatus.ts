import { COLUMNS } from "./constants";

const ORG_ADMIN_ROLES = ["super_admin", "hr_admin", "platform_admin"];

export function isOrgAdminRole(role: string | null | undefined): boolean {
    return ORG_ADMIN_ROLES.includes(String(role));
}

export interface StatusOption {
    /** Sent to PATCH /tasks/:id/status as `status`; the server resolves it to a workflow state. */
    key: string;
    label: string;
    /** The tone: rail, dot and border. */
    color: string;
    /** The chip text colour, readable on the tone's own tint. */
    ink: string;
    icon?: string;
}

/** The org's workflow states (agile config), falling back to the default columns. */
export function statusOptions(workflowStates: Array<{ key?: string; name?: string; color?: string }> | undefined): StatusOption[] {
    const states = (workflowStates || []).filter((state) => state.key);
    if (states.length === 0) {
        return COLUMNS.map((c) => ({ key: String(c.id), label: c.label, color: c.color, ink: c.ink, icon: c.icon }));
    }
    return states.map((state) => ({
        key: String(state.key),
        label: state.name || String(state.key),
        color: state.color || "var(--primary)",
        // A tenant-defined state colour is arbitrary, so the chip text uses the
        // neutral ink rather than guessing a readable variant of it.
        ink: "var(--text)",
    }));
}

/** The option a task is currently in, by workflow state id first, then by state key. */
export function currentStatusOption(
    task: { workflow_state_key?: string | null; workflow_state_id?: number | null } | null | undefined,
    workflowStates: Array<{ id?: number; key?: string }> | undefined,
    options: StatusOption[],
): StatusOption | undefined {
    if (!task) return undefined;
    const byId = (workflowStates || []).find((s) => s.id != null && s.id === task.workflow_state_id);
    const key = byId?.key ?? task.workflow_state_key;
    return options.find((o) => o.key === key) ?? options[0];
}
