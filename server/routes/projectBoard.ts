import express from "express";
import type { Request, Response } from "express";
import { buildProjectBoardColumns, changeBoardSettings, ProjectBoardError, readProjectBoard } from "../modules/tasks/tasks.board";
import { loadLifecycleContext } from "../modules/tasks/tasks.workflow";
import { taskActorFromRequest } from "../modules/tasks/tasks.policy";
import { createProjectAccess } from "../modules/tasks/tasks.projectAccess";
import { projectPlanningResponse } from "../modules/tasks/tasks.projectTypeLifecycle";
import { projectSprintStatuses } from "../modules/tasks/tasks.projectTypeRepository";
import { isFeatureEnabled } from "../utils/planCatalog";
import { broadcast } from "../realtime/fanout";
const { enrichTasks } = require("./tasks/_helpers/enrich");
const auth = require("../middleware/auth");
const { loadUserContext } = require("../middleware/rbac");
const router = express.Router();

function projectActor(req: Request) {
    const actor = taskActorFromRequest(req);
    return { userId: actor.userId, orgId: actor.orgId, orgRole: actor.role,
        teamIds: (req as any).userTeamIds ?? (actor.teamId == null ? [] : [actor.teamId]) };
}

async function read(req: Request, res: Response, backlog = false) {
    const id = Number(req.params.id);
    const sprintId = req.query.sprint_id === undefined ? undefined : Number(req.query.sprint_id);
    if (!Number.isSafeInteger(id) || id <= 0 || (sprintId != null && (!Number.isSafeInteger(sprintId) || sprintId <= 0))) {
        return res.status(400).json({ error: "Invalid project or sprint id" });
    }
    try {
        const actor = taskActorFromRequest(req);
        const result = await readProjectBoard(req.db!, projectActor(req), id, sprintId, backlog);
        const lifecycle = await loadLifecycleContext(req.db!, actor.orgId, id);
        const columns = buildProjectBoardColumns(lifecycle, result.project, result.tickets);
        const tickets = await enrichTasks(result.tickets, req.db!, actor, lifecycle);
        const statuses = (await projectSprintStatuses(req.db!, [id])).get(id) ?? [];
        return res.json({
            project: projectPlanningResponse(result.project, result.capabilities, isFeatureEnabled((req.tenant ?? null) as any, "agile"), statuses),
            sprint: result.sprint, columns,
            tickets: tickets.map((ticket: any) => ({ ...ticket, sprint_end_date: result.sprint?.end_date ?? null })),
        });
    } catch (err) {
        if (err instanceof ProjectBoardError) return res.status(err.status).json({ code: err.code, error: err.message });
        req.log.error({ err }, "Failed to fetch project board");
        return res.status(500).json({ error: "Failed to fetch project board" });
    }
}

router.get("/:id/board", auth, loadUserContext, (req: Request, res: Response) => read(req, res));
router.get("/:id/backlog", auth, loadUserContext, (req: Request, res: Response) => read(req, res, true));
router.patch("/:id/board-settings", auth, loadUserContext, async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid project id" });
    if (!req.body || Array.isArray(req.body) || typeof req.body !== "object") return res.status(400).json({ error: "Board settings are required" });
    try {
        const actor = projectActor(req);
        const project = await changeBoardSettings(req.db!, actor, id, req.body);
        const capabilities = await createProjectAccess(req.db!, actor).capabilities(id, project.is_archived);
        const statuses = (await projectSprintStatuses(req.db!, [id])).get(id) ?? [];
        try { broadcast(req.tenantId == null ? null : Number(req.tenantId), "project_updated", { project_id: id }); }
        catch (err) { req.log.error({ err }, "Board settings committed but realtime delivery failed"); }
        return res.json(projectPlanningResponse(project, capabilities, isFeatureEnabled((req.tenant ?? null) as any, "agile"), statuses));
    } catch (err) {
        if (err instanceof ProjectBoardError) return res.status(err.status).json({ error: err.message, code: err.code });
        req.log.error({ err }, "Failed to save board settings");
        return res.status(500).json({ error: "Failed to save board settings" });
    }
});
export = router;
