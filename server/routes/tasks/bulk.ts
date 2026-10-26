// Bulk backlog actions.
//   POST /api/tasks/bulk  — body { ids, action, value }
//
// Actions: move_to_sprint, status, assign, delete. The response reports what
// changed so the client can offer one undo for the whole batch.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { logHistory } = require("./_helpers/logHistory");
const { canAccessTask, canCancelTask, canChangeTaskStatus, STATUS_FORBIDDEN, ACCESS_DENIED } = require("./_helpers/access");
const { isOrgAdmin, taskActorFromRequest } = require("../../modules/tasks/tasks.policy");
const { frozenSprintError } = require("./_helpers/sprintFreeze");
const { resolveWorkflowState, getOrCreateCancelledState } = require("./_helpers/agile");
const {
    findActorName, findManyInOrg, setSprint, setWorkflowState, setAssignee,
} = require("../../modules/tasks/tasks.repository");
const { findSprintInOrg } = require("../../modules/tasks/tasks.sprintRepository");
const {
    canMoveIntoTeamSprint,
    sprintTeamMismatchBody,
    teamAfterSprintMove,
} = require("../../modules/tasks/tasks.ownership");
const { describeSprintTaskAdded, taskNotificationLink } = require("../../modules/tasks/tasks.notifications");
const { notifyUser } = require("../../realtime/fanout");
const { assertLifecycleMove, loadLifecycleContext, stateOf } = require("../../modules/tasks/tasks.workflow");
const { announceStatusMove } = require("./_helpers/statusEvents");

const router = express.Router();

const ACTIONS = ["move_to_sprint", "status", "assign", "delete"] as const;
type BulkAction = (typeof ACTIONS)[number];

interface BulkResult {
    id: number;
    ok: boolean;
    error?: string;
    /** Stable machine code for a skipped ticket (`INVALID_TRANSITION`, `WIP_EXCEEDED`, …). */
    code?: string;
    previous?: Record<string, unknown>;
}

function parseIds(raw: unknown): number[] {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw
        .map((value) => Number.parseInt(String(value), 10))
        .filter((value) => !Number.isNaN(value)))];
}

/**
 * A bulk move into a sprint is the same event as a single one, so it uses the
 * same notifier. Never throws: a failed notification must not lose the move.
 */
async function notifyBulkSprintAdded(req: Request, task: any, sprintId: number): Promise<void> {
    const sprint = await findSprintInOrg(req.db!, sprintId, req.userOrgId);
    if (!sprint) return;
    const { title, body, audience } = describeSprintTaskAdded({ task, sprint, actorId: req.userId });
    for (const userId of audience) {
        await notifyUser(
            req.db!,
            req.tenantId,
            userId,
            "sprint",
            title,
            body,
            { link: taskNotificationLink(task.id), linkTaskId: task.id, actorId: req.userId },
        ).catch(() => undefined);
    }
}

router.post("/bulk", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const ids = parseIds(req.body?.ids);
        const action = req.body?.action as BulkAction;
        const value = req.body?.value;

        if (ids.length === 0) return res.status(400).json({ error: "No tasks selected" });
        if (!ACTIONS.includes(action)) return res.status(400).json({ error: "Unknown bulk action" });

        const tasks = await findManyInOrg(req.db!, ids, req.userOrgId);
        const actor = taskActorFromRequest(req);
        // Loaded once per batch: every ticket is validated against the same
        // graph and WIP setting, including tickets moved earlier in the loop.
        const lifecycle = await loadLifecycleContext(req.db, req.userOrgId);
        const name = await findActorName(req.db!, req.userId);

        const results: BulkResult[] = [];
        for (const task of tasks) {
            if (!await canAccessTask(task, actor, req.db)) {
                results.push({ id: task.id, ok: false, error: "Not found" });
                continue;
            }

            try {
                // A completed sprint is immutable (D11). The single-task routes
                // enforce this; a bulk action must not be a way around it.
                const nextSprintId = action === "move_to_sprint"
                    ? (value === null || value === "" ? null : Number.parseInt(String(value), 10))
                    : undefined;
                const frozen = await frozenSprintError(req, task, nextSprintId);
                if (frozen) {
                    results.push({ id: task.id, ok: false, error: frozen.error });
                    continue;
                }

                if (action === "move_to_sprint") {
                    const sprintId = nextSprintId as number | null;
                    let adoptTeamId: number | null = null;
                    if (sprintId !== null) {
                        const sprint = await findSprintInOrg(req.db!, sprintId, req.userOrgId);
                        if (!sprint || (!isOrgAdmin(req.userRole) && Number(sprint.team_id) !== Number(req.userTeamId))) {
                            results.push({ id: task.id, ok: false, error: "Invalid sprint or sprint does not belong to your team" });
                            continue;
                        }
                        if (!canMoveIntoTeamSprint(task.team_id, sprint.team_id)) {
                            results.push({ id: task.id, ok: false, error: sprintTeamMismatchBody().error as string });
                            continue;
                        }
                        if (task.team_id == null) adoptTeamId = teamAfterSprintMove(task.team_id, sprint.team_id);
                    }
                    await setSprint(req.db!, task.id, sprintId, adoptTeamId);
                    await logHistory(task.id, req.userId, "updated", "sprint", task.sprint_id, sprintId, null, req.db);
                    if (sprintId !== null) {
                        await notifyBulkSprintAdded(req, task, sprintId);
                    }
                    results.push({ id: task.id, ok: true, previous: { sprint_id: task.sprint_id } });
                } else if (action === "status") {
                    if (!await canChangeTaskStatus(task, actor, req.db)) {
                        results.push({ id: task.id, ok: false, error: STATUS_FORBIDDEN });
                        continue;
                    }
                    const target = await resolveWorkflowState(value, req.userOrgId, req.db);
                    if (!target) {
                        results.push({ id: task.id, ok: false, error: "Invalid status" });
                        continue;
                    }
                    // Re-entering the same state changes nothing: no history,
                    // audit or notification for a no-op.
                    if (String(task.workflow_state_id ?? "") === String(target.id)) {
                        results.push({ id: task.id, ok: true, previous: { workflow_state_id: task.workflow_state_id } });
                        continue;
                    }
                    // Bulk is not a way around the lifecycle: an illegal
                    // transition or a full column skips that one ticket and
                    // leaves the rest of the batch to apply.
                    const conflict = await assertLifecycleMove(req.db!, req.userOrgId, task, target, lifecycle);
                    if (conflict) {
                        results.push({ id: task.id, ok: false, error: conflict.body.error, code: conflict.body.code });
                        continue;
                    }
                    await setWorkflowState(req.db!, task.id, target.id);
                    await logHistory(task.id, req.userId, "status_change", "workflow_state", task.workflow_state_id, target.id, null, req.db);
                    await announceStatusMove(req, {
                        task,
                        from: stateOf(lifecycle, task),
                        to: target,
                        name,
                    });
                    results.push({
                        id: task.id,
                        ok: true,
                        previous: { workflow_state_id: task.workflow_state_id },
                    });
                } else if (action === "assign") {
                    const assignee = value === null || value === "" ? null : Number.parseInt(String(value), 10);
                    await setAssignee(req.db!, task.id, assignee);
                    await logHistory(task.id, req.userId, "updated", "assigned_to", task.assigned_to, assignee, null, req.db);
                    results.push({ id: task.id, ok: true, previous: { assigned_to: task.assigned_to } });
                } else {
                    if (!await canCancelTask(task, actor, req.db)) {
                        results.push({ id: task.id, ok: false, error: ACCESS_DENIED });
                        continue;
                    }
                    // Cancelling is for open work: a ticket that already reached
                    // a terminal state was finished or already abandoned, and
                    // re-stating it would rewrite what happened.
                    if (task.completed_at) {
                        results.push({
                            id: task.id,
                            ok: false,
                            error: "This ticket is already completed or cancelled",
                            code: "TASK_COMPLETED",
                        });
                        continue;
                    }
                    // Tickets are cancelled, never hard-deleted: the record and
                    // its history stay readable, and the move is reversible.
                    const cancelled = await getOrCreateCancelledState(req.userOrgId, req.db);
                    if (!cancelled) {
                        results.push({ id: task.id, ok: false, error: "No cancelled workflow state is available" });
                        continue;
                    }
                    const conflict = await assertLifecycleMove(req.db!, req.userOrgId, task, cancelled, lifecycle);
                    if (conflict) {
                        results.push({ id: task.id, ok: false, error: conflict.body.error, code: conflict.body.code });
                        continue;
                    }
                    await setWorkflowState(req.db!, task.id, cancelled.id);
                    await logHistory(task.id, req.userId, "cancelled", "workflow_state", task.workflow_state_id, cancelled.id, null, req.db);
                    await announceStatusMove(req, {
                        task,
                        from: stateOf(lifecycle, task),
                        to: cancelled,
                        name,
                        audit: "cancel",
                        action: "updated",
                    });
                    results.push({
                        id: task.id,
                        ok: true,
                        previous: { workflow_state_id: task.workflow_state_id },
                    });
                }
            } catch (err) {
                results.push({ id: task.id, ok: false, error: (err as Error).message });
            }
        }

        const changed = results.filter((result) => result.ok);
        res.json({
            action,
            requested: ids.length,
            changed: changed.length,
            failed: results.length - changed.length,
            results,
        });
    } catch (err) {
        req.log.error({ err }, "Error applying bulk action:");
        res.status(500).json({ error: "Failed to apply bulk action" });
    }
});

export = router;
