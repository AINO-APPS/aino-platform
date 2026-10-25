// Sprint completion pre-flight.
//   GET /api/sprints/:id/completion-preview
//
// Shows what will happen before it happens: which unfinished tasks move, where
// to, and which finished work stays with the closed sprint.

import express from "express";
import type { Request, Response } from "express";
const auth = require("../middleware/auth");
const { loadUserContext } = require("../middleware/rbac");
const { planCarryover } = require("../modules/tasks/tasks.sprintLifecycle");

const router = express.Router();

router.get("/:id/completion-preview", auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const sprint = (await req.db!.query(
            "SELECT s.* FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id = $2",
            [id, req.userOrgId],
        )).rows[0];
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });

        const tasks = (await req.db!.query(
            `SELECT t.id, t.title, t.story_points, (t.completed_at IS NOT NULL) AS completed
               FROM tasks t
              WHERE t.sprint_id = $1
              ORDER BY t.created_at ASC`,
            [id],
        )).rows;

        // Default target: the next planned sprint for this team, else backlog.
        const nextPlanned = (await req.db!.query(
            `SELECT id FROM sprints
              WHERE team_id = $1 AND status = 'planned' AND id <> $2
              ORDER BY start_date ASC
              LIMIT 1`,
            [sprint.team_id, id],
        )).rows[0];

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
