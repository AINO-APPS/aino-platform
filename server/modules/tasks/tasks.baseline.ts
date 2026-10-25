/**
 * Sprint scope baselines.
 *
 * A baseline records what a sprint committed when it started. Adding or
 * removing scope afterwards re-records it with a reason, so "why didn't we
 * finish" has an answer: the difference between the current scope and the
 * baseline.
 */

export type BaselineReason = "start" | "scope_add" | "scope_remove";

export interface BaselineTask {
    id: number | string;
    story_points?: number | null;
}

export interface Baseline {
    committed_points: number;
    committed_task_ids: Array<number | string>;
    reason: BaselineReason;
}

export interface ScopeDelta {
    addedPoints: number;
    removedPoints: number;
    addedCount: number;
    removedCount: number;
}

function points(tasks: BaselineTask[]): number {
    return tasks.reduce((sum, task) => sum + (Number(task.story_points) || 0), 0);
}

/** The baseline captured when a sprint starts. */
export function captureBaseline(tasks: BaselineTask[]): Baseline {
    return {
        committed_points: points(tasks),
        committed_task_ids: tasks.map((task) => task.id),
        reason: "start",
    };
}

/**
 * Compare the current scope against the baseline.
 *
 * A sprint with no scope change reports zero, never a blank.
 */
export function scopeDelta(
    baseline: Baseline | null | undefined,
    current: BaselineTask[],
): ScopeDelta {
    if (!baseline) {
        return { addedPoints: 0, removedPoints: 0, addedCount: 0, removedCount: 0 };
    }

    const baselineIds = new Set(baseline.committed_task_ids.map(String));
    const currentIds = new Set(current.map((task) => String(task.id)));

    const added = current.filter((task) => !baselineIds.has(String(task.id)));
    const removed = baseline.committed_task_ids.filter((id) => !currentIds.has(String(id)));

    // Removed points come from the baseline's committed total, so a task that
    // was deleted still counts as removed scope.
    const removedPoints = Math.max(
        0,
        Number(baseline.committed_points) - points(
            current.filter((task) => baselineIds.has(String(task.id))),
        ),
    );

    return {
        addedPoints: points(added),
        removedPoints,
        addedCount: added.length,
        removedCount: removed.length,
    };
}

/** The reason to record when scope changes after the sprint started. */
export function reasonForChange(delta: ScopeDelta): BaselineReason | null {
    if (delta.addedCount > 0 && delta.removedCount === 0) return "scope_add";
    if (delta.removedCount > 0 && delta.addedCount === 0) return "scope_remove";
    return null;
}
