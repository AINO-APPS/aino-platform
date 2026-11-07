// Task time tracking.
//   GET  /api/tasks/:id/timer        — is a timer running for this task?
//   POST /api/tasks/:id/timer/start  — start a timer attributed to this task
//   POST /api/tasks/:id/timer/stop   — stop it and add the elapsed minutes
//
// Deprecated compatibility adapter: stopping records a worklog atomically.
// Response shapes remain unchanged; stored ticket totals are never written.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");

const { canAccessTask, denyTaskAccess, ticketActionConflict } = require("./_helpers/access");
const { taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const { summariseTime, findRunningTimer, startTimer } = require("../../modules/tasks/tasks.time");
const { getTimeSpent, stopLegacyTimer } = require("../../modules/tasks/tasks.worklogs");
const { getOffsetMin } = require("../../utils/timezone");
const { findTask } = require("../../modules/tasks/tasks.repository");

const router = express.Router();

async function loadTask(req: Request, res: Response) {
    const task = await findTask(req.db!, req.params.id);
    if (!await canAccessTask(task, taskActorFromRequest(req), req.db)) {
        denyTaskAccess(res, task, taskActorFromRequest(req));
        return null;
    }
    if (req.method !== "GET") {
        const refusal = await ticketActionConflict(req.db!, taskActorFromRequest(req), task, "logWork");
        if (refusal) {
            res.status(refusal.status).json(refusal.body);
            return null;
        }
    }
    const totals = await getTimeSpent(req.db!, [task.id], taskActorFromRequest(req).orgId);
    return { ...task, logged_minutes: totals[task.id] ?? 0 };
}

router.get("/:id/timer", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const task = await loadTask(req, res);
        if (!task) return;

        const running = await findRunningTimer(req.db!, task.id, req.userId, taskActorFromRequest(req).orgId);

        res.json({
            taskId: task.id,
            running: !!running,
            startedAt: running?.started_at || null,
            time: summariseTime(task),
        });
    } catch (err) {
        req.log.error({ err }, "Error reading task timer:");
        res.status(500).json({ error: "Failed to read the timer" });
    }
});

router.post("/:id/timer/start", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const task = await loadTask(req, res);
        if (!task) return;

        const startedAt = new Date().toISOString();
        await startTimer(req.db!, task.id, req.userId, startedAt, taskActorFromRequest(req).orgId);
        const running = await findRunningTimer(req.db!, task.id, req.userId, taskActorFromRequest(req).orgId);

        res.json({
            taskId: task.id,
            running: true,
            startedAt: running?.started_at || startedAt,
            time: summariseTime(task),
        });
    } catch (err) {
        req.log.error({ err }, "Error starting task timer:");
        res.status(500).json({ error: "Failed to start the timer" });
    }
});

router.post("/:id/timer/stop", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const task = await loadTask(req, res);
        if (!task) return;

        const stopped = await stopLegacyTimer(req.db!, task.id, taskActorFromRequest(req), getOffsetMin(req), new Date(), {
            tenantId: req.tenantId == null ? null : Number(req.tenantId), ip: req.ip, userAgent: req.get('user-agent'),
        });
        if (!stopped) return res.status(409).json({ error: "No timer is running for this task" });

        res.json({ taskId: task.id, running: false, ...stopped });
    } catch (err) {
        req.log.error({ err }, "Error stopping task timer:");
        res.status(500).json({ error: "Failed to stop the timer" });
    }
});

export = router;
