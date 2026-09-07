// Epic ↔ Story parent / child relationships.
//   GET   /:id/children   — direct children + rollup stats
//   GET   /:id/parent     — parent summary (or null)
//   PATCH /:id/parent     — set / clear parent (with cycle check)

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');

const { logHistory } = require('./_helpers/logHistory');
const { loadAccessibleTask } = require('./_helpers/access');
import * as taskService from "../../modules/tasks/tasks.service";

const router = express.Router();

// GET /tasks/:id/children — list direct children of this task (any tickets
// whose parent_task_id matches). Used by the Epic detail panel.
router.get('/:id/children', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        res.json(await taskService.getChildren(req.db!, id));
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
        res.json({ parent: parent || null });
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
        let newParentId;
        try {
            newParentId = await taskService.validateAndSetParent(req.db!, id, req.userOrgId || null, raw);
        } catch (error) {
            return res.status(400).json({ error: (error as Error).message });
        }
        await logHistory(id, req.userId, 'updated', 'parent', task.parent_task_id || 'none', newParentId || 'none', null, req.db);
        res.json({ id, parent_task_id: newParentId });
    } catch (err) {
        req.log.error({ err }, 'Error setting parent');
        res.status(500).json({ error: 'Failed to set parent' });
    }
});

export = router;