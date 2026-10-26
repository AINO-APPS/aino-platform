import { COLUMNS } from "./constants";

/** The team context that decides whether a ticket belongs to the viewer. */
export interface TaskAccessContext {
    teamId?: number | null;
    /** Per-org `team_visibility` flag. Off keeps the legacy rule. */
    teamVisibility?: boolean;
}

const ORG_ADMIN_ROLES = ["super_admin", "hr_admin", "platform_admin"];

export function isOrgAdminRole(role: string | null | undefined): boolean {
    return ORG_ADMIN_ROLES.includes(String(role));
}

function isTeamMember(
    task: { team_id?: number | null } | null | undefined,
    context: TaskAccessContext | undefined,
): boolean {
    if (!context?.teamVisibility) return false;
    if (context.teamId == null || task?.team_id == null) return false;
    return Number(task.team_id) === Number(context.teamId);
}

/**
 * Mirrors the server's `canChangeTaskStatus`: the creator, the assignee, an
 * org admin, or (with team visibility on) any member of the owning team.
 */
export function canChangeTaskStatus(
    task: { user_id?: number | null; assigned_to?: number | null; team_id?: number | null } | null | undefined,
    userId: number | null | undefined,
    role: string | null | undefined,
    context?: TaskAccessContext,
): boolean {
    if (!task) return false;
    if (userId != null && (Number(task.user_id) === Number(userId) || Number(task.assigned_to) === Number(userId))) return true;
    if (isOrgAdminRole(role)) return true;
    return isTeamMember(task, context);
}

/**
 * Cancellation is a team write: the creator/assignee, an org admin, or any
 * member of the owning team when team visibility is on.
 */
export function canCancelTask(
    task: { user_id?: number | null; assigned_to?: number | null; team_id?: number | null; completed_at?: unknown } | null | undefined,
    userId: number | null | undefined,
    role: string | null | undefined,
    context?: TaskAccessContext,
): boolean {
    if (!task || task.completed_at) return false;
    // Flag off restores the old creator-only cancellation rule.
    if (context?.teamVisibility === false) {
        return isOrgAdminRole(role) || (userId != null && Number(task.user_id) === Number(userId));
    }
    return canChangeTaskStatus(task, userId, role, context);
}

export const STATUS_FORBIDDEN = "You do not have permission to change this ticket's status";

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
