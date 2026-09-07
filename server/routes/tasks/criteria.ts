// Acceptance criteria stored as a JSONB array on tasks:
//   [{ id, text, done, doneAt, doneBy }]
//
//   GET /:id/acceptance-criteria
//   PUT /:id/acceptance-criteria  { criteria: [...] }
//
// Bug #12 (Stage 2): we now share a single normaliser with the create/update
// paths so the shape is byte-identical regardless of which endpoint wrote
// the row.

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');

const { loadAccessibleTask } = require('./_helpers/access');
const { normalizeAcceptanceCriteria } = require('./_helpers/agile');
import * as taskService from "../../modules/tasks/tasks.service";

const router = express.Router();

router.get('/:id/acceptance-criteria', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        res.json({ criteria: task.acceptance_criteria || [] });
    } catch (err) {
        req.log.error({ err }, 'Error fetching criteria');
        res.status(500).json({ error: 'Failed to fetch acceptance criteria' });
    }
});

router.put('/:id/acceptance-criteria', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        const { criteria } = req.body || {};
        if (!Array.isArray(criteria)) return res.status(400).json({ error: 'criteria must be an array' });
        // Single source of truth for normalisation (Bug #12).
        const cleaned = normalizeAcceptanceCriteria(criteria) || [];
        res.json(await taskService.updateCriteria(req.db!, id, req.userId!, cleaned));
    } catch (err) {
        req.log.error({ err }, 'Error updating criteria');
        res.status(500).json({ error: 'Failed to update acceptance criteria' });
    }
});

export = router;