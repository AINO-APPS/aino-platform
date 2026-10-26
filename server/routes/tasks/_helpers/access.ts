// Permission adapters for tasks.
//
// The rules live in `modules/tasks/tasks.policy.ts`. This file only adapts the
// request shape and, for the flag-off legacy rule, loads the creator's current
// team. No route may re-implement a visibility predicate of its own.

import type { Request, Response } from "express";
import {
    canChangeTaskStatus as policyCanChangeTaskStatus,
    canReadTask,
    canWriteTask,
    isOrgAdmin,
    taskActorFromRequest,
    type TaskActor,
} from "../../../modules/tasks/tasks.policy";

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

const STATUS_FORBIDDEN = "You do not have permission to change this ticket's status";
const ACCESS_DENIED = "Access denied";

/** The creator's *current* team, only consulted by the legacy flag-off rule. */
async function loadOwnerTeamId(task: any, db?: DbLike): Promise<number | null> {
    if (!db || task?.user_id == null) return null;
    const owner = (await db.query("SELECT team_id FROM users WHERE id = $1", [task.user_id])).rows[0];
    return owner?.team_id ?? null;
}

async function canAccessTask(task: any, actor: TaskActor, db?: DbLike): Promise<boolean> {
    if (!task) return false;
    const ownerTeamId = actor.teamVisibility ? undefined : await loadOwnerTeamId(task, db);
    return canReadTask(task, actor, ownerTeamId);
}

/**
 * Used by detail-adjacent routes. Returns the task, or sends 404/403 and
 * returns null:
 *   - a different organisation's row is indistinguishable from missing (404);
 *   - a same-org row the caller may not read is an explicit 403.
 */
async function loadAccessibleTask(req: Request, res: Response, taskId: number): Promise<any | null> {
    const task = (await req.db!.query("SELECT * FROM tasks WHERE id = $1", [taskId])).rows[0];
    if (!task) {
        res.status(404).json({ error: "Task not found" });
        return null;
    }

    const actor = taskActorFromRequest(req);
    if (actor.orgId != null && task.org_id != null && Number(task.org_id) !== Number(actor.orgId)) {
        res.status(404).json({ error: "Task not found" });
        return null;
    }
    if (!await canAccessTask(task, actor, req.db)) {
        res.status(403).json({ error: ACCESS_DENIED });
        return null;
    }
    return task;
}

/**
 * Send the correct refusal for a failed direct `canAccessTask` check:
 *   - a row in another organisation is a 404 (do not leak its existence);
 *   - a same-org row the caller cannot read is a 403.
 */
function denyTaskAccess(res: Response, task: any, actor: TaskActor): Response {
    const sameOrg = actor.orgId == null
        || !task
        || task.org_id == null
        || Number(task.org_id) === Number(actor.orgId);
    return sameOrg
        ? res.status(403).json({ error: ACCESS_DENIED })
        : res.status(404).json({ error: "Task not found" });
}

/**
 * Lifecycle writes are open to any member of the owning team, plus the
 * creator/assignee and org admins. With `team_visibility` off this is the
 * legacy assignee/reporter rule.
 */
async function canChangeTaskStatus(task: any, actor: TaskActor, db?: DbLike): Promise<boolean> {
    if (!task) return false;
    const ownerTeamId = actor.teamVisibility ? undefined : await loadOwnerTeamId(task, db);
    return policyCanChangeTaskStatus(task, actor, ownerTeamId);
}

/**
 * Cancel is a write on the ticket: any owning-team member may do it, as may
 * the creator/assignee and admins. The terminal-state guard stays in the route
 * because it is about lifecycle, not access.
 */
async function canCancelTask(task: any, actor: TaskActor, db?: DbLike): Promise<boolean> {
    if (!task) return false;
    // Flag off restores the old creator-only cancellation rule.
    if (!actor.teamVisibility) {
        return isOrgAdmin(actor.role) || Number(task.user_id) === Number(actor.userId);
    }
    return canWriteTask(task, actor);
}

export = {
    canAccessTask,
    canCancelTask,
    canChangeTaskStatus,
    denyTaskAccess,
    loadAccessibleTask,
    STATUS_FORBIDDEN,
    ACCESS_DENIED,
};
