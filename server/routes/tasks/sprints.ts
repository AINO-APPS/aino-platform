import { requireScrumSprint } from "../_helpers/projectSprint";
// Sprint-related task routes:
//   GET   /available-sprints     — sprints the requester can target
//   PATCH /:id/assign-sprint     — move a task into / out of a sprint

import express from "express";
import type { Request, Response } from "express";
import type { TransactionContext } from "../../types/domain";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');


const { ticketActionConflict, denyTaskAccess } = require("./_helpers/access");
const { taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const { enrichTasks } = require('./_helpers/enrich');
const { findTask } = require('../../modules/tasks/tasks.sprintRepository');
const { findSprintsForProjects } = require('../../modules/tasks/tasks.sprintRepository');
const { sprintProjectIds } = require('../../modules/tasks/tasks.sprintProjects');
const { resolveSprintTarget } = require('../../modules/tasks/tasks.sprintAssignment');
const { placeTickets } = require('../../modules/tasks/tasks.placement');
const { placementContext, placedOrThrow, sendPlacementRefusal } = require('./_helpers/placement');

const router = express.Router();

// ─── Get available sprints for projects the actor can access ─────────────
router.get('/available-sprints', auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const actor = taskActorFromRequest(req);
        const ids = await sprintProjectIds(actor, req.query);
        const sprints = await findSprintsForProjects(req.db!, actor.orgId, ids);
        return res.json(sprints.filter((sprint: any) =>
            ["active", "planned", "paused"].includes(sprint.status)));
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching available sprints:');
        res.status(500).json({ error: 'Failed to fetch sprints' });
    }
});

// ─── Assign task to sprint ────────────────────────────────────────────────
router.patch('/:id/assign-sprint', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { sprint_id } = req.body;

        const task = await findTask(req.db!, id);
        const actor = taskActorFromRequest(req);
        if (!task) return denyTaskAccess(res, task, actor);
        const refusal = await ticketActionConflict(req.db!, actor, task, "placeInSprint");
        if (refusal) return res.status(refusal.status).json(refusal.body);

        const leaving = sprint_id === null || sprint_id === undefined || sprint_id === '';
        if (!leaving) {
            const target = await resolveSprintTarget(req.db!, {
                sprintId: sprint_id, orgId: actor.orgId, ticket: task, actor,
            });
            if (target.error) return res.status(target.error.status).json(target.error.body);
        }

        // Team rule, due-date bookkeeping, history, audit, realtime and the
        // sprint-added notification all live in the placement module.
        const placed = await req.db!.transaction!(async (client: any, { afterCommit }: TransactionContext) =>
            placedOrThrow(await placeTickets(
                placementContext(req, client, afterCommit),
                [task.id],
                { sprint: leaving ? null : Number(sprint_id) },
            )));

        const enriched = await enrichTasks([placed.task], req.db, taskActorFromRequest(req));
        res.json(enriched[0]);
    } catch (err) {
        if (sendPlacementRefusal(res, err)) return;
        req.log.error({ err: err }, 'Error assigning sprint:');
        res.status(500).json({ error: 'Failed to assign sprint' });
    }
});

export = router;