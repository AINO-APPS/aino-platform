// Git refs on a task (Stage 3).
//   GET    /:id/git              — list branches, PRs, commits linked to the task
//   POST   /:id/git              — manually link a branch/PR/commit
//   DELETE /:id/git/:refId       — unlink (manager+ or creator)

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
const { loadAccessibleTask } = require('./_helpers/access');
import * as taskService from "../../modules/tasks/tasks.service";

const router = express.Router();

router.get('/:id/git', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        res.json(await taskService.listGitRefs(req.db!, id));
    } catch (err) {
        req.log.error({ err }, 'Failed to list git refs');
        res.status(500).json({ error: 'Failed to list git refs' });
    }
});

router.post('/:id/git', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        const { ref_type, external_id, title, url, repository, ref_name, status } = req.body || {};
        if (!['branch', 'pull_request', 'commit'].includes(ref_type)) {
            return res.status(400).json({ error: 'ref_type must be branch | pull_request | commit' });
        }
        res.json(await taskService.addGitRef(req.db!, id, {
            ref_type, external_id, title, url, repository, ref_name, status,
        }));
    } catch (err) {
        req.log.error({ err }, 'Failed to link git ref');
        res.status(500).json({ error: 'Failed to link git ref' });
    }
});

router.delete('/:id/git/:refId', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        const refId = parseInt(String(req.params.refId), 10);
        if (isNaN(id) || isNaN(refId)) return res.status(400).json({ error: 'Invalid id' });
        const task = await loadAccessibleTask(req, res, id);
        if (!task) return;
        if (await taskService.removeGitRef(req.db!, id, refId) === 0) return res.status(404).json({ error: 'Git ref not found' });
        res.json({ ok: true });
    } catch (err) {
        req.log.error({ err }, 'Failed to delete git ref');
        res.status(500).json({ error: 'Failed to delete git ref' });
    }
});

export = router;