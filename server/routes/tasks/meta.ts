// Lightweight read endpoints for client-side dropdowns:
//   GET /assignable-users — users in the requester's org
//   GET /labels           — labels in the requester's org (used by filters)

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
import * as taskService from "../../modules/tasks/tasks.service";

const router = express.Router();

// ─── Get assignable users (same org) ─────────────────────────────────────
router.get('/assignable-users', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const users = await taskService.getAssignableUsers(req.db!, req.userOrgId || null, req.userId!);
        res.json(users);
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching assignable users:');
        res.status(500).json({ error: 'Failed to fetch users' });
    }
});

// ─── Get labels for current user's org ───────────────────────────────────
router.get('/labels', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const labels = req.userOrgId ? await taskService.getLabels(req.db!, req.userOrgId) : [];
        res.json(labels);
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching labels:');
        res.status(500).json({ error: 'Failed to fetch labels' });
    }
});

export = router;