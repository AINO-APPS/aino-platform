// Block / unblock toggle for a task.
//   PATCH /:id/block   { is_blocked: bool, blocked_reason?: string }

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');

const { loadAccessibleTask } = require('./_helpers/access');
import * as taskService from "../../modules/tasks/tasks.service";

const router = express.Router();

router.patch('/:id/block', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        const { is_blocked, blocked_reason } = req.body || {};
        const flag = !!is_blocked;
        const reason = flag ? (typeof blocked_reason === 'string' ? blocked_reason.slice(0, 500) : null) : null;
        res.json(await taskService.updateBlocker(req.db!, id, req.userId!, flag, reason));
    } catch (err) {
        req.log.error({ err }, 'Error toggling blocker');
        res.status(500).json({ error: 'Failed to update blocker' });
    }
});

export = router;