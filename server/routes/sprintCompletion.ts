import { requireScrumSprint } from "./_helpers/projectSprint";
// Sprint completion pre-flight.
//   GET /api/sprints/:id/completion-preview
//
// Shows what will move and which terminal work stays with the closed sprint.

import express from "express";
import type { Request, Response } from "express";
import { parseSprintCompletionTarget } from "../services/sprintCompletion";
import { carryoverSprintName, planCarryover, sprintDurationDays } from "../modules/tasks/tasks.sprintLifecycle";
const auth = require("../middleware/auth");
const { loadUserContext } = require("../middleware/rbac");
const { requireTenant } = require("../middleware/tenant");
const {
    findSprintInOrg,
    findSprintCarryoverTasks,
    findNextPlannedSprint,
    findCarryoverSprintDateRange,
} = require("../modules/tasks/tasks.sprintRepository");
const { canReadProjectSprint, taskActorFromRequest } = require("../modules/tasks/tasks.policy");

const router = express.Router();
// Same gate as /api/sprints: this is part of the Agile bundle, so a tenant
// with Agile disabled must not reach it.
router.use(requireTenant);

router.get("/:id/completion-preview", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const selected = parseSprintCompletionTarget(req.query.rolloverTo);
        if (selected === null) return res.status(400).json({ error: "Invalid rolloverTo target" });
        if (typeof selected === "number") {
            return res.status(400).json({ error: "Preview rolloverTo must be next, new, or backlog" });
        }
        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!await canReadProjectSprint(sprint, taskActorFromRequest(req))) {
            return res.status(403).json({ error: "Access denied" });
        }

        const tasks = await findSprintCarryoverTasks(req.db!, id, req.userOrgId ?? null);

        // Default target: the next planned sprint for this team, else backlog.
        const nextPlanned = await findNextPlannedSprint(req.db!, sprint.team_id, id, req.userOrgId ?? null,
            req.projectOwnership ? sprint.project_id : undefined);

        const plan = planCarryover(tasks, nextPlanned?.id ?? null, selected);
        const defaultPlan = planCarryover(tasks, nextPlanned?.id ?? null);
        const selectedTarget = plan.target === "new" ? "new"
            : plan.target === "backlog" ? "backlog"
            : "next";
        let newSprint = null;
        if (plan.target === "new") {
            const durationDays = sprintDurationDays(sprint.start_date, sprint.end_date);
            if (!durationDays || !sprint.project_id) {
                return res.status(409).json({
                    error: "Cannot create a next sprint without valid sprint dates and project ownership",
                    code: "NEW_SPRINT_UNAVAILABLE",
                });
            }
            const dates = await findCarryoverSprintDateRange(req.db!, durationDays);
            newSprint = {
                name: carryoverSprintName(String(sprint.name), sprint.id),
                start_date: dates.start_date,
                end_date: dates.end_date,
            };
        }

        res.json({
            supportsNewSprint: true,
            sprint: {
                id: sprint.id,
                name: sprint.name,
                status: sprint.status,
                start_date: sprint.start_date,
                end_date: sprint.end_date,
            },
            defaultTarget: defaultPlan.target,
            defaultTargetType: defaultPlan.target === "backlog" ? "backlog" : "next",
            selectedTarget,
            hasNext: !!nextPlanned,
            nextPlannedSprint: nextPlanned,
            moving: plan.moving,
            movingParents: plan.movingParents,
            movingSubtasks: plan.movingSubtasks,
            staying: plan.staying,
            movingPoints: plan.movingPoints,
            newSprint,
        });
    } catch (err) {
        req.log.error({ err }, "Error building completion preview:");
        res.status(500).json({ error: "Failed to build completion preview" });
    }
});

export = router;
