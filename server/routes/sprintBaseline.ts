// Sprint scope baselines.
//   GET  /api/sprints/:id/baseline  — the latest baseline plus the scope delta
//   POST /api/sprints/:id/baseline  — re-record after an explicit scope change
//
// A completed sprint's baseline is immutable.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../middleware/auth");
const { loadUserContext, requireRole } = require("../middleware/rbac");
const { requireTenant, requireFeature } = require("../middleware/tenant");
const {
    captureBaseline,
    scopeDelta,
} = require("../modules/tasks/tasks.baseline");
const {
    findSprintInOrg,
    findLatestBaseline,
    insertBaseline,
    findSprintTaskPoints,
} = require("../modules/tasks/tasks.sprintRepository");
const { canAccessSprint, taskActorFromRequest } = require("../modules/tasks/tasks.policy");

const router = express.Router();
// Same gate as /api/sprints: this is part of the Agile bundle, so a tenant
// with Agile disabled must not reach it.
router.use(requireTenant, requireFeature("agile"));

async function loadSprint(req: Request, res: Response) {
    const sprint = await findSprintInOrg(req.db!, req.params.id, req.userOrgId);
    if (!sprint) {
        res.status(404).json({ error: "Sprint not found" });
        return null;
    }
    if (!canAccessSprint(sprint, taskActorFromRequest(req))) {
        res.status(403).json({ error: "Access denied" });
        return null;
    }
    return sprint;
}

async function sprintTasks(req: Request, sprintId: unknown) {
    return findSprintTaskPoints(req.db!, sprintId);
}

router.get("/:id/baseline", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const sprint = await loadSprint(req, res);
        if (!sprint) return;

        const baseline = await findLatestBaseline(req.db!, sprint.id);

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

        await insertBaseline(
            req.db!,
            sprint.id,
            baseline.committed_points,
            baseline.committed_task_ids,
            reason,
        );

        res.json({ baseline: { ...baseline, reason } });
    } catch (err) {
        req.log.error({ err }, "Error recording sprint baseline:");
        res.status(500).json({ error: "Failed to record the sprint baseline" });
    }
});

export = router;
