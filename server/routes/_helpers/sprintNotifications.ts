/**
 * Sprint notification fan-out.
 *
 * Two of the five task events are sprint-wide: a sprint starting and a sprint
 * completing. Both go to the team roster minus the person who caused them, and
 * both deep-link to the sprint.
 */
import { notifyUser } from "../../realtime/fanout";
import { describeSprintCompletion, sprintLink } from "../../modules/tasks/tasks.notifications";

interface SprintLike {
    id: number | string;
    name: string;
    team_id: number;
}

interface ReqLike {
    db: any;
    tenantId?: number | null;
    userId?: number;
}

/**
 * Everyone on the sprint's team, minus the person who caused the event.
 *
 * Sprint events are team-wide, so the audience is the team roster rather than
 * the assignee/creator pair a task event uses.
 */
async function sprintAudience(
    req: ReqLike,
    teamId: number,
    actorId: number | null | undefined,
): Promise<number[]> {
    const rows = (await req.db.query(
        "SELECT id FROM users WHERE team_id = $1 AND is_active = TRUE",
        [teamId],
    )).rows;
    const actor = Number(actorId);
    return rows
        .map((row: any) => Number(row.id))
        .filter((id: number) => Number.isFinite(id) && id > 0 && id !== actor);
}

export async function notifySprintStarted(req: ReqLike, sprint: SprintLike): Promise<void> {
    const audience = await sprintAudience(req, sprint.team_id, req.userId);
    for (const userId of audience) {
        await notifyUser(
            req.db,
            req.tenantId,
            userId,
            "sprint",
            `Sprint started: ${sprint.name}`,
            `${sprint.name} is now active.`,
            { link: sprintLink(sprint.id), actorId: req.userId },
        ).catch(() => undefined);
    }
}

export async function notifySprintCompleted(
    req: ReqLike,
    sprint: SprintLike,
    summary: {
        sprintName: string;
        doneTasks: number;
        totalTasks: number;
        velocity: number;
        rolledOver: number;
        rolloverTarget: string;
    },
): Promise<void> {
    const audience = await sprintAudience(req, sprint.team_id, req.userId);
    const body = describeSprintCompletion(summary);
    for (const userId of audience) {
        await notifyUser(
            req.db,
            req.tenantId,
            userId,
            "sprint",
            `Sprint completed: ${sprint.name}`,
            body,
            { link: sprintLink(sprint.id), actorId: req.userId },
        ).catch(() => undefined);
    }
}
