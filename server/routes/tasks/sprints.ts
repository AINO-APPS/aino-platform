// Sprint-related task routes:
//   GET   /available-sprints     — sprints the requester can target
//   PATCH /:id/assign-sprint     — move a task into / out of a sprint

import express from "express";
import type { Request, Response } from "express";
import type { TransactionContext } from "../../types/domain";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
const { requireFeature } = require('../../middleware/tenant');

const { canAccessTask, denyTaskAccess } = require("./_helpers/access");
const { isOrgAdmin, taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const { enrichTasks } = require('./_helpers/enrich');
const { materialiseTeamSprints } = require('./_helpers/sprintMaterialise');
const { buildTaskCollection } = require('../../modules/tasks/tasks.collection');
const { findTask, findSprintInOrg } = require('../../modules/tasks/tasks.sprintRepository');
const { placeTickets } = require('../../modules/tasks/tasks.placement');
const { placementContext, placedOrThrow, sendPlacementRefusal } = require('./_helpers/placement');

const router = express.Router();

// Both routes below are part of the Agile feature bundle — same gate as
// /api/sprints and /api/agile. Applied per-route (NOT router.use) because
// this sub-router is mounted at '/' under /api/tasks and a router-level
// gate would block every non-agile task route too. Without this gate a
// tenant with "Agile & Sprints" disabled could still list (and even
// auto-materialise!) sprints, which is why the mobile app kept showing the
// Sprint tab after the feature override was turned off.
const requireAgile = requireFeature('agile');

// ─── Get available sprints for user's team (current + future) ────────────
router.get('/available-sprints', requireAgile, auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const callerIsOrgAdmin = !!req.userOrgId && isOrgAdmin(req.userRole);

        // Org admins see every active/planned sprint across all teams in their org
        // (so they can move service-desk tickets into any team's sprint). For any
        // team in the org that has a sprint_start_date configured but no sprint
        // rows yet, auto-materialise the current + next sprint so admins don't
        // have to wait for a team member to visit the Tasks page first.
        if (callerIsOrgAdmin) {
            const teamsNeedingSprints = (await req.db!.query(`
                SELECT t.id, t.name, t.sprint_start_date, t.sprint_duration_weeks
                FROM teams t
                LEFT JOIN sprints s
                       ON s.team_id = t.id AND s.status IN ('active', 'planned')
                WHERE t.org_id = $1
                  AND t.sprint_start_date IS NOT NULL
                  AND s.id IS NULL
            `, [req.userOrgId])).rows;
            for (const team of teamsNeedingSprints) {
                try { await materialiseTeamSprints(team, req); }
                catch (e) { req.log.warn({ err: e, teamId: team.id }, 'Failed to auto-materialise sprints for team'); }
            }

            const orgSprints = (await req.db!.query(`
                SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.goal, s.team_id,
                       s.sprint_number, t.name as team_name
                FROM sprints s
                JOIN teams t ON t.id = s.team_id
                WHERE t.org_id = $1 AND s.status IN ('active', 'planned')
                ORDER BY t.name ASC, s.start_date ASC
            `, [req.userOrgId])).rows;
            return res.json(orgSprints);
        }

        if (!req.userTeamId) return res.json([]);

        const sprints = (await req.db!.query(`
            SELECT s.id, s.name, s.start_date, s.end_date, s.status, s.goal,
                   s.team_id, s.sprint_number, t.name AS team_name
            FROM sprints s
            JOIN teams t ON t.id = s.team_id
            WHERE s.team_id = $1 AND s.status IN ('active', 'planned')
            ORDER BY s.start_date ASC
        `, [req.userTeamId])).rows;

        if (sprints.length === 0) {
            const team = (await req.db!.query(
                'SELECT id, sprint_start_date, sprint_duration_weeks FROM teams WHERE id = $1',
                [req.userTeamId]
            )).rows[0];
            const autoSprints = await materialiseTeamSprints(team, req);
            return res.json(autoSprints);
        }

        res.json(sprints);
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching available sprints:');
        res.status(500).json({ error: 'Failed to fetch sprints' });
    }
});

// ─── Assign task to sprint ────────────────────────────────────────────────
router.patch('/:id/assign-sprint', requireAgile, auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { sprint_id } = req.body;

        const task = await findTask(req.db!, id);
        if (!await canAccessTask(task, taskActorFromRequest(req), req.db)) return denyTaskAccess(res, task, taskActorFromRequest(req));

        const leaving = sprint_id === null || sprint_id === undefined || sprint_id === '';
        if (!leaving) {
            // Org admins may target any sprint in their org; others only their
            // own team's. The org join is kept in both branches (Bug #7).
            const sprint = await findSprintInOrg(req.db!, sprint_id, req.userOrgId);
            if (!sprint || (!isOrgAdmin(req.userRole) && sprint.team_id !== req.userTeamId)) {
                return res.status(400).json({ error: 'Invalid sprint or sprint does not belong to your team' });
            }
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