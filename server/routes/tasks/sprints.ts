// Sprint-related task routes:
//   GET   /available-sprints     — sprints the requester can target
//   PATCH /:id/assign-sprint     — move a task into / out of a sprint

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
const { requireFeature } = require('../../middleware/tenant');

const { logHistory } = require('./_helpers/logHistory');

const { canAccessTask, denyTaskAccess } = require("./_helpers/access");
const { isOrgAdmin, taskActorFromRequest } = require('../../modules/tasks/tasks.policy');
const {
    canMoveIntoTeamSprint,
    sprintTeamMismatchBody,
    teamAfterSprintMove,
} = require('../../modules/tasks/tasks.ownership');
const { enrichTasks } = require('./_helpers/enrich');
const { materialiseTeamSprints } = require('./_helpers/sprintMaterialise');
const { buildTaskCollection } = require('../../modules/tasks/tasks.collection');
const { taskNotificationLink, describeSprintTaskAdded } = require('../../modules/tasks/tasks.notifications');
const { notifyUser } = require('../../realtime/fanout');
const {
    findTask, findSprintName, findSprintInOrg, setSprintAndDueDate, clearSprint,
} = require('../../modules/tasks/tasks.sprintRepository');

const router = express.Router();

/**
 * Tell the assignee they were added to a sprint.
 *
 * Only the assignee — the rest of the team already sees the sprint on their
 * board, and a notification per ticket would be noise.
 */
async function notifySprintTaskAdded(req: Request, task: any, sprint: any): Promise<void> {
    const { title, body, audience } = describeSprintTaskAdded({ task, sprint, actorId: req.userId });
    for (const userId of audience) {
        await notifyUser(
            req.db,
            req.tenantId,
            userId,
            "sprint",
            title,
            body,
            { link: taskNotificationLink(task.id), linkTaskId: task.id, actorId: req.userId },
        ).catch(() => undefined);
    }
}

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

        if (sprint_id === null || sprint_id === undefined || sprint_id === '') {
            const oldSprint = task.sprint_id ? await findSprintName(req.db!, task.sprint_id) : null;
            await clearSprint(req.db!, task.id);
            await logHistory(id, req.userId, 'updated', 'sprint', oldSprint?.name || 'none', 'none', null, req.db);
        } else {
            // Org admins can assign to any sprint within their org; others limited to own team.
            // Bug #7 (Stage 2): the non-admin branch previously looked sprints
            // up globally by id (no org filter). With a colliding team_id across
            // tenants you could in theory attach to another org's sprint. Join
            // through teams in both branches so the org filter is always applied.
            const sprint = await findSprintInOrg(req.db!, sprint_id, req.userOrgId);
            if (!sprint || (!isOrgAdmin(req.userRole) && sprint.team_id !== req.userTeamId)) {
                return res.status(400).json({ error: 'Invalid sprint or sprint does not belong to your team' });
            }
            // A ticket may only join its own team's sprint. Crossing teams is an
            // explicit admin transfer, never a side effect of a sprint move.
            if (!canMoveIntoTeamSprint(task.team_id, sprint.team_id)) {
                return res.status(409).json(sprintTeamMismatchBody());
            }
            const oldSprint = task.sprint_id ? await findSprintName(req.db!, task.sprint_id) : null;
            if (task.due_date !== sprint.end_date) {
                await logHistory(id, req.userId, 'updated', 'due_date', task.due_date, sprint.end_date, null, req.db);
            }
            await setSprintAndDueDate(
                req.db!, task.id, sprint.id, sprint.end_date,
                task.team_id == null ? teamAfterSprintMove(task.team_id, sprint.team_id) : null,
            );
            await logHistory(id, req.userId, 'updated', 'sprint', oldSprint?.name || 'none', sprint.name, null, req.db);
            // Being added to a sprint is one of the five events worth telling
            // people about; the assignee hears it unless they did it themselves.
            const assigned = await findTask(req.db!, id);
            await notifySprintTaskAdded(req, assigned, sprint);
        }

        const updated = await findTask(req.db!, id);
        const enriched = await enrichTasks([updated], req.db);
        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err: err }, 'Error assigning sprint:');
        res.status(500).json({ error: 'Failed to assign sprint' });
    }
});

export = router;