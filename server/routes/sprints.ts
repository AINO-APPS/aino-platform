import { requireScrumSprint } from "./_helpers/projectSprint";
import express from "express";
import type { Request, Response } from "express";
import { sprintManagementRole } from "./_helpers/sprintRole";
import { addSprintManagementCapability, canManageSprint, createProjectSprint, sprintProjectIds, projectSprintVelocity, activeProjectSprint } from "../modules/tasks/tasks.sprintProjects";
import { completeSprint, parseSprintCompletionTarget, SprintCompletionError } from "../services/sprintCompletion";
const auth = require("../middleware/auth");
const { loadUserContext } = require("../middleware/rbac");
const { requireTenant } = require("../middleware/tenant");
const { listSprintTasks } = require("../modules/tasks/tasks.collection");
const {
    canReadProjectSprint,
    resolveTaskVisibilityForRequest,
    taskActorFromRequest,
} = require("../modules/tasks/tasks.policy");
const { captureBaseline } = require("../modules/tasks/tasks.baseline");
const {
    findSprintsForProjects,
    findSprintInOrg,
    lockSprintForDeletion,
    findSprintMemberIds,
    findSprintReportTasks,
    deleteSprint,
    pauseSprintForOrg,
} = require("../modules/tasks/tasks.sprintRepository");
const { loadSprintForActor } = require("../modules/tasks/tasks.sprintAccess");
const { placeTickets } = require("../modules/tasks/tasks.placement");
const { realtimeEffects } = require("../modules/tasks/tasks.placementEffects");
const { placementContext, sendPlacementRefusal, PlacementRefused } = require("./tasks/_helpers/placement");
const { withSprintLifecycleLock, withLockedSprintUpdate } = require("./_helpers/sprintEndDate");
const {
    findOtherActiveSprint,
    sprintAlreadyActiveBody,
    startSprint,
    resumedEndDate,
    sprintListResponse,
} = require("../modules/tasks/tasks.sprintLifecycle");

type RunningSprint = { id: number; name: string };
const { notifySprintStarted, notifySprintCompleted } = require("./_helpers/sprintNotifications");
const { snapshotBurndown } = require("./_helpers/sprintBurndown");
const { acquirePlacementLifecycleLock } = require("../modules/tasks/tasks.placementRepository");
const router = express.Router();
router.use(requireTenant);
async function loadAccessibleSprint(req: Request, res: Response, id: number) {
    const outcome = await loadSprintForActor(req.db!, id, taskActorFromRequest(req));
    if (outcome.error) { res.status(outcome.error.status).json(outcome.error.body); return null; }
    return outcome.sprint;
}
router.get("/", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        if (req.query.team_id != null || req.query.unassigned != null) {
            return res.status(400).json({ error: "Team-scoped sprint queries are no longer supported" });
        }
        const actor = taskActorFromRequest(req);
        const projectIds = await sprintProjectIds(actor, req.query);
        const sprints = await findSprintsForProjects(req.db!, req.userOrgId, projectIds);
        const sprintsWithCapabilities = await addSprintManagementCapability(req.db!, sprints, actor);
        return res.json(sprintListResponse(sprintsWithCapabilities, req.query.project_id != null));
    } catch (err) {
        req.log.error({ err }, "Error fetching sprints:");
        res.status(500).json({ error: "Failed to fetch sprints" });
    }
});
router.get("/active", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        if (req.query.team_id != null || req.query.unassigned != null) {
            return res.status(400).json({ error: "Team-scoped sprint queries are no longer supported" });
        }
        const actor = taskActorFromRequest(req);
        const projectIds = await sprintProjectIds(actor, req.query);
        if (projectIds.length === 0) return res.json({ sprint: null });
        const sprint = await activeProjectSprint(req.db!, actor.orgId, projectIds);
        return res.json({ sprint: sprint || null });
    } catch (err) {
        req.log.error({ err }, "Error fetching active sprint:");
        res.status(500).json({ error: "Failed to fetch active sprint" });
    }
});

router.post("/", auth, loadUserContext, requireScrumSprint, sprintManagementRole, async (req: Request, res: Response) => {
    try {
        const actor = taskActorFromRequest(req);
        if (req.body?.team_id != null) return res.status(400).json({ error: "Team-owned sprints are no longer supported" });

        const { name, start_date, end_date, goal } = req.body;
        if (!name || !start_date || !end_date) return res.status(400).json({ error: "Sprint name, start_date, and end_date are required" });
        if (name.trim().length > 100) return res.status(400).json({ error: "Sprint name must be 100 characters or less" });
        if (goal && goal.length > 1000) return res.status(400).json({ error: "Sprint goal must be 1000 characters or less" });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
            return res.status(400).json({ error: "Dates must be in YYYY-MM-DD format" });
        }

        const outcome = await createProjectSprint(req.db!, actor, req.body);
        if (outcome.error) return res.status(outcome.error.status).json(outcome.error.body);
        return res.json({ sprint: outcome.sprint });
    } catch (err) {
        if ((err as any)?.code === "23514" && (err as any)?.message === "PROJECT_HAS_NO_SPRINTS") return res.status(409).json({ error: "Sprints are only available in Scrum projects.", code: "PROJECT_HAS_NO_SPRINTS" });
        req.log.error({ err }, "Error creating sprint:");
        res.status(500).json({ error: "Failed to create sprint" });
    }
});
function sprintAlreadyActive(res: Response, running: RunningSprint): Response {
    return res.status(409).json(sprintAlreadyActiveBody(running));
}

router.put("/:id", auth, loadUserContext, requireScrumSprint, sprintManagementRole, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const { name, start_date, end_date, goal, status } = req.body;

        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!await canManageSprint(req.db!, sprint, taskActorFromRequest(req))) return res.status(403).json({ error: "Access denied" });

        // A completed sprint is immutable (D11): it cannot be re-opened or
        // otherwise edited. The retrospective is the only writable artefact.
        if (sprint.status === "completed") {
            return res.status(409).json({
                error: "This sprint is completed and can no longer be changed.",
                code: "SPRINT_FROZEN",
            });
        }

        const updates: string[] = [];
        const params: unknown[] = [];
        let pi = 1;

        if (name !== undefined) { updates.push(`name = $${pi++}`); params.push(name); }
        if (start_date !== undefined) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) return res.status(400).json({ error: "start_date must be YYYY-MM-DD" });
            updates.push(`start_date = $${pi++}`); params.push(start_date);
        }
        if (end_date !== undefined) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) return res.status(400).json({ error: "end_date must be YYYY-MM-DD" });
            updates.push(`end_date = $${pi++}`); params.push(end_date);
        }
        if (goal !== undefined) { updates.push(`goal = $${pi++}`); params.push(goal); }
        if (status !== undefined && ["planned", "active", "paused", "completed"].includes(status)) {
            // Activating through an edit must respect one-active-per-team too.
            if (status === "active" && sprint.status !== "active") {
                const running = await findOtherActiveSprint(req.db!, sprint.project_id, sprint.id);
                if (running) return sprintAlreadyActive(res, running);
            }
            updates.push(`status = $${pi++}`); params.push(status);
        }

        if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update" });
        params.push(id, req.userOrgId ?? null);
        const updateSql = `UPDATE sprints s SET ${updates.join(", ")} WHERE s.id = $${pi} AND s.status <> 'completed' AND EXISTS (SELECT 1 FROM projects tm WHERE tm.id = s.project_id AND tm.org_id IS NOT DISTINCT FROM $${pi + 1})`;
        const updatedInOrg = await withLockedSprintUpdate(req, Number(id), (client: any) => client.query(updateSql, params));
        if (!updatedInOrg) return res.status(409).json({ error: "Sprint is no longer available for editing", code: "SPRINT_FROZEN" });
        const updated = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        res.json({ sprint: updated });
    } catch (err) {
        req.log.error({ err }, "Error updating sprint:");
        res.status(500).json({ error: "Failed to update sprint" });
    }
});

router.delete("/:id", auth, loadUserContext, requireScrumSprint, sprintManagementRole, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;

        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!await canManageSprint(req.db!, sprint, taskActorFromRequest(req))) return res.status(403).json({ error: "Access denied" });

        if (sprint.status === "completed") {
            return res.status(409).json({ error: "This sprint is completed and cannot be deleted", code: "SPRINT_FROZEN" });
        }

        const deleted = await req.db!.transaction!(async (client: any, { afterCommit }: any) => {
            await acquirePlacementLifecycleLock(client, taskActorFromRequest(req).orgId);
            const members = await findSprintMemberIds(client, id, taskActorFromRequest(req).orgId);
            const lockedSprint = await lockSprintForDeletion(client, id, taskActorFromRequest(req).orgId);
            if (!lockedSprint || lockedSprint.status === "completed") return false;
            const context = placementContext(req, client, afterCommit);
            const results = await placeTickets(context, members, { sprint: null });
            const refusal = results.find((result: any) => !result.ok);
            if (refusal && !refusal.ok) throw new PlacementRefused(refusal);
            await deleteSprint(client, id, taskActorFromRequest(req).orgId);
            return true;
        });
        if (!deleted) {
            return res.status(409).json({ error: "Sprint is no longer available for deletion", code: "SPRINT_FROZEN" });
        }
        res.json({ message: "Sprint deleted successfully" });
    } catch (err) {
        if (sendPlacementRefusal(res, err)) return;
        req.log.error({ err }, "Error deleting sprint:");
        res.status(500).json({ error: "Failed to delete sprint" });
    }
});
router.get("/:id/board", auth, loadUserContext, requireScrumSprint, require("./_helpers/sprintBoard").getSprintBoard(loadAccessibleSprint));
router.get("/:id/tasks", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const sprint = await loadAccessibleSprint(req, res, Number(id));
        if (!sprint) return;
        const actor = taskActorFromRequest(req);
        if (!await canReadProjectSprint(sprint, actor)) {
            return res.status(403).json({ error: "Access denied" });
        }
        const visibility = await resolveTaskVisibilityForRequest(actor, {
            projectId: sprint.project_id,
        });
        return res.json({
            tasks: await listSprintTasks(req.db!, req.userOrgId || null, Number(id), visibility),
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching sprint tasks:");
        res.status(500).json({ error: "Failed to fetch sprint tasks" });
    }
});

// ─── Sprint stats: story-point and task rollups by status / type / assignee ──
//
// Returns a single bundle the client can render in the Sprint header /
// Insights panel without further round-trips. Counts story points (treating
// NULL as 0 and tracking unestimated count separately), grouped by:
//   - workflow state (with category for reporting)
//   - work item type
//   - assignee
//
// Org admins can request stats for any sprint in their org; others limited
// to their own team. Visible to any member of the team.
router.get("/:id/stats", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });

        const sprint = await loadAccessibleSprint(req, res, id);
        if (!sprint) return;

        const tasks = await findSprintReportTasks(req.db!, id);

        // Pull workflow state metadata (category, terminal flag) and type metadata
        const stateIds = [...new Set(tasks.map((t: any) => t.workflow_state_id).filter(Boolean))];
        const typeIds = [...new Set(tasks.map((t: any) => t.work_item_type_id).filter(Boolean))];
        const assigneeIds = [...new Set(tasks.map((t: any) => t.assigned_to).filter(Boolean))];

        const [states, types, users] = await Promise.all([
            stateIds.length
                ? req.db!.query(
                    "SELECT id, key, name, category, color, is_terminal FROM workflow_states WHERE id = ANY($1)",
                    [stateIds]
                ).then((r: any) => r.rows)
                : [],
            typeIds.length
                ? req.db!.query(
                    "SELECT id, key, name, color, icon FROM work_item_types WHERE id = ANY($1)",
                    [typeIds]
                ).then((r: any) => r.rows)
                : [],
            assigneeIds.length
                ? req.db!.query(
                    "SELECT id, username, full_name, avatar FROM users WHERE id = ANY($1)",
                    [assigneeIds]
                ).then((r: any) => r.rows)
                : [],
        ]);

        const stateById = Object.fromEntries(states.map((s: any) => [s.id, s]));
        const typeById = Object.fromEntries(types.map((t: any) => [t.id, t]));
        const userById = Object.fromEntries(users.map((u: any) => [u.id, u]));

        const num = (v: any) => (v == null ? 0 : Number(v));

        const totalTasks = tasks.length;
        const totalPoints = tasks.reduce((sum: number, t: any) => sum + num(t.story_points), 0);
        const unestimatedTasks = tasks.filter((t: any) => t.story_points == null).length;
        const blockedTasks = tasks.filter((t: any) => t.is_blocked).length;

        // Task / point rollup by workflow state
        const byState: Record<string, any> = {};
        for (const t of tasks) {
            const s = stateById[t.workflow_state_id] || { id: 0, key: "unknown", name: "Unknown", category: "open", color: "#6b7280", is_terminal: false };
            const k = String(s.id);
            if (!byState[k]) {
                byState[k] = { state: s, taskCount: 0, points: 0 };
            }
            byState[k].taskCount += 1;
            byState[k].points += num(t.story_points);
        }
        // Done counts (any state with is_terminal = TRUE)
        const donePoints = Object.values(byState)
            .filter((b: any) => b.state.is_terminal)
            .reduce((sum: number, b: any) => sum + b.points, 0);
        const doneTasks = Object.values(byState)
            .filter((b: any) => b.state.is_terminal)
            .reduce((sum: number, b: any) => sum + b.taskCount, 0);

        // By work item type
        const byType: Record<string, any> = {};
        for (const t of tasks) {
            const wit = typeById[t.work_item_type_id] || { id: 0, key: "unknown", name: "Unknown", color: "#6b7280" };
            const k = String(wit.id);
            if (!byType[k]) byType[k] = { type: wit, taskCount: 0, points: 0, done: 0 };
            byType[k].taskCount += 1;
            byType[k].points += num(t.story_points);
            const stateRow = stateById[t.workflow_state_id];
            if (stateRow?.is_terminal) byType[k].done += 1;
        }

        // By assignee
        const byAssignee: Record<string, any> = {};
        for (const t of tasks) {
            const u = t.assigned_to ? userById[t.assigned_to] : null;
            const k = u ? `u${u.id}` : "unassigned";
            if (!byAssignee[k]) {
                byAssignee[k] = {
                    user: u || null,
                    taskCount: 0,
                    points: 0,
                    done: 0,
                    donePoints: 0,
                };
            }
            byAssignee[k].taskCount += 1;
            byAssignee[k].points += num(t.story_points);
            const stateRow = stateById[t.workflow_state_id];
            if (stateRow?.is_terminal) {
                byAssignee[k].done += 1;
                byAssignee[k].donePoints += num(t.story_points);
            }
        }

        const remainingPoints = totalPoints - donePoints;
        const percentByPoints = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;
        const percentByTasks = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

        res.json({
            sprint: {
                id: sprint.id, name: sprint.name, status: sprint.status,
                start_date: sprint.start_date, end_date: sprint.end_date, goal: sprint.goal,
                project_id: sprint.project_id,
            },
            totals: {
                tasks: totalTasks,
                points: totalPoints,
                doneTasks, donePoints, remainingPoints,
                unestimatedTasks, blockedTasks,
                percentByPoints, percentByTasks,
            },
            byState: Object.values(byState).sort((a: any, b: any) => (a.state.sort_order ?? 0) - (b.state.sort_order ?? 0)),
            byType: Object.values(byType),
            byAssignee: Object.values(byAssignee),
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching sprint stats:");
        res.status(500).json({ error: "Failed to fetch sprint stats" });
    }
});

// ─── Sprint lifecycle: START ────────────────────────────────────────────────
//
// Transitions a sprint from 'planned' → 'active'. Enforces:
//   - Only one active sprint per team at a time (409 while another is active).
//   - Captures the scope baseline and the day-0 burndown snapshot.
router.post("/:id/start", auth, loadUserContext, requireScrumSprint, sprintManagementRole, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!await canManageSprint(req.db!, sprint, taskActorFromRequest(req))) return res.status(403).json({ error: "Access denied" });
        // Starting owns the baseline, snapshot, cache update and team notification.
        const started = await withSprintLifecycleLock(req, (db: any, { afterCommit }: any) => startSprint({
            db, tenantId: req.tenantId, orgId: req.userOrgId ?? null,
            invalidateActiveSprint: async () => {
                afterCommit(() => undefined);
            },
            snapshotBurndown: (targetDb: any, sprintId: number) => snapshotBurndown(targetDb, sprintId, req.userOrgId ?? null),
            notifyStarted: async (target: any) => { afterCommit(() => notifySprintStarted(req, target)); },
            commit: captureBaseline,
        }, sprint));
        if (started.error) return res.status(started.error.status).json(started.error.body);
        const updated = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        return res.json({ sprint: updated });
    } catch (err) {
        req.log.error({ err }, "Error starting sprint");
        res.status(500).json({ error: "Failed to start sprint" });
    }
});// ─── Sprint lifecycle: COMPLETE (with optional carryover target) ─────────────
//
// The target vocabulary is shared with GET /:id/completion-preview. Omitting
// rolloverTo uses its default: the next planned sprint, or the backlog.
router.post("/:id/complete", auth, loadUserContext, requireScrumSprint, sprintManagementRole, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const rolloverTo = parseSprintCompletionTarget(req.body?.rolloverTo);
        if (rolloverTo === null) return res.status(400).json({ error: "Invalid rolloverTo target" });

        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!await canManageSprint(req.db!, sprint, taskActorFromRequest(req))) return res.status(403).json({ error: "Access denied" });
        if (sprint.status === "completed") return res.status(409).json({ error: "Sprint already completed" });

        const actor = taskActorFromRequest(req);
        const xff = req.headers?.["x-forwarded-for"];
        const completion = await completeSprint(req.db! as any, {
            sprintId: Number(id),
            target: rolloverTo,
            actor: {
                userId: actor.userId,
                orgId: actor.orgId,
                ip: req.ip || (Array.isArray(xff) ? xff[0] : xff) || null,
                userAgent: req.headers?.["user-agent"] || null,
            },
            effects: realtimeEffects({ db: req.db, tenantId: req.tenantId }),
        });
        if (!completion) return res.status(409).json({ error: "Sprint already completed" });

        // Tell the team what actually moved, not just that the sprint closed.
        await notifySprintCompleted(req, sprint, {
            sprintName: sprint.name,
            doneTasks: completion.doneTasks,
            totalTasks: completion.totalTasks,
            velocity: completion.velocity,
            rolledOver: completion.rolledOver,
            rolloverTarget: completion.rolloverTarget,
        }).catch(() => undefined);

        res.json({
            sprint: completion.sprint,
            velocity: completion.velocity,
            doneTasks: completion.doneTasks,
            totalTasks: completion.totalTasks,
            rolledOver: completion.rolledOver,
            rolloverTarget: completion.rolloverTarget,
            rolloverTargetType: completion.rolloverTargetType,
            targetSprint: completion.targetSprint ? {
                id: completion.targetSprint.id,
                name: completion.targetSprint.name,
                start_date: completion.targetSprint.start_date,
                end_date: completion.targetSprint.end_date,
            } : null,
        });
    } catch (err) {
        if (err instanceof SprintCompletionError) {
            return res.status(err.code === "TARGET_INVALID" ? 400 : 409)
                .json({ error: err.message, code: err.code });
        }
        req.log.error({ err }, "Error completing sprint");
        res.status(500).json({ error: "Failed to complete sprint" });
    }
});

// ─── Sprint lifecycle: PAUSE ────────────────────────────────────────────────
//
// Pauses an active sprint. Sets status='paused' + paused_at and flags the team
// as paused so the auto-scheduler skips it (the cadence clock effectively
// freezes). Restricted to team_lead and above (manager / admins inherit).
router.post("/:id/pause", auth, loadUserContext, requireScrumSprint, sprintManagementRole, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!await canManageSprint(req.db!, sprint, taskActorFromRequest(req))) return res.status(403).json({ error: "Access denied" });
        if (sprint.status !== "active") return res.status(400).json({ error: "Only an active sprint can be paused" });

        const paused = await withSprintLifecycleLock(req, (client: any) =>
            pauseSprintForOrg(client, id, req.userOrgId ?? null));
        if (!paused) return res.status(409).json({ error: "Sprint is no longer active", code: "SPRINT_FROZEN" });
        const updated = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        res.json({ sprint: updated });
    } catch (err) {
        req.log.error({ err }, "Error pausing sprint");
        res.status(500).json({ error: "Failed to pause sprint" });
    }
});

// ─── Sprint lifecycle: RESUME ───────────────────────────────────────────────
// Re-activates, shifts end_date by the pause duration, and restarts the team's auto-scheduler.
router.post("/:id/resume", auth, loadUserContext, requireScrumSprint, sprintManagementRole, async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        const sprint = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        if (!sprint) return res.status(404).json({ error: "Sprint not found" });
        if (!await canManageSprint(req.db!, sprint, taskActorFromRequest(req))) return res.status(403).json({ error: "Access denied" });
        if (sprint.status !== "paused") return res.status(400).json({ error: "Only a paused sprint can be resumed" });
        const running = await findOtherActiveSprint(req.db!, sprint.project_id, sprint.id);
        if (running) return sprintAlreadyActive(res, running);

        const newEnd = resumedEndDate(sprint.end_date, sprint.paused_at);
        const resumed = await withLockedSprintUpdate(req, Number(id), async (client: any) => {
            await client.query(
                `UPDATE sprints s
                    SET status = 'active', paused_at = NULL, end_date = $2
                  WHERE s.id = $1
                    AND EXISTS (SELECT 1 FROM projects tm WHERE tm.id = s.project_id AND tm.org_id IS NOT DISTINCT FROM $3)`,
                [id, newEnd, req.userOrgId ?? null]
            );
        }, "paused");
        if (!resumed) return res.status(409).json({ error: "Sprint is no longer available for resume", code: "SPRINT_FROZEN" });
        const updated = await findSprintInOrg(req.db!, id, req.userOrgId ?? null);
        res.json({ sprint: updated });
    } catch (err) {
        req.log.error({ err }, "Error resuming sprint");
        res.status(500).json({ error: "Failed to resume sprint" });
    }
});

// ─── Carried-forward tickets (for Sprint Insights) ──────────────────────────
//
// Returns the tickets that were rolled INTO this sprint from a previous one
// (tasks.carried_over_from_sprint_id points at the origin sprint), along with
// the origin sprint metadata so the UI can link back. Visible to any member of
// the team (and org admins).
router.get("/:id/carried-over", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });
        const sprint = await loadAccessibleSprint(req, res, id);
        if (!sprint) return;

        const tasks = (await req.db!.query(
            `SELECT t.id, t.title, ws.key AS status, t.story_points, t.assigned_to,
                    t.carried_over_from_sprint_id,
                    os.name AS origin_sprint_name, os.id AS origin_sprint_id
               FROM tasks t
          LEFT JOIN sprints os ON os.id = t.carried_over_from_sprint_id
          LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
              WHERE t.sprint_id = $1 AND t.carried_over_from_sprint_id IS NOT NULL
              ORDER BY t.created_at ASC`,
            [id]
        )).rows;

        res.json({
            sprint_id: id,
            carriedFromSprintId: sprint.carried_from_sprint_id || null,
            tasks,
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching carried-over tasks");
        res.status(500).json({ error: "Failed to fetch carried-over tasks" });
    }
});

// ─── Burndown chart data ────────────────────────────────────────────────────
//
// Returns the per-day snapshot series + an "ideal" line computed from the
// total starting scope and the sprint duration.
router.get("/:id/burndown", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });

        const sprint = await loadAccessibleSprint(req, res, id);
        if (!sprint) return;

        // Take a fresh snapshot for today if the sprint is active so the
        // chart is always up-to-date when an admin opens it.
        if (sprint.status === "active") {
            await snapshotBurndown(req.db, id, req.userOrgId ?? null);
        }

        const snapshots = (await req.db!.query(
            `SELECT snapshot_date, total_points, done_points, remaining_points, blocked_points, open_tasks
               FROM sprint_burndown_snapshots
              WHERE sprint_id = $1
              ORDER BY snapshot_date ASC`,
            [id]
        )).rows;

        // Ideal-line: linearly burn down total starting scope across sprint duration
        const startScope = snapshots[0]?.total_points ?? 0;
        const start = new Date(sprint.start_date);
        const end = new Date(sprint.end_date);
        const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000));
        const ideal = [];
        for (let i = 0; i <= totalDays; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            ideal.push({
                date: d.toISOString().slice(0, 10),
                remaining: Math.max(0, Number(startScope) * (1 - i / totalDays)),
            });
        }

        res.json({
            sprint: { id: sprint.id, name: sprint.name, start_date: sprint.start_date, end_date: sprint.end_date, status: sprint.status },
            snapshots, ideal, startScope: Number(startScope),
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching burndown");
        res.status(500).json({ error: "Failed to fetch burndown" });
    }
});

// ─── Velocity (last N completed sprints for the team) ───────────────────────
router.get("/velocity/recent", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        if (req.query.team_id != null || req.query.unassigned != null) {
            return res.status(400).json({ error: "Team-scoped sprint queries are no longer supported" });
        }
        const actor = taskActorFromRequest(req);
        return res.json(await projectSprintVelocity(req.db!, actor, req.query));
    } catch (err) {
        req.log.error({ err }, "Error fetching velocity");
        res.status(500).json({ error: "Failed to fetch velocity" });
    }
});

// ─── Phase 3 endpoints ─────────────────────────────────────────────────────

// GET /sprints/:id/cumulative-flow
//
// Returns a per-day series of how many tasks were in each workflow-state
// CATEGORY (open / in_progress / in_review / done) over the sprint window.
// Used by the Cumulative Flow chart on the Insights view.
//
// We approximate the historical state by walking task_history rows up to the
// snapshot date. This is cheap-ish for sprint-scoped task sets and avoids the
// need for a daily snapshot table.
router.get("/:id/cumulative-flow", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });
        const sprint = await loadAccessibleSprint(req, res, id);
        if (!sprint) return;

        // Pull every task that's ever belonged to this sprint along with its
        // current workflow_state's category. We then walk task_history to
        // reconstruct the state on each day.
        const tasks = (await req.db!.query(
            `SELECT t.id, t.project_id, t.created_at, t.completed_at,
                    ws.category AS current_category,
                    ws.key      AS current_key
               FROM tasks t
          LEFT JOIN workflow_states ws ON ws.id = t.workflow_state_id
              WHERE t.sprint_id = $1`,
            [id]
        )).rows;

        if (tasks.length === 0) {
            return res.json({
                sprint: { id, start_date: sprint.start_date, end_date: sprint.end_date },
                series: [],
            });
        }

        // History rows for status changes — we use these to roll back the
        // category on each day. Any task without a history entry is assumed to
        // have been in its current category since creation.
        const taskIds = tasks.map((t: any) => t.id);
        const history = (await req.db!.query(
            `SELECT th.task_id, th.created_at, th.old_value, th.new_value
               FROM task_history th
              WHERE th.task_id = ANY($1) AND th.action = 'status_change'
              ORDER BY th.task_id, th.created_at ASC`,
            [taskIds]
        )).rows;
        const historyByTask = new Map<number, any[]>();
        for (const h of history) {
            const arr = historyByTask.get(h.task_id) || [];
            arr.push(h);
            historyByTask.set(h.task_id, arr);
        }

        // Historical status keys are project-scoped.
        const stateRows = (await req.db!.query(
            "SELECT project_id, key, category FROM workflow_states WHERE org_id = $1",
            [req.userOrgId]
        )).rows;
        const keyToCategory: Record<string, string> = {};
        for (const s of stateRows) keyToCategory[`${s.project_id}:${s.key}`] = s.category;
        // Default mappings for legacy tenants without seeded states.
        const fallback: Record<string, string> = { pending: "open", in_progress: "in_progress", in_review: "in_review", done: "done" };

        /** Reconstruct category for `task` on a given date (end of day). */
        const categoryOnDate = (task: any, date: string): string | null => {
            const dateMs = new Date(date + "T23:59:59Z").getTime();
            // Task didn't exist yet
            if (new Date(task.created_at).getTime() > dateMs) return null;
            const events = historyByTask.get(task.id) || [];
            // Find the last status change that happened on or before `date`.
            // The new_value at that point is the state on that date.
            let key = null;
            for (const ev of events) {
                if (new Date(ev.created_at).getTime() <= dateMs) key = ev.new_value;
                else break;
            }
            // No status change yet → it's been in its current state since
            // creation. We approximate using the current key (best effort —
            // historical accuracy degrades for tasks that moved before the
            // earliest history row).
            if (!key) key = task.current_key;
            return keyToCategory[`${task.project_id}:${key}`] || fallback[key] || "open";
        };

        // Build day list from sprint.start_date → min(today, sprint.end_date).
        const today = new Date().toISOString().slice(0, 10);
        const endDate = (sprint.completed_at ? new Date(sprint.completed_at).toISOString().slice(0, 10) : sprint.end_date);
        const limitDate = today < endDate ? today : endDate;
        const days = [];
        let cursor = sprint.start_date;
        while (cursor <= limitDate) {
            days.push(cursor);
            const d = new Date(cursor + "T00:00:00Z");
            d.setUTCDate(d.getUTCDate() + 1);
            cursor = d.toISOString().slice(0, 10);
        }

        const series = days.map(date => {
            const counts: Record<string, any> = { date, open: 0, in_progress: 0, in_review: 0, done: 0 };
            for (const t of tasks) {
                const cat = categoryOnDate(t, date);
                if (cat && counts[cat] !== undefined) counts[cat]++;
            }
            return counts;
        });

        res.json({
            sprint: { id, start_date: sprint.start_date, end_date: sprint.end_date },
            series,
        });
    } catch (err) {
        req.log.error({ err }, "Error building cumulative flow");
        res.status(500).json({ error: "Failed to build cumulative flow" });
    }
});

// GET /sprints/:id/cycle-time
//
// Returns per-task cycle time (cycle_started_at → completed_at) and lead time
// (lead_started_at → completed_at) for every completed task in the sprint,
// plus aggregate stats (avg / median / p90 in days) used by the Insights view.
router.get("/:id/cycle-time", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });
        const sprint = await loadAccessibleSprint(req, res, id);
        if (!sprint) return;

        const rows = (await req.db!.query(
            `SELECT t.id, t.title, t.story_points,
                    t.created_at, t.cycle_started_at, t.lead_started_at, t.completed_at,
                    wit.name AS type_name, wit.color AS type_color,
                    EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.cycle_started_at, t.lead_started_at, t.created_at))) / 86400.0 AS cycle_days,
                    EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.lead_started_at, t.created_at))) / 86400.0 AS lead_days
               FROM tasks t
          LEFT JOIN work_item_types wit ON wit.id = t.work_item_type_id
              WHERE t.sprint_id = $1 AND t.completed_at IS NOT NULL
              ORDER BY t.completed_at ASC`,
            [id]
        )).rows.map((r: any) => ({
            id: r.id,
            title: r.title,
            story_points: r.story_points != null ? Number(r.story_points) : null,
            type_name: r.type_name,
            type_color: r.type_color,
            cycle_days: r.cycle_days != null ? Number(Number(r.cycle_days).toFixed(2)) : null,
            lead_days: r.lead_days != null ? Number(Number(r.lead_days).toFixed(2)) : null,
            completed_at: r.completed_at,
        }));

        const stats = (key: string) => {
            const vals = rows.map((r: any) => r[key]).filter((v: any) => v != null && v >= 0).sort((a: number, b: number) => a - b);
            if (vals.length === 0) return { avg: null, median: null, p90: null, n: 0 };
            const sum = vals.reduce((a: number, b: number) => a + b, 0);
            return {
                n: vals.length,
                avg: Number((sum / vals.length).toFixed(2)),
                median: Number(vals[Math.floor(vals.length / 2)].toFixed(2)),
                p90: Number(vals[Math.floor(vals.length * 0.9)].toFixed(2)),
            };
        };

        res.json({
            sprint: { id, name: sprint.name, start_date: sprint.start_date, end_date: sprint.end_date },
            tasks: rows,
            cycle: stats("cycle_days"),
            lead: stats("lead_days"),
        });
    } catch (err) {
        req.log.error({ err }, "Error fetching cycle time");
        res.status(500).json({ error: "Failed to fetch cycle time" });
    }
});

// ── Sprint Retrospectives ──────────────────────────────────────────────────
// A retrospective is a one-row-per-sprint document with three free-text
// columns plus a JSONB array of action items and an optional team-mood vote.

function normalizeActionItems(value: any): any[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 50).map((it: any, i: number) => ({
        id: Number(it?.id) || (i + 1),
        text: String(it?.text || "").trim().slice(0, 500),
        owner: it?.owner != null ? Number(it.owner) : null,
        done: !!it?.done,
        due_date: typeof it?.due_date === "string" ? it.due_date.slice(0, 10) : null,
    })).filter((it: any) => it.text);
}

router.get("/:id/retrospective", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });
        const sprint = await loadAccessibleSprint(req, res, id);
        if (!sprint) return;
        const row = (await req.db!.query(
            `SELECT r.*, c.full_name AS created_by_name, u.full_name AS updated_by_name
               FROM sprint_retrospectives r
          LEFT JOIN users c ON c.id = r.created_by
          LEFT JOIN users u ON u.id = r.updated_by
              WHERE r.sprint_id = $1`,
            [id]
        )).rows[0];
        res.json({ sprint_id: id, retrospective: row || null });
    } catch (err) {
        req.log.error({ err }, "Error fetching retrospective");
        res.status(500).json({ error: "Failed to fetch retrospective" });
    }
});

// PUT /sprints/:id/retrospective — upsert. Anyone on the same team can edit;
// the row tracks created_by + updated_by separately.
router.put("/:id/retrospective", auth, loadUserContext, requireScrumSprint, async (req: Request, res: Response) => {
    try {
        const id = parseInt(String(req.params.id), 10);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });
        const sprint = await loadAccessibleSprint(req, res, id);
        if (!sprint) return;
        if (!await canManageSprint(req.db!, sprint, taskActorFromRequest(req))) return res.status(403).json({ error: "Access denied" });

        const b = req.body || {};
        const wentWell = b.went_well ? String(b.went_well).slice(0, 5000) : null;
        const toImprove = b.to_improve ? String(b.to_improve).slice(0, 5000) : null;
        const summary = b.summary ? String(b.summary).slice(0, 2000) : null;
        const teamMood = (b.team_mood >= 1 && b.team_mood <= 5) ? Number(b.team_mood) : null;
        const actionItems = normalizeActionItems(b.action_items);

        await req.db!.query(
            `INSERT INTO sprint_retrospectives
                (sprint_id, went_well, to_improve, action_items, team_mood, summary,
                 created_by, updated_by, updated_at)
             VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $7, NOW())
             ON CONFLICT (sprint_id) DO UPDATE SET
                went_well   = EXCLUDED.went_well,
                to_improve  = EXCLUDED.to_improve,
                action_items= EXCLUDED.action_items,
                team_mood   = EXCLUDED.team_mood,
                summary     = EXCLUDED.summary,
                updated_by  = EXCLUDED.updated_by,
                updated_at  = NOW()`,
            [id, wentWell, toImprove, JSON.stringify(actionItems), teamMood, summary, req.userId]
        );

        const row = (await req.db!.query(
            `SELECT r.*, c.full_name AS created_by_name, u.full_name AS updated_by_name
               FROM sprint_retrospectives r
          LEFT JOIN users c ON c.id = r.created_by
          LEFT JOIN users u ON u.id = r.updated_by
              WHERE r.sprint_id = $1`,
            [id]
        )).rows[0];

        res.json({ sprint_id: id, retrospective: row });
    } catch (err) {
        req.log.error({ err }, "Error saving retrospective");
        res.status(500).json({ error: "Failed to save retrospective" });
    }
});

export = router;
