/**
 * Sprint lifecycle rules.
 *
 * A completed sprint is immutable: no task edits, moves or re-opening. The one
 * writable artefact is the retrospective. Paused sprints are presented and
 * counted as active everywhere.
 */

export interface SprintLike {
    id: number | string;
    status?: string | null;
    team_id?: number | string | null;
}

/** A sprint that accepts no task writes. */
export function isSprintFrozen(sprint: SprintLike | null | undefined): boolean {
    return sprint?.status === "completed";
}

/** Paused sprints count as active for planning and charts. */
export function isSprintActive(sprint: SprintLike | null | undefined): boolean {
    return sprint?.status === "active" || sprint?.status === "paused";
}

/** The status a client should display for a sprint. */
export function displaySprintStatus(sprint: SprintLike | null | undefined): string {
    if (!sprint) return "unknown";
    return isSprintActive(sprint) ? "active" : (sprint.status ?? "unknown");
}

export interface CarryoverTask {
    id: number | string;
    title?: string;
    story_points?: number | null;
    completed?: boolean;
}

export interface CarryoverPlan {
    /** Unfinished work that will move. */
    moving: CarryoverTask[];
    /** Finished work that stays with the closed sprint. */
    staying: CarryoverTask[];
    /** Where the unfinished work goes: a sprint id, or "backlog". */
    target: number | string | "backlog";
    movingPoints: number;
}

/**
 * Decide what happens when a sprint completes.
 *
 * The default target is the next planned sprint, otherwise the backlog. Done
 * items always stay with the sprint they finished in and are never carried.
 */
export function planCarryover(
    tasks: CarryoverTask[],
    nextPlannedSprintId: number | string | null,
    override?: number | string | "backlog" | null,
): CarryoverPlan {
    const moving = tasks.filter((task) => !task.completed);
    const staying = tasks.filter((task) => task.completed);
    const target = override ?? nextPlannedSprintId ?? "backlog";

    return {
        moving,
        staying,
        target,
        movingPoints: moving.reduce((sum, task) => sum + (Number(task.story_points) || 0), 0),
    };
}
