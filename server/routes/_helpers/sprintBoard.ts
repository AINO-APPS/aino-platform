import type { Request, Response } from "express";
const { loadLifecycleContext } = require("../../modules/tasks/tasks.workflow");
const { buildSprintBoardColumns } = require("../../modules/tasks/tasks.board");
const { buildProjectBoardColumns, readProjectBoard } = require("../../modules/tasks/tasks.board");
const { findSprintBoardCounts } = require("../../modules/tasks/tasks.sprintRepository");
const { resolveTaskVisibilityForRequest, taskActorFromRequest } = require("../../modules/tasks/tasks.policy");
const { listSprintTasks } = require("../../modules/tasks/tasks.collection");
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
            if (actor.projectOwnership && sprint.project_id != null) {
                const result = await readProjectBoard(req.db!, {
                    userId: actor.userId, orgId: actor.orgId, orgRole: actor.role,
                    teamIds: (req as any).userTeamIds ?? (actor.teamId == null ? [] : [actor.teamId]),
                }, Number(sprint.project_id), id);
                const lifecycle = await loadLifecycleContext(req.db!, actor.orgId, sprint.project_id);
                return res.json({
                    sprint,
                    columns: buildProjectBoardColumns(lifecycle, result.project, result.tickets),
                    tickets: (await enrichTasks(result.tickets, req.db!, actor, lifecycle))
                        .map((ticket: any) => ({ ...ticket, sprint_end_date: sprint.end_date })),
                });
            }
            const lifecycle = await loadLifecycleContext(req.db!, actor.orgId, sprint.project_id);
            const visibility = await resolveTaskVisibilityForRequest(actor, {
                teamId: sprint.team_id,
                projectId: sprint.project_id,
            });
            const [tickets, counts] = await Promise.all([
                listSprintTasks(req.db!, actor.orgId, id, visibility),
                findSprintBoardCounts(req.db!, actor.orgId),
            ]);
            const boardSprint = { ...sprint };
            delete boardSprint.org_id;
            delete boardSprint.team_name;
            return res.json({
                sprint: boardSprint,
                columns: buildSprintBoardColumns(lifecycle, counts),
                tickets: await enrichTasks(tickets, req.db!, actor, lifecycle),
            });
        } catch (err) {
            req.log.error({ err }, "Error fetching sprint board:");
            res.status(500).json({ error: "Failed to fetch sprint board" });
        }
    };
}

export = { getSprintBoard };
