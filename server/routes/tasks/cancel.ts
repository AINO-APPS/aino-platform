// ─── Cancel a task (tickets are never hard-deleted) ──────────────────────
//
// Jira's model: work is completed or cancelled, and the record stays so
// history, comments, time entries and links keep making sense. A hard delete
// silently destroys all of that and cannot be undone, so `DELETE /api/tasks/:id`
// cancels instead: the ticket moves to the org's terminal "Cancelled" state,
// which takes it out of the backlog and the board's columns while keeping it
// readable afterwards.
//
// Extracted from the CRUD router so the write rule has one home and the CRUD
// file stays within the size ratchet.

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
const { logHistory } = require('./_helpers/logHistory');
const { ticketActionConflict } = require('./_helpers/access');
const { taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const { findActorName, findTask, setWorkflowState } = require('../../modules/tasks/tasks.repository');
const { getOrCreateCancelledState } = require('./_helpers/agile');
const { assertLifecycleMove, stateOf } = require('../../modules/tasks/tasks.workflow');
const { loadTicketDecisionContext } = require('../../modules/tasks/tasks.capabilities');
const { announceStatusMove } = require('./_helpers/statusEvents');
const { enrichTasks } = require('./_helpers/enrich');

const router = express.Router();

router.delete('/:id', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
        const task = await findTask(req.db!, id);
        if (!task) return res.status(404).json({ error: 'Task not found' });
        const cancelled = await getOrCreateCancelledState(req.userOrgId, req.db);
        if (!cancelled) return res.status(400).json({ error: 'No cancelled workflow state is available' });
        const actor = taskActorFromRequest(req);
        const context = await loadTicketDecisionContext(req.db!, actor, [task]);
        const refusal = await ticketActionConflict(req.db!, actor, task, "cancel", context);
        if (refusal) return res.status(refusal.status).json(refusal.body);

        // Cancel is a transition like any other: the graph must allow it (Done
        // is refused above) and the target has no WIP limit.
        const lifecycle = context.lifecycle;
        const conflict = await assertLifecycleMove(req.db!, req.userOrgId, task, cancelled, lifecycle, actor, context);
        if (conflict) return res.status(conflict.status).json(conflict.body);

        const name = await findActorName(req.db!, req.userId);
        await setWorkflowState(req.db!, id, cancelled.id);
        await logHistory(id, req.userId, 'cancelled', 'workflow_state', task.workflow_state_id, cancelled.id, null, req.db);

        const updated = await findTask(req.db!, id);
        const enriched = await enrichTasks([updated], req.db, actor, lifecycle);
        await announceStatusMove(req, {
            task: updated,
            from: stateOf(lifecycle, task),
            to: cancelled,
            name,
            audit: 'cancel',
            action: 'updated',
            fields: { workflow_state_id: cancelled.id },
        });
        res.json({ cancelled: true, id, task: enriched[0] });
    } catch (err) {
        req.log.error({ err: err }, 'Error cancelling task:');
        res.status(500).json({ error: 'Failed to cancel task' });
    }
});

export = router;
