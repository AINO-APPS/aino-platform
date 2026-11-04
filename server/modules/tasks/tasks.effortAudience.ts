import type { TaskActor } from "./tasks.policy";
import type { TasksDb } from "./tasks.types";
import { findPlacementProjectAudience, findTeamMemberIds } from "./tasks.repository";

export async function findEffortReaders(db: TasksDb, task: { project_id?: number | null; team_id?: number | null },
    actor: TaskActor): Promise<number[]> {
    if (actor.projectOwnership) {
        return task.project_id == null ? [] : findPlacementProjectAudience(db, [Number(task.project_id)], actor.orgId);
    }
    return task.team_id == null ? [] : findTeamMemberIds(db, task.team_id, actor.orgId);
}
