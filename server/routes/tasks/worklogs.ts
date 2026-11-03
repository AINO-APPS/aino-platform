import express from "express";
import type { Request, Response } from "express";
import { taskActorFromRequest } from "../../modules/tasks/tasks.policy";
import { getTicketWorklogs } from "../../modules/tasks/tasks.worklogs";
import { getTask } from "../../modules/tasks/tasks.service";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { canAccessTask, denyTaskAccess } = require("./_helpers/access");
const router = express.Router();

router.get("/:id/worklogs", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const actor = taskActorFromRequest(req);
        const task = await getTask(req.db!, String(req.params.id));
        if (!task) return res.status(404).json({ error: "Task not found" });
        if (!await canAccessTask(task, actor, req.db)) return denyTaskAccess(res, task, actor);
        res.json(await getTicketWorklogs(req.db!, task.id, actor.orgId));
    } catch (err) {
        req.log.error({ err }, "Error reading ticket worklogs");
        res.status(500).json({ error: "Failed to fetch worklogs" });
    }
});
export = router;
