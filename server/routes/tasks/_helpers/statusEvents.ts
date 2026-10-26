// Status-change side effects shared by every write path.
//
// A move has two audiences with different jobs:
//   * the owning team gets the realtime `task_updated` frame, so a card moves
//     on everyone's board without a refetch;
//   * the assignee and the reporter (never the actor, never the whole team)
//     get an in-app notification telling them what moved.
//
// Keeping both here means PATCH, PUT, bulk and cancel cannot disagree about
// who hears about a move.

import type { Request } from "express";

const { findTeamMemberIds } = require("../../../modules/tasks/tasks.repository");
const { describeStatusChanged } = require("../../../modules/tasks/tasks.notifications");
const { emitTaskUpdated } = require("../../../utils/taskNotifications");
const { notifyUser } = require("../../../realtime/fanout");
const { taskLink } = require("../../../utils/notificationLinks");
const { logAction } = require("../../../utils/audit");

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

interface TaskLike {
    id: number;
    title?: string;
    team_id?: number | null;
    org_id?: number | null;
    assigned_to?: number | null;
    user_id?: number | null;
}

interface StateLike {
    id?: number;
    name?: string;
}

/**
 * Everyone who should receive the realtime frame: the ticket's people, the
 * actor, and — for a status move — every member of its owning team.
 */
export async function realtimeAudience(
    db: DbLike,
    task: TaskLike,
    extra: Array<number | string | null | undefined> = [],
    includeTeam = true,
): Promise<Array<number | string | null | undefined>> {
    const members = includeTeam ? await findTeamMemberIds(db, task.team_id, task.org_id) : [];
    return [task.assigned_to, task.user_id, ...extra, ...members];
}

/** Send `task_updated` to the ticket's people and, optionally, its team. */
export async function broadcastTaskUpdated(
    req: Request,
    task: TaskLike,
    action: string,
    delta?: { fields: Record<string, unknown>; actor: { id: number; name?: string | null } | null },
    extra: Array<number | string | null | undefined> = [],
    includeTeam = true,
): Promise<void> {
    const audience = await realtimeAudience(req.db as DbLike, task, [req.userId, ...extra], includeTeam);
    emitTaskUpdated(req.tenantId, task.id, action, audience, delta);
}

/**
 * Notify the assignee and the reporter that the ticket moved.
 *
 * Best-effort: a failed notification must never lose an accepted move.
 */
export async function notifyStatusChanged(
    req: Request,
    task: TaskLike,
    fromState: StateLike | null | undefined,
    toState: StateLike | null | undefined,
    name: string | null = null,
): Promise<void> {
    const { title, body, audience } = describeStatusChanged({
        task: { id: task.id, title: task.title || "Ticket", assigned_to: task.assigned_to, user_id: task.user_id },
        from: fromState?.name || "its previous state",
        to: toState?.name || "a new state",
        actorId: req.userId,
        actorName: name,
    });
    for (const userId of audience) {
        await notifyUser(
            req.db,
            req.tenantId,
            userId,
            "task",
            title,
            body,
            { link: taskLink(task.id), linkTaskId: task.id, actorId: req.userId },
        ).catch(() => undefined);
    }
}

export interface StatusMove {
    task: TaskLike;
    /** The state the ticket left; null when it had none. */
    from: StateLike | null;
    to: StateLike & { id: number };
    /** The actor's display name. */
    name: string | null;
    /** `cancel` records a cancellation; the default is a status update. */
    audit?: "update" | "cancel";
    /** The realtime action; a plain status patch is `status`. */
    action?: string;
    /** Fields to broadcast; defaults to the workflow state alone. */
    fields?: Record<string, unknown>;
    /** Extra recipients, e.g. the previous assignee. */
    extra?: Array<number | string | null | undefined>;
    /** Only status transitions fan out to the owning team. */
    includeTeam?: boolean;
}

/**
 * Record, notify and broadcast one accepted move.
 *
 * Every write path calls this after it has persisted the change, so history
 * (logged by the caller) and the audit/realtime/notification side effects
 * cannot drift apart.
 */
export async function announceStatusMove(req: Request, move: StatusMove): Promise<void> {
    logAction(req, move.audit || "update", "task", move.task.id, {
        from: move.from?.id ?? null,
        to: move.to.id,
        field: "workflow_state",
    });
    await notifyStatusChanged(req, move.task, move.from, move.to, move.name);
    await broadcastTaskUpdated(
        req,
        move.task,
        move.action || "status",
        {
            fields: move.fields ?? { workflow_state_id: move.to.id },
            actor: { id: req.userId!, name: move.name },
        },
        move.extra ?? [],
        move.includeTeam !== false,
    );
}
