import type { TransactionContext } from "../types/domain";
import {
    placeTickets,
    type PlacementActor,
    type PlacementEffects,
    type PlacementDb,
} from "../modules/tasks/tasks.placement";
import * as repo from "../modules/tasks/tasks.sprintRepository";

interface SprintCompletionDb extends PlacementDb {
    transaction<T>(
        callback: (client: PlacementDb, context: TransactionContext) => Promise<T>,
    ): Promise<T>;
}

export interface CompleteSprintOptions {
    sprintId: number;
    targetSprintId: number | null;
    actor?: PlacementActor;
    effects: PlacementEffects;
}

export interface SprintCompletionResult {
    sprint: any;
    velocity: number;
    doneTasks: number;
    totalTasks: number;
    rolledOver: number;
    rolloverTarget: string;
}

export class SprintCompletionError extends Error {
    constructor(readonly code: "TARGET_INVALID" | "PLACEMENT_REFUSED", message: string) {
        super(message);
    }
}

/**
 * Complete a sprint and move its unfinished tickets in the same transaction.
 * The conditional update claims the sprint row; a concurrent caller waits for
 * that transaction, then sees the completed status and receives no claim.
 */
export async function completeSprint(
    db: SprintCompletionDb,
    options: CompleteSprintOptions,
): Promise<SprintCompletionResult | null> {
    return db.transaction(async (client, { afterCommit }) => {
        const claimed = await repo.claimSprintCompletion(client, options.sprintId);
        if (!claimed) return null;

        const team = await repo.findSprintCompletionActor(client, options.sprintId, Number(claimed.team_id));
        const actor = options.actor ?? {
            userId: Number(team?.actor_id ?? 0),
            orgId: team?.org_id == null ? null : Number(team.org_id),
        };

        let target: any = null;
        if (options.targetSprintId != null) {
            if (Number(options.targetSprintId) === Number(options.sprintId)) {
                throw new SprintCompletionError("TARGET_INVALID", "Cannot roll over to the sprint being completed");
            }
            target = await repo.findRolloverTarget(client, options.targetSprintId, Number(claimed.team_id));
            if (!target || target.status === "completed") {
                throw new SprintCompletionError("TARGET_INVALID", "Target sprint not found or completed");
            }
        }

        const members = await repo.lockSprintCompletionMembers(client, options.sprintId);
        const unfinished = members
            .filter((row: { is_terminal: boolean }) => !row.is_terminal)
            .map((row: { id: number }) => Number(row.id));

        await repo.snapshotBurndown(client, Number(options.sprintId));
        const velocity = await repo.findSprintCompletionVelocity(client, options.sprintId);
        if (unfinished.length > 0 && actor.userId <= 0) {
            throw new Error("Cannot record automated sprint placement without a team actor");
        }
        const placement = await placeTickets(
            { db: client, afterCommit, actor, effects: options.effects },
            unfinished,
            target ? { sprint: Number(target.id) } : { sprint: null },
        );
        const refusal = placement.find((result) => !result.ok);
        if (refusal && !refusal.ok) {
            throw new SprintCompletionError("PLACEMENT_REFUSED", refusal.error);
        }

        if (target && unfinished.length > 0) {
            await repo.stampTicketCarryover(client, options.sprintId, unfinished);
        }
        if (target) {
            await repo.linkSprintCarryover(client, options.sprintId, Number(target.id));
        }

        const completed = await repo.finishSprint(client, options.sprintId, Number(velocity.velocity));

        return {
            sprint: completed,
            velocity: Number(velocity.velocity),
            doneTasks: Number(velocity.done_tasks),
            totalTasks: Number(velocity.total_tasks),
            rolledOver: placement.filter((result) => result.ok && unfinished.includes(result.id)).length,
            rolloverTarget: target?.name ?? "the backlog",
        };
    });
}
