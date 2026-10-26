// Sprint-read access, shared by the insights surfaces (carried-over,
// cumulative flow, cycle time, retrospectives).
//
// Reads require the same boundary as every other sprint surface: same org and,
// for non-admins, the same team.

import { canAccessSprint, type TaskActor } from "./tasks.policy";
import { findSprintWithTeam } from "./tasks.sprintRepository";

interface SprintAccessOutcome {
    sprint?: any;
    error?: { status: number; body: Record<string, unknown> };
}

async function loadSprintForActor(
    db: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
    sprintId: number,
    actor: TaskActor,
): Promise<SprintAccessOutcome> {
    const sprint = await findSprintWithTeam(db as any, sprintId);
    if (!sprint || (actor.orgId != null && sprint.org_id != null
        && Number(sprint.org_id) !== Number(actor.orgId))) {
        return { error: { status: 404, body: { error: "Sprint not found" } } };
    }
    if (!canAccessSprint(sprint, actor)) {
        return { error: { status: 403, body: { error: "Access denied" } } };
    }
    return { sprint };
}

export = { loadSprintForActor };
