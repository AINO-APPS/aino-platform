// Epic ↔ Story parent / child relationships.
//   GET   /:id/children   — direct children + rollup stats
//   GET   /:id/parent     — parent summary (or null)
//   PATCH /:id/parent     — set / clear parent (with cycle check)

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');

const { loadAccessibleTask } = require('./_helpers/access');
const { taskActorFromRequest, canReadProjectTask } = require('../../modules/tasks/tasks.policy');
const { enrichTaskSummaries } = require('./_helpers/enrich');
import * as taskService from "../../modules/tasks/tasks.service";
import { createBacklogTicket } from "./backlog";
import { sendHierarchyRefusal } from "./_helpers/hierarchy";
import { setTicketParent } from "../../modules/tasks/tasks.hierarchy";

const router = express.Router();

router.post('/:id/subtasks', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        req.body = { ...req.body, work_item_type_id: "subtask", parent_task_id: req.params.id };
        return await createBacklogTicket(req, res);
    } catch (error) {
        if (sendHierarchyRefusal(res, error)) return;
        req.log.error({ err: error }, "Error creating subtask");
        res.status(500).json({ error: "Failed to create subtask" });
    }
});

// GET /tasks/:id/children — list direct children of this task (any tickets
// whose parent_task_id matches). Used by the Epic detail panel.
router.get('/:id/children', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        const result = await taskService.getChildren(req.db!, id, taskActorFromRequest(req));
        res.json({
            ...result,
            children: await enrichTaskSummaries(result.children, req.db, taskActorFromRequest(req)),
        });
    } catch (err) {
        req.log.error({ err }, 'Error fetching children');
        res.status(500).json({ error: 'Failed to fetch children' });
    }
});

// GET /tasks/:id/parent — fetch the parent task summary (for non-epic tickets
// to render a clickable "Part of" link).
router.get('/:id/parent', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        if (!task.parent_task_id) return res.json({ parent: null });
        const parent = await taskService.getParent(req.db!, task.parent_task_id);
        const enrichedParent = parent && await canReadProjectTask(parent, taskActorFromRequest(req))
            ? (await enrichTaskSummaries([parent], req.db, taskActorFromRequest(req)))[0]
            : null;
        res.json({ parent: enrichedParent });
    } catch (err) {
        req.log.error({ err }, 'Error fetching parent');
        res.status(500).json({ error: 'Failed to fetch parent' });
    }
});

// PATCH /tasks/:id/parent — set/clear the parent. Body: { parent_task_id: <id|null> }
// Validates the candidate parent exists in the same org, isn't the task itself,
// and isn't a descendant (so we don't create cycles).
router.patch('/:id/parent', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        const raw = req.body?.parent_task_id;
        const newParentId = await req.db!.transaction!((client: any) =>
            setTicketParent(client, id, req.userOrgId ?? null, raw, req.userId!, taskActorFromRequest(req)));
        res.json({ id, parent_task_id: newParentId });
    } catch (err) {
        if (sendHierarchyRefusal(res, err)) return;
        req.log.error({ err }, 'Error setting parent');
        res.status(500).json({ error: 'Failed to set parent' });
    }
});

export = router;