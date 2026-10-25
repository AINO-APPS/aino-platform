// Realtime fan-out for task mutations. Every client (web board, sprint card,
// mobile task list) listens for `task_updated` and refetches.
const { sendToUser, notifyUser } = require('./ws');
const { notifyByEmail } = require('./mailer');
import { taskLink } from './notificationLinks';
import { buildTaskDelta, type DeltaField } from '../modules/tasks/tasks.deltas';

export type TaskUpdatedAction = 'updated' | 'status' | 'deleted' | 'comment';

/**
 * Send `task_updated` { taskId, action } to the given users (deduped, falsy ids
 * dropped). Callers pass assignee, creator and acting user.
 *
 * When `delta` is supplied the frame also carries a field-level delta — only
 * the fields that changed, the actor and a timestamp — so a client can patch
 * the card it already holds instead of refetching the whole object.
 */
export function emitTaskUpdated(
    tenantId: number | null | undefined,
    taskId: number,
    action: TaskUpdatedAction,
    userIds: Array<number | string | null | undefined>,
    delta?: {
        fields: Partial<Record<DeltaField, unknown>>;
        actor: { id: number; name?: string | null } | null;
    },
): void {
    const payload = delta ? buildTaskDelta(taskId, delta.fields, delta.actor) : null;
    const seen = new Set<number>();
    for (const raw of userIds) {
        const uid = Number(raw);
        if (!raw || !Number.isFinite(uid) || seen.has(uid)) continue;
        seen.add(uid);
        sendToUser(tenantId, uid, 'task_updated', {
            taskId,
            action,
            ...(payload ? { fields: payload.fields, actor: payload.actor, at: payload.at } : {}),
        });
    }
}

/**
 * Notify a user they were assigned a task: in-app notification (+WS/FCM via
 * notifyUser, linking to the task), email and the `task_assigned` event.
 * Returns true when the assignee exists and was notified.
 */
export async function notifyTaskAssigned(
    req: { db?: any; tenantId?: number | null; userId?: number },
    task: { id: number; title: string },
    assigneeId: number,
): Promise<boolean> {
    const assignee = (await req.db.query('SELECT email, full_name FROM users WHERE id = $1', [assigneeId])).rows[0];
    const assigner = (await req.db.query('SELECT full_name FROM users WHERE id = $1', [req.userId])).rows[0];
    if (!assignee) return false;
    const assignerName = assigner?.full_name || 'Someone';
    await notifyUser(req.db, req.tenantId, assigneeId, 'task', `Task Assigned: ${task.title}`,
        `${assignerName} assigned you a task`,
        { linkTaskId: task.id, actorId: req.userId, link: taskLink(task.id) });
    notifyByEmail('taskAssigned', assignee, task, assignerName);
    sendToUser(req.tenantId, assigneeId, 'task_assigned', { taskId: task.id, title: task.title });
    return true;
}
