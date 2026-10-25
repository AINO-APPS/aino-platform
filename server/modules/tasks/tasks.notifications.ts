/**
 * The five task events worth telling people about.
 *
 * Being assigned a task, being added to a sprint, a sprint starting, a sprint
 * completing (with a summary of what moved), and a due date approaching.
 * Status changes and reordering deliberately emit nothing — they are noise at
 * the volume a busy board produces.
 */
import { taskLink } from "../../utils/notificationLinks";

export type TaskNotificationEvent =
    | "task_assigned"
    | "sprint_task_added"
    | "sprint_started"
    | "sprint_completed"
    | "due_date_approaching";

/** Events that must never produce a notification. */
export const SILENT_ACTIONS = ["status_change", "reordered", "ranked"] as const;

export interface SprintCompletionSummary {
    sprintName: string;
    doneTasks: number;
    totalTasks: number;
    velocity: number;
    rolledOver: number;
    rolloverTarget: string;
}

/** The deep link a notification opens. Always relative and always routable. */
export function sprintLink(sprintId: number | string): string {
    return `/tasks/sprint/${encodeURIComponent(String(sprintId))}`;
}

export function taskNotificationLink(taskId: number | string): string {
    return taskLink(taskId);
}

/**
 * The body of a sprint-completion notification.
 *
 * It has to say what actually moved: how much finished, how much carried over
 * and where it went, so the reader does not have to open the sprint to find out.
 */
export function describeSprintCompletion(summary: SprintCompletionSummary): string {
    const finished = `${summary.doneTasks} of ${summary.totalTasks} ${
        summary.totalTasks === 1 ? "ticket" : "tickets"
    } done`;
    const points = summary.velocity > 0 ? ` (${summary.velocity} points)` : "";
    if (summary.rolledOver === 0) {
        return `${summary.sprintName} completed: ${finished}${points}. Nothing carried over.`;
    }
    const carried = `${summary.rolledOver} ${
        summary.rolledOver === 1 ? "ticket" : "tickets"
    } carried over to ${summary.rolloverTarget}`;
    return `${summary.sprintName} completed: ${finished}${points}. ${carried}.`;
}

/** True when an action is one of the deliberately silent ones. */
export function isSilentAction(action: string | null | undefined): boolean {
    return !!action && (SILENT_ACTIONS as readonly string[]).includes(action);
}

/**
 * Who should hear about a task-level event.
 *
 * The assignee and the creator, minus the person who caused it — nobody needs a
 * notification for their own action.
 */
export function taskAudience(
    task: { assigned_to?: number | string | null; user_id?: number | string | null },
    actorId: number | string | null | undefined,
): number[] {
    const actor = Number(actorId);
    const ids = [task.assigned_to, task.user_id]
        .map((value) => Number(value))
        .filter((id) => Number.isFinite(id) && id > 0 && id !== actor);
    return [...new Set(ids)];
}

/** A due date is "approaching" from the day before until the day itself. */
export function isDueDateApproaching(
    dueDate: string | null | undefined,
    today: string,
): boolean {
    if (!dueDate) return false;
    const due = dueDate.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return false;
    const diff = Math.round(
        (Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
    );
    return diff === 0 || diff === 1;
}
