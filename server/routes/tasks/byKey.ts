// Resolve a canonical issue key (PROJ-123) to its task.
//   GET /api/tasks/by-key/:key
//
// Keys are stable across sprint moves because they derive from the project and
// the task's reserved number, neither of which a sprint move touches.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");

const { canAccessTask } = require("./_helpers/access");
const { taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const { enrichTasks } = require("./_helpers/enrich");
const { parseIssueKey, resolveIssueKey } = require("./_helpers/issueKey");

const router = express.Router();

router.get("/by-key/:key", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const key = parseIssueKey(String(req.params.key));
        if (!key) return res.status(400).json({ error: "Invalid issue key" });

        const resolved = await resolveIssueKey(key, req.userOrgId, req.db);
        if (!resolved) return res.status(404).json({ error: "Task not found" });
        const { task } = resolved;
        if (!await canAccessTask(task, taskActorFromRequest(req), req.db)) {
            return res.status(404).json({ error: "Task not found" });
        }

        const enriched = await enrichTasks([task], req.db, taskActorFromRequest(req));
        res.json({
            ...enriched[0],
            key_alias: resolved.is_alias,
            requested_key: key.raw,
        });
    } catch (err) {
        req.log.error({ err }, "Error resolving issue key:");
        res.status(500).json({ error: "Failed to resolve issue key" });
    }
});

export = router;
