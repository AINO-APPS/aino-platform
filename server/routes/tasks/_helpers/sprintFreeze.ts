/**
 * Reject task writes against a completed sprint.
 *
 * A completed sprint is immutable: no task edits, moves or re-opening. The
 * retrospective is the only writable artefact, and it does not go through this
 * guard.
 */
import type { Request } from "express";
const { findFrozenSprintIds } = require("../../../modules/tasks/tasks.sprintLifecycle");

/**
 * Returns a 409 payload when the task's sprint is completed, otherwise null.
 *
 * `nextSprintId` lets a move out of a frozen sprint be rejected too: the
 * destination is checked as well as the origin.
 */
export async function frozenSprintError(
    req: Request,
    task: { sprint_id?: number | null } | null | undefined,
    nextSprintId?: number | null,
): Promise<{ error: string; code: string } | null> {
    const sprintIds = [task?.sprint_id, nextSprintId].filter(
        (id): id is number => typeof id === "number",
    );
    if (sprintIds.length === 0) return null;

    const frozen = await findFrozenSprintIds(req.db!, sprintIds);
    if (frozen.length === 0) return null;
    return {
        error: "This sprint is completed and no longer accepts task changes.",
        code: "SPRINT_FROZEN",
    };
}
