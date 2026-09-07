// Task detail + history endpoints:
//   GET /:id/detail   — task + comments in one shot (used by modal)
//   GET /:id/history  — change-log entries

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');

const { canAccessTask } = require('./_helpers/access');
const { enrichTasks } = require('./_helpers/enrich');
import * as taskService from "../../modules/tasks/tasks.service";

const router = express.Router();

// ─── Get single task detail ───────────────────────────────────────────────
router.get('/:id/detail', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const task = await taskService.getTask(req.db!, String(req.params.id));
        if (!await canAccessTask(task, req.userId, req.userOrgId, req.db, req.userRole)) return res.status(404).json({ error: 'Task not found' });

        const enriched = await enrichTasks([task], req.db);

        const comments = await taskService.getComments(req.db!, task.id);

        res.json({ ...enriched[0], comments });
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching task detail:');
        res.status(500).json({ error: 'Failed to fetch task detail' });
    }
});

// ─── Get task history ─────────────────────────────────────────────────────
router.get('/:id/history', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const task = await taskService.getTask(req.db!, String(req.params.id));
        if (!task) return res.status(404).json({ error: 'Task not found' });
        if (!await canAccessTask(task, req.userId, req.userOrgId, req.db, req.userRole)) return res.status(404).json({ error: 'Task not found' });

        const history = await taskService.getHistory(req.db!, String(req.params.id));

        res.json(history);
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching task history:');
        res.status(500).json({ error: 'Failed to fetch task history' });
    }
});

export = router;