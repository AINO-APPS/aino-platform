// Permission adapters for tasks.
//
// Ticket decisions own permission and lifecycle rules. Read access ignores a
// freeze refusal: frozen tickets remain readable, but cannot be edited.

import type { Request, Response } from "express";
import {
    canReadProjectTask,
    taskActorFromRequest,
    type TaskActor,
} from "../../../modules/tasks/tasks.policy";
import { ticketActionConflict } from "../../../modules/tasks/tasks.writeGuards";

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

const ACCESS_DENIED = "Access denied";

async function ticketCreationConflict(req: Request, projectId: number | null) {
    const actor = taskActorFromRequest(req);
    return ticketActionConflict(req.db!, actor, {
        id: 0, project_id: projectId, org_id: req.userOrgId, user_id: req.userId,
    }, "edit");
}

async function canAccessTask(task: any, actor: TaskActor, db?: DbLike): Promise<boolean> {
    if (!task || !db) return false;
    if (actor.orgId != null && task.org_id != null && Number(task.org_id) !== Number(actor.orgId)) return false;
    if (!await canReadProjectTask(task, actor)) return false;
    return !await ticketActionConflict(db, actor, task, "comment");
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
    if (!["GET", "HEAD"].includes(req.method)) {
        const refusal = await ticketActionConflict(req.db!, actor, task, "edit");
        if (refusal) {
            res.status(refusal.status).json(refusal.body);
            return null;
        }
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

export = {
    canAccessTask,
    ticketActionConflict,
    ticketCreationConflict,
    denyTaskAccess,
    loadAccessibleTask,
    ACCESS_DENIED,
};
