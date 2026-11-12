import type { TaskActor } from "./tasks.policy";
import type { TasksDb } from "./tasks.types";
import { findPlacementProjectAudience } from "./tasks.repository";

export async function findEffortReaders(db: TasksDb, task: { project_id?: number | null },
    actor: TaskActor): Promise<number[]> {
    return task.project_id == null ? [] : findPlacementProjectAudience(db, [Number(task.project_id)], actor.orgId);
}
