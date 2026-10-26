// CRUD + status transitions for tasks.
//
// Routes mounted on `/api/tasks`:
//   GET    /          — list tasks (date/sprint/range scoped)
//   POST   /          — create a dated task
//   PATCH  /:id/status — change workflow state
//   PUT    /:id        — full update
//   DELETE /:id        — creator-only delete

import express from "express";
import type { Request, Response } from "express";
import type { LifecycleContext } from "../../modules/tasks/tasks.workflow";
const auth = require('../../middleware/auth');
const { loadUserContext } = require('../../middleware/rbac');
const { getLocalToday } = require('../../utils/timezone');
const { notifyTaskAssigned } = require('../../utils/taskNotifications');
const { logAction } = require('../../utils/audit');

const { logHistory } = require('./_helpers/logHistory');

const { canAccessTask, canChangeTaskStatus, denyTaskAccess, STATUS_FORBIDDEN, ACCESS_DENIED } = require("./_helpers/access");
const {
    isOrgAdmin,
    rejectsForeignTeamRequest,
    resolveTaskVisibility,
    taskActorFromRequest,
} = require('../../modules/tasks/tasks.policy');
const { frozenSprintError } = require('./_helpers/sprintFreeze');
const { enrichTasks } = require('./_helpers/enrich');
const { syncLabels } = require('./_helpers/labels');
const { announceStatusMove, broadcastTaskUpdated } = require('./_helpers/statusEvents');
const { assertLifecycleMove, loadLifecycleContext, stateOf } = require('../../modules/tasks/tasks.workflow');
const { findActorName } = require('../../modules/tasks/tasks.repository');
const { buildTaskCollection } = require('../../modules/tasks/tasks.collection');
const {
    resolveCreateTeamId,
    canMoveIntoTeamSprint,
    sprintTeamMismatchBody,
    teamAfterSprintMove,
} = require('../../modules/tasks/tasks.ownership');
const { diffTask } = require('../../modules/tasks/tasks.deltas');
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

const router = express.Router();

// ─── Get tasks for a specific date or date range ─────────────────────────
router.get('/', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { date, start_date, end_date, sprint_id, scope, include_due, assignee, label, priority, status, search } = req.query as Record<string, string>;

        // One policy for every list surface. Admins may ask for a team (the
        // Plan team switcher) or the Unassigned bucket; a non-admin asking for
        // a foreign team is rejected rather than silently narrowed.
        const actor = taskActorFromRequest(req);
        const requestedTeamId = req.query.team_id ? parseInt(String(req.query.team_id), 10) : null;
        if (rejectsForeignTeamRequest(actor, requestedTeamId)) {
            return res.status(403).json({ error: ACCESS_DENIED });
        }
        const visibility = resolveTaskVisibility(actor, {
            scope,
            teamId: Number.isNaN(requestedTeamId as number) ? null : requestedTeamId,
            unassigned: req.query.unassigned === '1' || req.query.unassigned === 'true',
        });

        const collection = buildTaskCollection({
            scope: 'schedule',
            orgId: req.userOrgId || null,
            visibility,
            sprintId: sprint_id ? parseInt(sprint_id, 10) : undefined,
            startDate: start_date,
            endDate: end_date,
            date: date || (sprint_id || (start_date && end_date) ? undefined : getLocalToday(req)),
            filters: { assignee, label, priority, status, search, includeDue: include_due === '1' },
        });

        const tasks = (await req.db!.query(`
            SELECT t.* FROM tasks t
            WHERE ${collection.whereSql}
            ORDER BY ${collection.orderSql}
            LIMIT 500
        `, collection.params)).rows;

        const enriched = await enrichTasks(tasks, req.db);
        const total = enriched.length;
        const done = enriched.filter((t: any) => t.workflow_state_category === 'done').length;
        const inProgress = enriched.filter((t: any) => t.workflow_state_category === 'in_progress').length;

        res.json({ tasks: enriched, stats: { total, done, inProgress, percent: total > 0 ? Math.round((done / total) * 100) : 0 } });
    } catch (err) {
        req.log.error({ err: err }, 'Error fetching tasks:');
        res.status(500).json({ error: 'Failed to fetch tasks' });
    }
});

// ─── Add a task ──────────────────────────────────────────────────────────
router.post('/', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const { title, description, priority, date, assigned_to, due_date, label_ids, sprint_id,
            story_points, work_item_type_id, workflow_state_id, parent_task_id,
            acceptance_criteria, is_blocked, blocked_reason, project_id, team_id } = req.body;

        if (!title || !title.trim()) return res.status(400).json({ error: 'Task title is required' });
        if (title.trim().length > 200) return res.status(400).json({ error: 'Task title must be 200 characters or less' });
        if (description && description.length > 5000) return res.status(400).json({ error: 'Task description must be 5000 characters or less' });

        // Stage 3: optional project assignment + auto issue key. We validate
        // the project here so a missing/invalid value returns 400 before we
        // open the create transaction.
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

        const targetDate = date || getLocalToday(req);
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
        if (due_date && /^\d{4}-\d{2}-\d{2}$/.test(due_date)) {
            // Bug #15 (Stage 2): reject due_date earlier than the scheduled
            // date so users can't create logically impossible tasks (e.g.
            // dated 2026-05-21 due 2024-01-01). Compared lexicographically —
            // both are YYYY-MM-DD strings so ASCII order = chronological.
            if (targetDate && due_date < targetDate) {
                return res.status(400).json({ error: 'Due date cannot be earlier than the task date' });
            }
            validDueDate = due_date;
        }

        let validSprintId = null;
        let sprintRow: { id: number; team_id: number | null; end_date: string } | null = null;
        // Sprint assignment is part of the Agile feature bundle — when the
        // tenant's "Agile & Sprints" flag is off (plan default or feature
        // override) silently ignore any sprint_id so a stale client can't
        // sneak a task into a sprint.
        const { isFeatureEnabled } = require('../../utils/planCatalog');
        if (sprint_id && isFeatureEnabled((req as any).tenant, 'agile')) {
            const sprint = (await req.db!.query(
                'SELECT s.id, s.team_id, s.end_date FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id = $2',
                [sprint_id, req.userOrgId]
            )).rows[0];
            const callerIsOrgAdmin = isOrgAdmin(req.userRole);
            if (sprint && (sprint.team_id === req.userTeamId || callerIsOrgAdmin)) {
                validSprintId = sprint.id;
                sprintRow = sprint;
                if (!validDueDate) validDueDate = sprint.end_date;
            } else {
                return res.status(400).json({ error: 'Invalid sprint or sprint does not belong to your team' });
            }
        }

        // Ownership: explicit team (admins only), else the sprint's team, else
        // the creator's team. A sprint assignment that contradicts the ticket's
        // team is rejected so ownership never changes as a side effect.
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

        // Bug #1 (Stage 2): the INSERT + label sync + history were three
        // separate statements. A failure between them left orphan rows (e.g.
        // a task with no history entry, or labels mapped to a half-written
        // task). Wrap them in a transaction so the entire create is atomic.
        //
        // Stage 3: when a project is assigned, we also reserve the next
        // `task_number` within the project. The UPDATE … RETURNING approach
        // is concurrency-safe — the row-level lock around the project row
        // serialises competing INSERTs so two requests can't both grab the
        // same number.
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
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), $18, $19)
                 RETURNING id`,
                [req.userId, targetDate, title.trim(), description?.trim() || null, validPriority,
                    assignedTo, validDueDate, validSprintId, req.userOrgId || null, owner.teamId,
                    sp, witId, wsId, parentTaskId, ac ? JSON.stringify(ac) : null, isBlocked, blockedReason,
                    validProjectId, taskNumber]
            );
            const newId = insertRes.rows[0].id;
            if (label_ids && Array.isArray(label_ids) && label_ids.length > 0) {
                // syncLabels uses its own .query — re-bind to the tx client so
                // the deletes/inserts join the transaction.
                await syncLabels(newId, label_ids, req.userOrgId, { query: client.query.bind(client) });
            }
            await logHistory(newId, req.userId, 'created', null, null, null, client, req.db);
            return newId;
        });

        const task = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [taskId])).rows[0];
        const enriched = await enrichTasks([task], req.db);

        // Bug #16 (Stage 2): cross-cutting audit log so org admins can trace
        // who created / updated / deleted tasks across the tenant. This is
        // independent of `task_history` (which is per-task field changes).
        logAction(req, 'create', 'task', taskId, { title: task.title, sprint_id: validSprintId });

        // Notify assigned user
        if (assignedTo && assignedTo !== req.userId) {
            await notifyTaskAssigned(req, task, assignedTo);
        }

        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err: err }, 'Error creating task:');
        res.status(500).json({ error: 'Failed to create task' });
    }
});

// ─── Update task status ──────────────────────────────────────────────────
//
// The workflow state is the only status (D4). A caller may supply either:
//   - { workflow_state_id: <id> }
//   - { status: <workflow_state.key> }
//
// Both resolve to a `workflow_states` row in the requester's org. The state's
// category drives `completed_at`, which the database trigger maintains.
router.patch('/:id/status', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
        const { status, workflow_state_id } = req.body;

        const task = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        const actor = taskActorFromRequest(req);
        if (!await canAccessTask(task, actor, req.db)) return denyTaskAccess(res, task, actor);
        if (!await canChangeTaskStatus(task, actor, req.db)) return res.status(403).json({ error: STATUS_FORBIDDEN });

        const frozen = await frozenSprintError(req, task);
        if (frozen) return res.status(409).json(frozen);

        // Resolve target workflow state. Accept either a numeric workflow_state_id
        // or a state key (the default keys are pending/in_progress/in_review/done).
        let target = await resolveWorkflowState(workflow_state_id, req.userOrgId, req.db);
        if (!target && status) target = await resolveWorkflowState(status, req.userOrgId, req.db);
        // An unknown key is invalid: there is no status column to fall back to,
        // so a task must always point at a real workflow state.
        if (!target) return res.status(400).json({ error: 'Invalid status / workflow state' });

        // ── Lifecycle: legal transition + WIP capacity ──────────────────────
        // One helper for every write path. It refuses a move the transition
        // graph does not allow (409 INVALID_TRANSITION) and a destination
        // column that is already full (409 WIP_EXCEEDED).
        const lifecycle = await loadLifecycleContext(req.db, req.userOrgId);
        const conflict = await assertLifecycleMove(req.db!, req.userOrgId, task, target, lifecycle);
        if (conflict) return res.status(conflict.status).json(conflict.body);

        // ── Phase 3: cycle-time start marker ────────────────────────────────
        // Record the moment the task first transitions out of an "open" state
        // (i.e. work actually begins). This stamp is what we use later to
        // compute cycle time = completed_at - cycle_started_at.
        //
        // Use `is_initial` + `category === 'open'` from the workflow_states row
        // so a tenant that renamed or added an initial state still starts the
        // cycle. `completed_at` is derived by the database from the
        // workflow-state category (migration 0011), so the server never writes
        // it: the trigger sets it on entering a done state and clears it on
        // leaving.
        let cycleStartedAtClause = '';
        const wasOpen = !task.cycle_started_at;
        const targetIsStartOfWork = !target.is_terminal
            && !target.is_initial
            && (target.category ? target.category !== 'open' : true);
        const startsCycle = wasOpen && targetIsStartOfWork;
        if (startsCycle) cycleStartedAtClause = ', cycle_started_at = NOW()';

        await req.db!.query(
            `UPDATE tasks SET workflow_state_id = $1${cycleStartedAtClause}
              WHERE id = $2`,
            [target.id, id]
        );

        const statusChanged = String(task.workflow_state_id ?? '') !== String(target.id ?? '');
        const statusActor = await findActorName(req.db!, req.userId);
        if (statusChanged) {
            await logHistory(id, req.userId, 'status_change', 'workflow_state', task.workflow_state_id, target.id, null, req.db);
        }

        const updated = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        const enriched = await enrichTasks([updated], req.db);
        if (statusChanged) {
            // Audit, notify and realtime fan-out are one call, so this path
            // cannot drift from the others.
            await announceStatusMove(req, {
                task: updated,
                from: stateOf(lifecycle, task),
                to: target,
                name: statusActor,
                fields: diffTask(task, updated),
            });
        }
        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err: err }, 'Error updating task status:');
        res.status(500).json({ error: 'Failed to update task status' });
    }
});

// ─── Update task details ─────────────────────────────────────────────────
router.put('/:id', auth, loadUserContext, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: 'Invalid task ID' });
        const { title, description, priority, assigned_to, due_date, planned_date, label_ids, sprint_id,
            story_points, work_item_type_id, workflow_state_id, parent_task_id,
            acceptance_criteria, is_blocked, blocked_reason, project_id } = req.body;

        const task = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        const actor = taskActorFromRequest(req);
        if (!await canAccessTask(task, actor, req.db)) return denyTaskAccess(res, task, actor);

        // A completed sprint accepts no task writes.
        const frozen = await frozenSprintError(req, task, sprint_id === undefined ? undefined : sprint_id);
        if (frozen) return res.status(409).json(frozen);

        // Stage 3: allow assigning a task to a project *only if it has none
        // yet*. Re-keying an existing task (PROJ-12 → OTHER-7) would orphan
        // every external reference (branches, commits, links) that already
        // mention the old key, so we deliberately make this one-way. To move
        // a task to a different project, create a new one and link them.
        let newProjectId = task.project_id;
        let newTaskNumber = task.task_number;
        const wantsProjectAssign = project_id !== undefined
            && project_id !== null
            && project_id !== ''
            && !task.project_id;
        if (project_id !== undefined && task.project_id) {
            // Silently ignore attempts to change/clear an already-set project
            // so the rest of the update still succeeds.
        }
        if (wantsProjectAssign) {
            const projNum = parseInt(project_id, 10);
            if (isNaN(projNum) || !req.userOrgId) {
                return res.status(400).json({ error: 'Invalid project' });
            }
            const proj = (await req.db!.query(
                'SELECT id FROM projects WHERE id = $1 AND org_id = $2 AND is_archived = FALSE',
                [projNum, req.userOrgId]
            )).rows[0];
            if (!proj) return res.status(400).json({ error: 'Invalid project or project is archived' });
            // Reserve a task number atomically (same pattern as POST /tasks).
            const numRes = await req.db!.query(
                `UPDATE projects
                    SET next_task_number = next_task_number + 1,
                        updated_at = NOW()
                  WHERE id = $1
                  RETURNING next_task_number - 1 AS task_number`,
                [proj.id]
            );
            newProjectId = proj.id;
            newTaskNumber = numRes.rows[0]?.task_number || null;
        }

        const newTitle = title?.trim() || task.title;
        const newDesc = description !== undefined ? (description?.trim() || null) : task.description;
        const newPriority = ['low', 'medium', 'high'].includes(priority) ? priority : task.priority;

        let newAssignedTo = task.assigned_to;
        if (assigned_to !== undefined) {
            if (assigned_to === null || assigned_to === '') {
                newAssignedTo = null;
            } else {
                const targetUser = (await req.db!.query('SELECT id, org_id, is_active FROM users WHERE id = $1', [assigned_to])).rows[0];
                if (!targetUser || !targetUser.is_active) return res.status(400).json({ error: 'Assigned user not found or inactive' });
                // Service desk tasks (linked via service_desk_ticket_id) can be assigned
                // to any active user in the tenant by org admins for cross-team resolution.
                const isServiceDeskTask = !!task.service_desk_ticket_id;
                const isOrgAdminUser = isOrgAdmin(req.userRole);
                if (!isServiceDeskTask && targetUser.org_id && req.userOrgId !== targetUser.org_id) {
                    return res.status(400).json({ error: 'Cannot assign tasks to users in a different organization' });
                }
                if (isServiceDeskTask && !isOrgAdminUser && targetUser.org_id && req.userOrgId !== targetUser.org_id) {
                    return res.status(400).json({ error: 'Cannot assign tasks to users in a different organization' });
                }
                newAssignedTo = assigned_to;
            }
        }

        let newDueDate = task.due_date;
        if (due_date !== undefined) {
            newDueDate = (due_date && /^\d{4}-\d{2}-\d{2}$/.test(due_date)) ? due_date : null;
            // Bug #15: reject due_date earlier than the planned date.
            if (newDueDate && task.planned_date && newDueDate < task.planned_date) {
                return res.status(400).json({ error: 'Due date cannot be earlier than the task date' });
            }
        }

        // `planned_date` is the only scheduling field (D2).
        let newPlannedDate = task.planned_date ?? null;
        if (planned_date !== undefined) {
            newPlannedDate = (planned_date && /^\d{4}-\d{2}-\d{2}$/.test(planned_date))
                ? planned_date : null;
            if (newPlannedDate && newDueDate && newDueDate < newPlannedDate) {
                return res.status(400).json({ error: 'Due date cannot be earlier than the planned date' });
            }
        }

        let newSprintId = task.sprint_id;
        let newTeamId = task.team_id;
        // Agile gate: when "Agile & Sprints" is disabled for the tenant,
        // ignore sprint changes entirely (clearing is still harmless but we
        // keep behaviour deterministic: no sprint mutations at all).
        const { isFeatureEnabled: isAgileFeatureEnabled } = require('../../utils/planCatalog');
        const agileEnabledForTenant = isAgileFeatureEnabled((req as any).tenant, 'agile');
        if (sprint_id !== undefined && agileEnabledForTenant) {
            if (sprint_id === null || sprint_id === '') {
                newSprintId = null;
            } else {
                const sprint = (await req.db!.query(
                    'SELECT s.id, s.team_id, s.end_date FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id = $2',
                    [sprint_id, req.userOrgId]
                )).rows[0];
                const callerIsOrgAdmin = isOrgAdmin(req.userRole);
                if (sprint && (sprint.team_id === req.userTeamId || callerIsOrgAdmin)) {
                    if (!canMoveIntoTeamSprint(task.team_id, sprint.team_id)) {
                        return res.status(409).json(sprintTeamMismatchBody());
                    }
                    newSprintId = sprint_id;
                    newDueDate = sprint.end_date;
                    if (newTeamId == null) newTeamId = teamAfterSprintMove(newTeamId, sprint.team_id);
                } else {
                    return res.status(400).json({ error: 'Invalid sprint or sprint does not belong to your team' });
                }
            }
        }

        // Resolve agile fields (only update if explicitly supplied)
        let newStoryPoints = task.story_points;
        if (story_points !== undefined) {
            newStoryPoints = (story_points === null || story_points === '') ? null : validateStoryPoints(story_points);
        }
        let newWitId = task.work_item_type_id;
        let newWitRow = null;
        if (work_item_type_id !== undefined) {
            if (work_item_type_id === null || work_item_type_id === '') {
                newWitId = null;
            } else {
                newWitRow = await resolveWorkItemType(work_item_type_id, req.userOrgId, req.db);
                if (!newWitRow) return res.status(400).json({ error: 'Invalid work_item_type' });
                newWitId = newWitRow.id;
            }
        }
        let newWsId = task.workflow_state_id;
        let newWsRow = null;
        let stateChanged = false;
        let lifecycle: LifecycleContext | null = null;
        if (workflow_state_id !== undefined) {
            if (workflow_state_id === null || workflow_state_id === '') {
                // Reset to initial state for the org
                newWsRow = await getInitialWorkflowState(req.userOrgId, req.db);
            } else {
                newWsRow = await resolveWorkflowState(workflow_state_id, req.userOrgId, req.db);
                if (!newWsRow) return res.status(400).json({ error: 'Invalid workflow_state' });
            }
            newWsId = newWsRow ? newWsRow.id : null;
            // Bug #13 (Stage 2): only check permission when the state actually
            // changed. `completed_at` is derived by the database trigger, so
            // this route never writes it.
            stateChanged = String(newWsId ?? '') !== String(task.workflow_state_id ?? '');
            if (stateChanged) {
                if (!await canChangeTaskStatus(task, actor, req.db)) {
                    return res.status(403).json({ error: STATUS_FORBIDDEN });
                }
                // The full update is another way into the lifecycle: it applies
                // the same transition graph and WIP capacity as PATCH.
                lifecycle = await loadLifecycleContext(req.db, req.userOrgId);
                const conflict = await assertLifecycleMove(req.db!, req.userOrgId, task, newWsRow, lifecycle);
                if (conflict) return res.status(conflict.status).json(conflict.body);
            }
        }
        let newParentTaskId = task.parent_task_id;
        if (parent_task_id !== undefined) {
            if (parent_task_id === null || parent_task_id === '') {
                newParentTaskId = null;
            } else {
                const parentNum = parseInt(parent_task_id, 10);
                if (isNaN(parentNum) || parentNum === id) return res.status(400).json({ error: 'Invalid parent_task_id' });
                const parent = (await req.db!.query('SELECT id, org_id FROM tasks WHERE id = $1', [parentNum])).rows[0];
                if (!parent || parent.org_id !== req.userOrgId) return res.status(400).json({ error: 'Parent task not found' });
                newParentTaskId = parent.id;
            }
        }
        let newAc = task.acceptance_criteria;
        if (acceptance_criteria !== undefined) {
            newAc = (acceptance_criteria === null) ? null : normalizeAcceptanceCriteria(acceptance_criteria);
        }
        let newIsBlocked = task.is_blocked;
        let newBlockedReason = task.blocked_reason;
        if (is_blocked !== undefined) {
            newIsBlocked = !!is_blocked;
            if (!newIsBlocked) newBlockedReason = null;
        }
        if (blocked_reason !== undefined) {
            newBlockedReason = blocked_reason ? String(blocked_reason).slice(0, 500) : null;
        }

        await req.db!.query(
            `UPDATE tasks SET title = $1, description = $2, priority = $3, assigned_to = $4,
                due_date = $5, sprint_id = $6, story_points = $7, work_item_type_id = $8,
                workflow_state_id = $9, parent_task_id = $10,
                acceptance_criteria = $11, is_blocked = $12, blocked_reason = $13,
                project_id = $14, task_number = $15, planned_date = $16, team_id = $18
              WHERE id = $17`,
            [newTitle, newDesc, newPriority, newAssignedTo, newDueDate, newSprintId,
                newStoryPoints, newWitId, newWsId, newParentTaskId,
                newAc !== null && newAc !== undefined ? JSON.stringify(newAc) : null,
                newIsBlocked, newBlockedReason, newProjectId, newTaskNumber,
                newPlannedDate, id, newTeamId]
        );

        // Log a project assignment as a first-class history event so users
        // can see when a previously-keyless task picked up an issue key.
        if (wantsProjectAssign && newProjectId && newProjectId !== task.project_id) {
            const projRow = (await req.db!.query('SELECT key FROM projects WHERE id = $1', [newProjectId])).rows[0];
            const newKey = projRow && newTaskNumber ? `${projRow.key}-${newTaskNumber}` : null;
            await logHistory(id, req.userId, 'updated', 'project', 'none', newKey || `project #${newProjectId}`, null, req.db);
        }

        if (newTitle !== task.title) await logHistory(id, req.userId, 'updated', 'title', task.title, newTitle, null, req.db);
        if (newDesc !== task.description) await logHistory(id, req.userId, 'updated', 'description', task.description ? task.description.slice(0, 100) : null, newDesc ? newDesc.slice(0, 100) : null, null, req.db);
        if (newPriority !== task.priority) await logHistory(id, req.userId, 'updated', 'priority', task.priority, newPriority, null, req.db);
        if (String(newAssignedTo || '') !== String(task.assigned_to || '')) {
            // Bug #14 (Stage 2): the original lookup only returned `full_name`.
            // If a user had a null/empty full_name (common for SSO accounts
            // that only carry email) the history line read "null → null".
            // Pull username too and fall back to it.
            const oldUser = task.assigned_to ? (await req.db!.query('SELECT full_name, username FROM users WHERE id = $1', [task.assigned_to])).rows[0] : null;
            const newUser = newAssignedTo ? (await req.db!.query('SELECT full_name, username FROM users WHERE id = $1', [newAssignedTo])).rows[0] : null;
            const oldLabel = oldUser?.full_name || oldUser?.username || 'unassigned';
            const newLabel = newUser?.full_name || newUser?.username || 'unassigned';
            await logHistory(id, req.userId, 'updated', 'assigned_to', oldLabel, newLabel, null, req.db);
        }
        if (newDueDate !== task.due_date) await logHistory(id, req.userId, 'updated', 'due_date', task.due_date, newDueDate, null, req.db);
        if (newPlannedDate !== (task.planned_date ?? null)) {
            await logHistory(id, req.userId, 'updated', 'planned_date',
                task.planned_date ?? null, newPlannedDate, null, req.db);
        }
        if (String(newSprintId || '') !== String(task.sprint_id || '')) {
            const oldSprint = task.sprint_id ? (await req.db!.query('SELECT name FROM sprints WHERE id = $1', [task.sprint_id])).rows[0] : null;
            const newSprint = newSprintId ? (await req.db!.query('SELECT name FROM sprints WHERE id = $1', [newSprintId])).rows[0] : null;
            await logHistory(id, req.userId, 'updated', 'sprint', oldSprint?.name || 'none', newSprint?.name || 'none', null, req.db);
        }
        // Normalize for comparison: DB returns NUMERIC as a string like '8.00',
        // while newStoryPoints is a JS number (e.g. 8). A naive string compare
        // would mark every edit as a change. Compare numerically and treat
        // null/undefined as equal.
        const oldSpNum = task.story_points == null ? null : Number(task.story_points);
        const newSpNum = newStoryPoints == null ? null : Number(newStoryPoints);
        const spChanged = (oldSpNum === null) !== (newSpNum === null)
            || (oldSpNum !== null && newSpNum !== null && oldSpNum !== newSpNum);
        if (spChanged) {
            // Log normalised numeric values so the history reads "8 → 9" rather
            // than "8.00 → 9" (Postgres NUMERIC vs JS number formatting).
            await logHistory(id, req.userId, 'updated', 'story_points', oldSpNum, newSpNum, null, req.db);
        }
        if (String(newWitId ?? '') !== String(task.work_item_type_id ?? '')) {
            const oldWit = task.work_item_type_id ? (await req.db!.query('SELECT name FROM work_item_types WHERE id = $1', [task.work_item_type_id])).rows[0] : null;
            const newWit = newWitId ? (newWitRow || (await req.db!.query('SELECT name FROM work_item_types WHERE id = $1', [newWitId])).rows[0]) : null;
            await logHistory(id, req.userId, 'updated', 'work_item_type', oldWit?.name || 'none', newWit?.name || 'none', null, req.db);
        }
        const statusActor = await findActorName(req.db!, req.userId);
        if (stateChanged) {
            await logHistory(id, req.userId, 'status_change', 'workflow_state', task.workflow_state_id, newWsId, null, req.db);
        }
        if (String(newParentTaskId ?? '') !== String(task.parent_task_id ?? '')) {
            await logHistory(id, req.userId, 'updated', 'parent', task.parent_task_id || 'none', newParentTaskId || 'none', null, req.db);
        }
        if (!!newIsBlocked !== !!task.is_blocked) {
            await logHistory(id, req.userId, 'updated', 'is_blocked', String(task.is_blocked), String(newIsBlocked), null, req.db);
        }

        if (label_ids !== undefined) {
            const oldLabels = (await req.db!.query('SELECT tl.name FROM task_label_map tlm JOIN task_labels tl ON tl.id = tlm.label_id WHERE tlm.task_id = $1 ORDER BY tl.name', [id])).rows.map(r => r.name);
            await syncLabels(id, label_ids || [], req.userOrgId, req.db);
            const newLabels = (await req.db!.query('SELECT tl.name FROM task_label_map tlm JOIN task_labels tl ON tl.id = tlm.label_id WHERE tlm.task_id = $1 ORDER BY tl.name', [id])).rows.map(r => r.name);
            if (JSON.stringify(oldLabels) !== JSON.stringify(newLabels)) {
                await logHistory(id, req.userId, 'updated', 'labels', oldLabels.join(', ') || 'none', newLabels.join(', ') || 'none', null, req.db);
            }
        }

        // Bug #16: audit log for full updates.
        logAction(req, 'update', 'task', id, { title: newTitle });

        const updated = (await req.db!.query('SELECT * FROM tasks WHERE id = $1', [id])).rows[0];
        const enriched = await enrichTasks([updated], req.db);

        // Notify if assignment changed to a new user. The new assignee gets
        // task_assigned; everyone else involved gets task_updated.
        let assignmentNotified = false;
        if (newAssignedTo && String(newAssignedTo) !== String(task.assigned_to) && newAssignedTo !== req.userId) {
            assignmentNotified = await notifyTaskAssigned(req, updated, newAssignedTo);
        }
        // Broadcast only the fields that actually changed, so two people editing
        // different fields of the same ticket both survive. A status transition
        // also reaches the owning team; an ordinary edit keeps the old audience.
        const extraAudience = [task.assigned_to, assignmentNotified ? null : updated?.assigned_to];
        if (stateChanged) {
            await announceStatusMove(req, {
                task: updated,
                from: stateOf(lifecycle, task),
                to: newWsRow,
                name: statusActor,
                action: 'updated',
                fields: diffTask(task, updated),
                extra: extraAudience,
                includeTeam: true,
            });
        } else {
            await broadcastTaskUpdated(req, updated, 'updated', {
                fields: diffTask(task, updated),
                actor: { id: req.userId!, name: statusActor },
            }, extraAudience, false);
        }

        res.json(enriched[0]);
    } catch (err) {
        req.log.error({ err: err }, 'Error updating task:');
        res.status(500).json({ error: 'Failed to update task' });
    }
});

export = router;