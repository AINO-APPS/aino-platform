// Task time tracking.
//   GET  /api/tasks/:id/timer        — is a timer running for this task?
//   POST /api/tasks/:id/timer/start  — start a timer attributed to this task
//   POST /api/tasks/:id/timer/stop   — stop it and add the elapsed minutes
//
// The elapsed time is written to `tasks.logged_minutes` and kept as a
// `task_timers` row, which is what the timesheet reads — so a task's logged
// time and the user's day agree.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../../middleware/auth");
const { loadUserContext } = require("../../middleware/rbac");
const { canAccessTask } = require("./_helpers/access");
const { logHistory } = require("./_helpers/logHistory");
const { elapsedMinutes, summariseTime, findRunningTimer, startTimer, stopTimer } = require("../../modules/tasks/tasks.time");
const { findTask } = require("../../modules/tasks/tasks.repository");

const router = express.Router();

async function loadTask(req: Request, res: Response) {
    const task = await findTask(req.db!, req.params.id);
    if (!await canAccessTask(task, req.userId, req.userOrgId, req.db, req.userRole)) {
        res.status(404).json({ error: "Task not found" });
        return null;
    }
    return task;
}

router.get("/:id/timer", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const task = await loadTask(req, res);
        if (!task) return;

        const running = await findRunningTimer(req.db!, task.id, req.userId);

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
        await startTimer(req.db!, task.id, req.userId, startedAt);
        const running = await findRunningTimer(req.db!, task.id, req.userId);

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

        const running = await findRunningTimer(req.db!, task.id, req.userId);
        if (!running) return res.status(409).json({ error: "No timer is running for this task" });

        const stoppedAt = new Date();
        const minutes = elapsedMinutes(running.started_at, stoppedAt);
        const updated = await stopTimer(req.db!, running.id, task.id, stoppedAt.toISOString(), minutes);

        await logHistory(task.id, req.userId, "time_logged", "logged_minutes",
            task.logged_minutes, updated.logged_minutes, null, req.db);

        res.json({
            taskId: task.id,
            running: false,
            minutes,
            time: summariseTime(updated),
        });
    } catch (err) {
        req.log.error({ err }, "Error stopping task timer:");
        res.status(500).json({ error: "Failed to stop the timer" });
    }
});

export = router;
