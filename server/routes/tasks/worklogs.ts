import express from "express";
import type { Request, Response } from "express";
import { taskActorFromRequest } from "../../modules/tasks/tasks.policy";
import { getTicketWorklogs, logWork, editWorklog, deleteWorklog, InvalidWorklog } from "../../modules/tasks/tasks.worklogs";
import { InvalidDuration } from "../../modules/tasks/tasks.duration";
import { getTask } from "../../modules/tasks/tasks.service";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { canAccessTask, denyTaskAccess } = require("./_helpers/access");
const router = express.Router();

function worklogRouteIds(req: Request) {
    const ids = [req.params.id, req.params.worklogId].map(value => Number(value));
    if (ids.some(id => !Number.isInteger(id) || id < 1 || id > 2_147_483_647))
        throw new InvalidWorklog('Enter valid ticket and worklog identifiers.');
    return ids;
}

router.get("/:id/worklogs", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const actor = taskActorFromRequest(req);
        const task = await getTask(req.db!, String(req.params.id));
        if (!task) return res.status(404).json({ error: "Task not found" });
        if (!await canAccessTask(task, actor, req.db)) return denyTaskAccess(res, task, actor);
        res.json(await getTicketWorklogs(req.db!, task.id, actor.orgId, actor));
    } catch (err) {
        req.log.error({ err }, "Error reading ticket worklogs");
        res.status(500).json({ error: "Failed to fetch worklogs" });
    }
});
router.post('/:id/worklogs', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const result = await logWork({ query: req.db!.query, transaction: req.db!.transaction! }, Number(req.params.id), taskActorFromRequest(req), req.body, {
            tenantId: req.tenantId == null ? null : Number(req.tenantId), ip: req.ip, userAgent: req.get('user-agent'),
        });
        if ('conflict' in result && result.conflict) return res.status(result.conflict.status).json(result.conflict.body);
        return res.status(201).json(result);
    } catch (err) {
        if (err instanceof InvalidDuration || err instanceof InvalidWorklog) return res.status(400).json({ code: err.code, error: err.message });
        req.log.error({ err }, 'Error logging work');
        return res.status(500).json({ error: 'Failed to log work' });
    }
});
router.patch('/:id/worklogs/:worklogId', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const [taskId, worklogId] = worklogRouteIds(req);
        const result = await editWorklog({ query: req.db!.query, transaction: req.db!.transaction! }, taskId, worklogId, taskActorFromRequest(req), req.body, {
            tenantId: req.tenantId == null ? null : Number(req.tenantId), ip: req.ip, userAgent: req.get('user-agent'),
        });
        if ('conflict' in result && result.conflict) return res.status(result.conflict.status).json(result.conflict.body);
        return res.json(result);
    } catch (err) {
        if (err instanceof InvalidDuration || err instanceof InvalidWorklog) return res.status(400).json({ code: err.code, error: err.message });
        req.log.error({ err }, 'Error editing worklog');
        return res.status(500).json({ error: 'Failed to edit worklog' });
    }
});
router.delete('/:id/worklogs/:worklogId', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const [taskId, worklogId] = worklogRouteIds(req);
        const result = await deleteWorklog({ query: req.db!.query, transaction: req.db!.transaction! }, taskId, worklogId, taskActorFromRequest(req), req.body, {
            tenantId: req.tenantId == null ? null : Number(req.tenantId), ip: req.ip, userAgent: req.get('user-agent'),
        });
        if ('conflict' in result && result.conflict) return res.status(result.conflict.status).json(result.conflict.body);
        return res.json(result);
    } catch (err) {
        if (err instanceof InvalidWorklog) return res.status(400).json({ code: err.code, error: err.message });
        req.log.error({ err }, 'Error deleting worklog');
        return res.status(500).json({ error: 'Failed to delete worklog' });
    }
});
export = router;
