// Sprint scope baselines.
//   GET  /api/sprints/:id/baseline  — the latest baseline plus the scope delta
//   POST /api/sprints/:id/baseline  — re-record after an explicit scope change
//
// A completed sprint's baseline is immutable.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../middleware/auth");
const { loadUserContext, requireRole } = require("../middleware/rbac");
const {
    captureBaseline,
    scopeDelta,
} = require("../modules/tasks/tasks.baseline");

const router = express.Router();

async function loadSprint(req: Request, res: Response) {
    const sprint = (await req.db!.query(
        "SELECT s.* FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id = $2",
        [req.params.id, req.userOrgId],
    )).rows[0];
    if (!sprint) {
        res.status(404).json({ error: "Sprint not found" });
        return null;
    }
    return sprint;
}

async function sprintTasks(req: Request, sprintId: unknown) {
    return (await req.db!.query(
        "SELECT id, story_points FROM tasks WHERE sprint_id = $1",
        [sprintId],
    )).rows;
}

router.get("/:id/baseline", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const sprint = await loadSprint(req, res);
        if (!sprint) return;

        const baseline = (await req.db!.query(
            `SELECT committed_points, committed_task_ids, reason, captured_at
               FROM sprint_baselines
              WHERE sprint_id = $1
              ORDER BY captured_at DESC, id DESC
              LIMIT 1`,
            [sprint.id],
        )).rows[0] ?? null;

        const current = await sprintTasks(req, sprint.id);
        res.json({
            baseline,
            delta: scopeDelta(baseline, current),
        });
    } catch (err) {
        req.log.error({ err }, "Error reading sprint baseline:");
        res.status(500).json({ error: "Failed to read the sprint baseline" });
    }
});

router.post("/:id/baseline", auth, loadUserContext, requireRole("team_lead"), async (req: Request, res: Response) => {
    try {
        const sprint = await loadSprint(req, res);
        if (!sprint) return;

        // A completed sprint's record is immutable.
        if (sprint.status === "completed") {
            return res.status(409).json({
                error: "A completed sprint's baseline cannot change.",
                code: "SPRINT_FROZEN",
            });
        }

        const reason = ["start", "scope_add", "scope_remove"].includes(req.body?.reason)
            ? req.body.reason
            : "start";
        const current = await sprintTasks(req, sprint.id);
        const baseline = captureBaseline(current);

        await req.db!.query(
            `INSERT INTO sprint_baselines (sprint_id, committed_points, committed_task_ids, reason)
             VALUES ($1, $2, $3::jsonb, $4)`,
            [sprint.id, baseline.committed_points, JSON.stringify(baseline.committed_task_ids), reason],
        );

        res.json({ baseline: { ...baseline, reason } });
    } catch (err) {
        req.log.error({ err }, "Error recording sprint baseline:");
        res.status(500).json({ error: "Failed to record the sprint baseline" });
    }
});

export = router;
