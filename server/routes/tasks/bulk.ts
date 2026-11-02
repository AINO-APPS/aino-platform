// Bulk backlog actions.
//   POST /api/tasks/bulk  — body { ids, action, value }
//
// Actions: move_to_sprint, status, assign, delete. The response reports what
// changed so the client can offer one undo for the whole batch.

import express from "express";
import type { Request, Response } from "express";
import type { TransactionContext } from "../../types/domain";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { logHistory } = require("./_helpers/logHistory");
const { canAccessTask, canCancelTask, canChangeTaskStatus, STATUS_FORBIDDEN, ACCESS_DENIED } = require("./_helpers/access");
const { isOrgAdmin, taskActorFromRequest } = require("../../modules/tasks/tasks.policy");
const { resolveWorkflowState, getOrCreateCancelledState } = require("./_helpers/agile");
const {
    findActorName, findManyInOrg, setWorkflowState, setAssignee,
} = require("../../modules/tasks/tasks.repository");
const { findSprintInOrg } = require("../../modules/tasks/tasks.sprintRepository");
const { assertLifecycleMove, loadLifecycleContext, stateOf } = require("../../modules/tasks/tasks.workflow");
const { announceStatusMove } = require("./_helpers/statusEvents");
const { placeTickets } = require("../../modules/tasks/tasks.placement");
const { placementContext } = require("./_helpers/placement");
const { enrichTasks } = require("./_helpers/enrich");
import type { PlacementTarget } from "../../modules/tasks/tasks.placement";

const router = express.Router();

const ACTIONS = ["move_to_sprint", "status", "assign", "delete"] as const;
type BulkAction = (typeof ACTIONS)[number];

interface BulkResult {
    id: number;
    ok: boolean;
    ticket?: any;
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

router.post("/bulk", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const ids = parseIds(req.body?.ids);
        const action = req.body?.action as BulkAction;
        const value = req.body?.value;

        if (ids.length === 0) return res.status(400).json({ error: "No tasks selected" });
        if (!ACTIONS.includes(action)) return res.status(400).json({ error: "Unknown bulk action" });

        const tasks = await findManyInOrg(req.db!, ids, req.userOrgId);
        const actor = taskActorFromRequest(req);

        if (action === "move_to_sprint") {
            const sprintId = value === null || value === "" ? null : Number.parseInt(String(value), 10);
            const sprint = sprintId === null ? null : await findSprintInOrg(req.db!, sprintId, req.userOrgId);
            const eligible: any[] = [];
            const resultById = new Map<number, BulkResult>();
            const visibleIds = new Set<number>();

            for (const task of tasks) {
                if (!await canAccessTask(task, actor, req.db)) {
                    resultById.set(task.id, { id: task.id, ok: false, error: "Not found" });
                } else {
                    visibleIds.add(Number(task.id));
                    if (sprintId !== null && (
                    !sprint || (!isOrgAdmin(req.userRole) && Number(sprint.team_id) !== Number(req.userTeamId))
                    )) {
                        resultById.set(task.id, {
                            id: task.id,
                            ok: false,
                            error: "Invalid sprint or sprint does not belong to your team",
                        });
                    } else {
                        eligible.push(task);
                    }
                }
            }

            if (eligible.length > 0) {
                const target: PlacementTarget = sprintId === null ? { sprint: null } : { sprint: sprintId };
                const placed = await req.db!.transaction!(async (client: any, { afterCommit }: TransactionContext) =>
                    placeTickets(
                        placementContext(req, client, afterCommit),
                        eligible.map((task) => task.id),
                        target,
                    ));

                for (const result of placed) {
                    if (result.ok) {
                        const task = eligible.find((candidate) => candidate.id === result.id);
                        resultById.set(result.id, {
                            id: result.id,
                            ok: true,
                            previous: { sprint_id: task?.sprint_id },
                        });
                    } else {
                        resultById.set(result.id, {
                            id: result.id,
                            ok: false,
                            error: result.error,
                            code: result.code,
                        });
                    }
                }
            }

            const results: BulkResult[] = [];
            for (const task of tasks) {
                const result = resultById.get(task.id);
                if (result) results.push(result);
            }
            const freshTasks = await findManyInOrg(req.db!, [...visibleIds], req.userOrgId);
            const enriched = await enrichTasks(freshTasks, req.db, actor);
            const enrichedById = new Map(enriched.map((ticket: any) => [Number(ticket.id), ticket]));
            for (const result of results) {
                const ticket = enrichedById.get(result.id);
                if (ticket) result.ticket = ticket;
            }
            const changed = results.filter((result) => result.ok);
            return res.json({
                action,
                requested: ids.length,
                changed: changed.length,
                failed: results.length - changed.length,
                results,
            });
        }

        // Loaded once per batch: every ticket is validated against the same
        // graph and WIP setting, including tickets moved earlier in the loop.
        const lifecycle = await loadLifecycleContext(req.db, req.userOrgId);
        const name = await findActorName(req.db!, req.userId);
        const visibleIds = new Set<number>();

        const results: BulkResult[] = [];
        for (const task of tasks) {
            if (!await canAccessTask(task, actor, req.db)) {
                results.push({ id: task.id, ok: false, error: "Not found" });
                continue;
            }
            visibleIds.add(Number(task.id));

            try {
                if (action === "status") {
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

        const freshTasks = await findManyInOrg(req.db!, [...visibleIds], req.userOrgId);
        const enriched = await enrichTasks(freshTasks, req.db, actor, lifecycle);
        const enrichedById = new Map(enriched.map((ticket: any) => [Number(ticket.id), ticket]));
        for (const result of results) {
            const ticket = enrichedById.get(result.id);
            if (ticket) result.ticket = ticket;
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
