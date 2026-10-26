// Sprint completion pre-flight.
//   GET /api/sprints/:id/completion-preview
//
// Shows what will happen before it happens: which unfinished tasks move, where
// to, and which finished work stays with the closed sprint.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../middleware/auth");
const { loadUserContext } = require("../middleware/rbac");
const { requireTenant, requireFeature } = require("../middleware/tenant");
const { planCarryover } = require("../modules/tasks/tasks.sprintLifecycle");
const {
    findSprintInOrg,
    findSprintCarryoverTasks,
    findNextPlannedSprint,
} = require("../modules/tasks/tasks.sprintRepository");
const { canAccessSprint, taskActorFromRequest } = require("../modules/tasks/tasks.policy");

const router = express.Router();
// Same gate as /api/sprints: this is part of the Agile bundle, so a tenant
// with Agile disabled must not reach it.
router.use(requireTenant, requireFeature("agile"));

router.get("/:id/completion-preview", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!canAccessSprint(sprint, taskActorFromRequest(req))) {
            return res.status(403).json({ error: "Access denied" });
        }

        const tasks = await findSprintCarryoverTasks(req.db!, id);

        // Default target: the next planned sprint for this team, else backlog.
        const nextPlanned = await findNextPlannedSprint(req.db!, sprint.team_id, id);

        const plan = planCarryover(tasks, nextPlanned?.id ?? null);

        res.json({
            sprint: { id: sprint.id, name: sprint.name, status: sprint.status },
            defaultTarget: plan.target,
            moving: plan.moving,
            staying: plan.staying,
            movingPoints: plan.movingPoints,
        });
    } catch (err) {
        req.log.error({ err }, "Error building completion preview:");
        res.status(500).json({ error: "Failed to build completion preview" });
    }
});

export = router;
