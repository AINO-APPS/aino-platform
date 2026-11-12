import type { Request, Response } from "express";
const { loadLifecycleContext } = require("../../modules/tasks/tasks.workflow");
const { buildProjectBoardColumns, readProjectBoard } = require("../../modules/tasks/tasks.board");
const { taskActorFromRequest } = require("../../modules/tasks/tasks.policy");
const { enrichTasks } = require("../tasks/_helpers/enrich");

type SprintAccess = (req: Request, res: Response, id: number) => Promise<any>;

function getSprintBoard(loadAccessibleSprint: SprintAccess) {
    return async (req: Request, res: Response): Promise<void | Response> => {
        try {
            const id = parseInt(String(req.params.id), 10);
            if (isNaN(id)) return res.status(400).json({ error: "Invalid sprint id" });
            const sprint = await loadAccessibleSprint(req, res, id);
            if (!sprint) return;

            const actor = taskActorFromRequest(req);
            const projectId = Number(sprint.project_id);
            if (!Number.isInteger(projectId) || projectId < 1) {
                return res.status(409).json({ error: "Sprint is not associated with a project" });
            }
            const result = await readProjectBoard(req.db!, {
                userId: actor.userId, orgId: actor.orgId, orgRole: actor.role,
                teamIds: (req as any).userTeamIds ?? (actor.teamId == null ? [] : [actor.teamId]),
            }, projectId, id);
            const lifecycle = await loadLifecycleContext(req.db!, actor.orgId, sprint.project_id);
            return res.json({
                sprint,
                columns: buildProjectBoardColumns(lifecycle, result.project, result.tickets),
                tickets: (await enrichTasks(result.tickets, req.db!, actor, lifecycle))
                    .map((ticket: any) => ({ ...ticket, sprint_end_date: sprint.end_date })),
            });
        } catch (err) {
            req.log.error({ err }, "Error fetching sprint board:");
            res.status(500).json({ error: "Failed to fetch sprint board" });
        }
    };
}

export = { getSprintBoard };
