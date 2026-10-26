// Resolve a canonical issue key (PROJ-123) to its task.
//   GET /api/tasks/by-key/:key
//
// Keys are stable across sprint moves because they derive from the project and
// the task's reserved number, neither of which a sprint move touches.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");

const { canAccessTask, denyTaskAccess } = require("./_helpers/access");
const { taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const { enrichTasks } = require("./_helpers/enrich");
const { findByIssueKey } = require("../../modules/tasks/tasks.repository");

const router = express.Router();

const KEY_PATTERN = /^([A-Za-z][A-Za-z0-9_]{1,9})-(\d+)$/;

router.get("/by-key/:key", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const match = String(req.params.key).match(KEY_PATTERN);
        if (!match) return res.status(400).json({ error: "Invalid issue key" });

        const task = await findByIssueKey(
            req.db!,
            req.userOrgId,
            match[1].toUpperCase(),
            Number.parseInt(match[2], 10),
        );

        if (!task) return res.status(404).json({ error: "Task not found" });
        if (!await canAccessTask(task, taskActorFromRequest(req), req.db)) {
            return denyTaskAccess(res, task, taskActorFromRequest(req));
        }

        const enriched = await enrichTasks([task], req.db);
        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err }, "Error resolving issue key:");
        res.status(500).json({ error: "Failed to resolve issue key" });
    }
});

export = router;
