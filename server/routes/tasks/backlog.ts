// Backlog endpoints — tasks with `date IS NULL AND sprint_id IS NULL`.
//   GET   /backlog
//   POST  /backlog
//   PATCH /:id/schedule
//   PATCH /:id/unschedule

import express from "express";
import type { Request, Response } from "express";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
const { notifyTaskAssigned } = require('../../utils/taskNotifications');
const { buildTaskCollection, buildCompletedQuery } = require('../../modules/tasks/tasks.collection');
const { findLastCompletedSprintStart } = require('../../modules/tasks/tasks.sprintRepository');
const { resolveCreateTeamId } = require('../../modules/tasks/tasks.ownership');

const { logHistory } = require('./_helpers/logHistory');
const { canAccessTask, denyTaskAccess } = require('./_helpers/access');
const {
    isOrgAdmin,
    rejectsForeignTeamRequest,
    resolveTaskVisibility,
    taskActorFromRequest,
} = require('../../modules/tasks/tasks.policy');
const { enrichTasks } = require('./_helpers/enrich');
const { syncLabels } = require('./_helpers/labels');
const {
    validateStoryPoints,
    resolveWorkItemType,
    resolveWorkflowState,
    getInitialWorkflowState,
    getDefaultWorkItemType,
    normalizeAcceptanceCriteria,
} = require('./_helpers/agile');

interface DbLike {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
    transaction: <T = unknown>(fn: (client: any) => Promise<T>) => Promise<T>;
}

/**
 * The completed section shows the last 30 days, or the last closed sprint,
 * whichever reaches further back (D17). The client supplies its 30-day floor;
 * this widens it when the last completed sprint started earlier, so a sprint
 * that ran longer than a month does not lose its own finished work.
 */
async function resolveCompletedSince(
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }> },
    teamId: number | null | undefined,
    requested: string | undefined,
): Promise<string | undefined> {
    if (!teamId) return requested;
    const sprintStart = await findLastCompletedSprintStart(db, teamId);
    if (!sprintStart) return requested;
    if (!requested) return sprintStart;
    return sprintStart < requested ? sprintStart : requested;
}

const router = express.Router();

// ─── Backlog: Get all backlog items ───────────────────────────────────────
//
// Bug #9 (Stage 2): the backlog query previously had no LIMIT — an org with
// thousands of backlog items would pull the entire set into memory on every
// page load. We now apply LIMIT + offset pagination (defaulting to 100 rows,
// capped at 500) and return `total` / `hasMore` so the client can drive
// "load more" / pagination UI.
//
// Bug #10 (Stage 2): the label filter used to fetch every label-map row and
// JS-filter the result set. With the new pagination this would have given
// wrong totals (you'd paginate the pre-filter set then drop most of the page).
// We push the label filter into SQL via EXISTS.
router.get('/backlog', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { assignee, label, priority, status, search, include_completed, completed_since } = req.query as Record<string, string>;
        const limit = Math.max(1, Math.min(500, parseInt(String(req.query.limit), 10) || 100));
        const offset = Math.max(0, parseInt(String(req.query.offset), 10) || 0);

        const actor = taskActorFromRequest(req);
        const requestedTeamId = req.query.team_id ? parseInt(String(req.query.team_id), 10) : null;
        if (rejectsForeignTeamRequest(actor, requestedTeamId)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        const visibility = resolveTaskVisibility(actor, {
            teamId: Number.isNaN(requestedTeamId as number) ? null : requestedTeamId,
            unassigned: req.query.unassigned === '1' || req.query.unassigned === 'true',
        });

        // Completed work leaves the open list. `include_completed=1` reveals it
        // (the collapsed Completed section), optionally windowed by
        // `completed_since`. A planned date is metadata and never removes a
        // task from the backlog.
        const includeCompleted = include_completed === '1' || include_completed === 'true';
        const completedOnly = req.query.completed_only === '1' || req.query.completed_only === 'true';

        // The completed window is "the last 30 days, or the last closed sprint,
        // whichever reaches further back" (D17). The client sends its 30-day
        // floor; the server widens it to the last completed sprint's start so a
        // long sprint does not lose its own finished work.
        const completedSince = await resolveCompletedSince(
            req.db!,
            req.userTeamId,
            completed_since || undefined,
        );

        const filters = {
            assignee, label, priority, status, search,
            completed: completedOnly ? ('completed' as const) : includeCompleted ? ('all' as const) : ('incomplete' as const),
            completedSince,
        };

        const collection = buildTaskCollection({
            scope: 'backlog',
            orgId: req.userOrgId || null,
            visibility,
            filters,
        });
        const whereSql = collection.whereSql;
        const params = collection.params;
        const pi = params.length + 1;

        // The completed count renders from the first response, so the section
        // can be labelled while collapsed without a second request.
        const completedCollection = buildCompletedQuery({
            scope: 'backlog',
            orgId: req.userOrgId || null,
            visibility,
            filters: { ...filters, completedSince: undefined },
        });

        // Bug #9: include a parallel COUNT(*) so the client can render
        // pagination / totals without a second round-trip.
        const [tasksRes, countRes, completedCountRes] = await Promise.all([
            req.db!.query(
                `SELECT t.* FROM tasks t
                  WHERE ${whereSql}
                  ORDER BY ${collection.orderSql}
                  LIMIT $${pi} OFFSET $${pi + 1}`,
                [...params, limit, offset]
            ),
            req.db!.query(`SELECT COUNT(*)::int AS total FROM tasks t WHERE ${whereSql}`, params),
            req.db!.query(
                `SELECT COUNT(*)::int AS total FROM tasks t WHERE ${completedCollection.whereSql}`,
                completedCollection.params,
            ),
        ]);
        const tasks = tasksRes.rows;
        const total = countRes.rows[0]?.total ?? tasks.length;
        const completedCount = completedCountRes.rows[0]?.total ?? 0;

        const enriched = await enrichTasks(tasks, req.db);
        const summary: { total: number; byStatus: Record<string, number>; byPriority: Record<string, number> } = { total, byStatus: {}, byPriority: { high: 0, medium: 0, low: 0 } };
        for (const t of enriched) {
            const key = t.workflow_state_key;
            if (key) summary.byStatus[key] = (summary.byStatus[key] || 0) + 1;
            if (summary.byPriority[t.priority] !== undefined) summary.byPriority[t.priority]++;
        }

        res.json({
            tasks: enriched,
            summary,
            completed_count: completedCount,
            incomplete_total: total,
            pagination: { limit, offset, total, hasMore: offset + enriched.length < total },
        });
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching backlog:');
        res.status(500).json({ error: 'Failed to fetch backlog' });
    }
});

// ─── Backlog: Create a backlog item (no date) ─────────────────────────────
router.post('/backlog', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { title, description, priority, assigned_to, due_date, label_ids, sprint_id,
            story_points, work_item_type_id, workflow_state_id, parent_task_id,
            acceptance_criteria, is_blocked, blocked_reason, project_id, team_id } = req.body;

        if (!title || !title.trim()) return res.status(400).json({ error: 'Task title is required' });
        if (title.trim().length > 200) return res.status(400).json({ error: 'Task title must be 200 characters or less' });
        if (description && description.length > 5000) return res.status(400).json({ error: 'Task description must be 5000 characters or less' });

        // Stage 3: optional project assignment. Mirrors the validation in
        // routes/tasks/crud.js so a missing/invalid project returns 400
        // before we open the transaction. The matching task_number is
        // reserved atomically below inside the transaction.
        let validProjectId = null;
        if (project_id !== undefined && project_id !== null && project_id !== '') {
            const projNum = parseInt(project_id, 10);
            if (!isNaN(projNum) && req.userOrgId) {
                const proj = (await req.db!.query(
                    'SELECT id FROM projects WHERE id = $1 AND org_id = $2 AND is_archived = FALSE',
                    [projNum, req.userOrgId]
                )).rows[0];
                if (!proj) return res.status(400).json({ error: 'Invalid project or project is archived' });
                validProjectId = proj.id;
            }
        }

        const validPriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';

        let assignedTo = null;
        if (assigned_to) {
            const targetUser = (await req.db!.query('SELECT id, org_id, is_active FROM users WHERE id = $1', [assigned_to])).rows[0];
            if (!targetUser || !targetUser.is_active) return res.status(400).json({ error: 'Assigned user not found or inactive' });
            if (targetUser.org_id && req.userOrgId !== targetUser.org_id) {
                return res.status(400).json({ error: 'Cannot assign tasks to users in a different organization' });
            }
            assignedTo = assigned_to;
        }

        let validDueDate = null;
        if (due_date && /^\d{4}-\d{2}-\d{2}$/.test(due_date)) validDueDate = due_date;

        let validSprintId = null;
        let sprintRow: { id: number; team_id: number | null; end_date: string } | null = null;
        // Sprint assignment is part of the Agile feature bundle — when the
        // tenant's "Agile & Sprints" flag is off (plan default or feature
        // override) silently ignore any sprint_id so a stale client can't
        // sneak a backlog ticket into a sprint.
        const { isFeatureEnabled } = require('../../utils/planCatalog');
        const agileOn = isFeatureEnabled((req as any).tenant, 'agile');
        if (sprint_id && agileOn) {
            const callerIsOrgAdmin = isOrgAdmin(req.userRole);
            const sprint = callerIsOrgAdmin
                ? (await req.db!.query(
                    'SELECT s.id, s.team_id, s.end_date FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id = $2',
                    [sprint_id, req.userOrgId]
                )).rows[0]
                : (await req.db!.query('SELECT id, team_id, end_date FROM sprints WHERE id = $1', [sprint_id])).rows[0];
            if (sprint && (callerIsOrgAdmin || sprint.team_id === req.userTeamId)) {
                validSprintId = sprint.id;
                sprintRow = sprint;
                if (!validDueDate) validDueDate = sprint.end_date;
            } else {
                return res.status(400).json({ error: 'Invalid sprint or sprint does not belong to your team' });
            }
        }

        const owner = await resolveCreateTeamId(req.db!, {
            actor: taskActorFromRequest(req),
            orgId: req.userOrgId || null,
            explicitTeamId: team_id,
            sprint: sprintRow,
        });
        if (owner.error) return res.status(owner.error.status).json(owner.error.body);

        // Agile fields
        const sp = validateStoryPoints(story_points);
        const witRow = await resolveWorkItemType(work_item_type_id, req.userOrgId, req.db);
        const wsRow = await resolveWorkflowState(workflow_state_id, req.userOrgId, req.db);
        const witId = witRow ? witRow.id : (await getDefaultWorkItemType(req.userOrgId, req.db))?.id || null;
        const initialState = wsRow || (await getInitialWorkflowState(req.userOrgId, req.db));
        const wsId = initialState ? initialState.id : null;
        const ac = normalizeAcceptanceCriteria(acceptance_criteria);
        const isBlocked = !!is_blocked;
        const blockedReason = isBlocked ? (blocked_reason ? String(blocked_reason).slice(0, 500) : null) : null;
        let parentTaskId = null;
        if (parent_task_id) {
            const parentNum = parseInt(parent_task_id, 10);
            if (!isNaN(parentNum)) {
                const parent = (await req.db!.query('SELECT id, org_id FROM tasks WHERE id = $1', [parentNum])).rows[0];
                if (parent && parent.org_id === req.userOrgId) parentTaskId = parent.id;
            }
        }

        // Bug #1 (Stage 2): atomic INSERT + labels + history (see crud.js POST).
        // Stage 3: when a project is assigned, reserve the next task_number
        // within the project so the enricher can produce a WEB-123 style
        // issue key.
        const taskId = await (req.db as DbLike).transaction(async (client: any) => {
            let taskNumber = null;
            if (validProjectId) {
                const numRes = await client.query(
                    `UPDATE projects
                        SET next_task_number = next_task_number + 1,
                            updated_at = NOW()
                      WHERE id = $1
                      RETURNING next_task_number - 1 AS task_number`,
                    [validProjectId]
                );
                taskNumber = numRes.rows[0]?.task_number || null;
            }
            const insertRes = await client.query(
                `INSERT INTO tasks
                    (user_id, planned_date, title, description, priority, assigned_to, due_date,
                     sprint_id, org_id, team_id, story_points, work_item_type_id, workflow_state_id,
                     parent_task_id, acceptance_criteria, is_blocked, blocked_reason, lead_started_at,
                     project_id, task_number)
                 VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), $17, $18)
                 RETURNING id`,
                [req.userId, title.trim(), description?.trim() || null, validPriority,
                    assignedTo, validDueDate, validSprintId, req.userOrgId || null, owner.teamId,
                    sp, witId, wsId, parentTaskId, ac ? JSON.stringify(ac) : null, isBlocked, blockedReason,
                    validProjectId, taskNumber]
            );
            const newId = insertRes.rows[0].id;
            if (label_ids && Array.isArray(label_ids) && label_ids.length > 0) {
                await syncLabels(newId, label_ids, req.userOrgId, { query: client.query.bind(client) });
            }
            await logHistory(newId, req.userId, 'created', null, null, null, client, req.db);
            return newId;
        });

        const task = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [taskId])).rows[0];
        const enriched = await enrichTasks([task], req.db);

        // Notify assigned user
        if (assignedTo && assignedTo !== req.userId) {
            await notifyTaskAssigned(req, task, assignedTo);
        }

        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err: err }, 'Error creating backlog item:');
        res.status(500).json({ error: 'Failed to create backlog item' });
    }
});

// ─── Move backlog item to a specific date (schedule it) ───────────────────
router.patch('/:id/schedule', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { date } = req.body;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Valid date is required' });
        }

        const task = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        if (!await canAccessTask(task, taskActorFromRequest(req), req.db)) return denyTaskAccess(res, task, taskActorFromRequest(req));

        await req.db!.query('UPDATE tasks SET planned_date = $1 WHERE id = $2', [date, id]);
        await logHistory(id, req.userId, 'scheduled', 'planned_date', task.planned_date || 'backlog', date, null, req.db);

        const updated = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        const enriched = await enrichTasks([updated], req.db);
        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err: err }, 'Error scheduling task:');
        res.status(500).json({ error: 'Failed to schedule task' });
    }
});

// ─── Move a dated task back to backlog ────────────────────────────────────
router.patch('/:id/unschedule', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const task = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        if (!await canAccessTask(task, taskActorFromRequest(req), req.db)) return denyTaskAccess(res, task, taskActorFromRequest(req));

        await req.db!.query('UPDATE tasks SET planned_date = NULL WHERE id = $1', [id]);
        await logHistory(id, req.userId, 'unscheduled', 'planned_date', task.planned_date, 'backlog', null, req.db);

        const updated = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        const enriched = await enrichTasks([updated], req.db);
        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err: err }, 'Error unscheduling task:');
        res.status(500).json({ error: 'Failed to move task to backlog' });
    }
});

export = router;