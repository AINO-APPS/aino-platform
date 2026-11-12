import type { TransactionContext } from "../types/domain";
import {
    placeTickets,
    type PlacementActor,
    type PlacementEffects,
    type PlacementDb,
} from "../modules/tasks/tasks.placement";
import * as placementRepo from "../modules/tasks/tasks.placementRepository";
import * as repo from "../modules/tasks/tasks.sprintRepository";
import { assertTicketHierarchy, HierarchyRefused } from "../modules/tasks/tasks.hierarchy";
import { carryoverSprintName, planCarryover, sprintDurationDays } from "../modules/tasks/tasks.sprintLifecycle";

interface SprintCompletionDb extends PlacementDb {
    transaction<T>(
        callback: (client: PlacementDb, context: TransactionContext) => Promise<T>,
    ): Promise<T>;
}

export interface CompleteSprintOptions {
    sprintId: number;
    target?: number | string | "next" | "new" | "backlog" | null;
    /** Legacy service callers can still express an explicit sprint id or backlog. */
    targetSprintId?: number | null;
    orgId?: number | null;
    actor?: PlacementActor;
    effects: PlacementEffects;
}

export function parseSprintCompletionTarget(value: unknown): number | "next" | "new" | "backlog" | undefined | null {
    if (value == null || value === "") return undefined;
    if (value === "next" || value === "new" || value === "backlog") return value;
    const text = typeof value === "number" ? String(value) : value;
    if (typeof text !== "string" || !/^[1-9]\d*$/.test(text)) return null;
    const id = Number(text);
    return Number.isSafeInteger(id) ? id : null;
}

export interface SprintCompletionResult {
    sprint: any;
    velocity: number;
    doneTasks: number;
    totalTasks: number;
    rolledOver: number;
    rolloverTarget: string;
    rolloverTargetType: "next" | "new" | "backlog" | "sprint";
    targetSprint: any | null;
}

export class SprintCompletionError extends Error {
    constructor(readonly code: "TARGET_INVALID" | "PLACEMENT_REFUSED" | "NEW_SPRINT_UNAVAILABLE", message: string) {
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
        const orgId = options.actor ? options.actor.orgId : options.orgId;
        if (orgId === undefined) throw new Error("Sprint completion requires an organization scope");

        await placementRepo.acquirePlacementLifecycleLock(client, orgId);
        const members = await repo.lockSprintCompletionMembers(client, options.sprintId, orgId);
        const claimed = await repo.claimSprintCompletion(client, options.sprintId, orgId);
        if (!claimed) return null;

        const projectActor = await repo.findSprintCompletionActor(client, options.sprintId, orgId);
        const actor = options.actor ?? {
            userId: Number(projectActor?.actor_id ?? 0),
            orgId: projectActor?.org_id == null ? null : Number(projectActor.org_id),
        };

        const nextPlanned = await repo.findNextPlannedSprint(
            client,
            Number(claimed.project_id),
            options.sprintId,
            orgId,
        );
        const requestedTarget = options.target !== undefined
            ? options.target
            : options.targetSprintId !== undefined
                ? options.targetSprintId ?? "backlog"
                : undefined;
        const plan = planCarryover(members, nextPlanned?.id ?? null, requestedTarget);
        let target: any = null;
        let rolloverTargetType: "next" | "new" | "backlog" | "sprint" = "backlog";
        if (plan.target === "new") {
            const durationDays = sprintDurationDays(claimed.start_date, claimed.end_date);
            if (!durationDays || !claimed.project_id) {
                throw new SprintCompletionError("NEW_SPRINT_UNAVAILABLE", "Cannot create a next sprint without valid sprint dates and project ownership");
            }
            const dates = await repo.findCarryoverSprintDateRange(client, durationDays);
            target = await repo.createCarryoverSprint(
                client,
                Number(claimed.project_id),
                orgId,
                carryoverSprintName(String(claimed.name), options.sprintId),
                dates.start_date,
                dates.end_date,
            );
            if (!target) {
                throw new SprintCompletionError("NEW_SPRINT_UNAVAILABLE", "Cannot create a next sprint in this project");
            }
            rolloverTargetType = "new";
        } else if (plan.target !== "backlog") {
            if (Number(plan.target) === Number(options.sprintId)) {
                throw new SprintCompletionError("TARGET_INVALID", "Cannot roll over to the sprint being completed");
            }
            target = await repo.findRolloverTarget(client, Number(plan.target), Number(claimed.project_id), orgId);
            const selectedNext = String(plan.target) === String(nextPlanned?.id);
            if (!target || target.status === "completed" || (selectedNext && target.status !== "planned")) {
                throw new SprintCompletionError("TARGET_INVALID", "Target sprint not found or completed");
            }
            rolloverTargetType = selectedNext ? "next" : "sprint";
        }

        for (const parent of plan.movingParents) {
            try {
                await assertTicketHierarchy(client, { id: Number(parent.id), org_id: orgId });
            } catch (error) {
                if (error instanceof HierarchyRefused) {
                    throw new SprintCompletionError("PLACEMENT_REFUSED", error.message);
                }
                throw error;
            }
        }
        const unfinished = plan.moving.map((row) => Number(row.id));

        await repo.snapshotBurndown(client, Number(options.sprintId), orgId);
        const velocity = await repo.findSprintCompletionVelocity(client, options.sprintId, orgId);
        if (unfinished.length > 0 && actor.userId <= 0) {
            throw new Error("Cannot record automated sprint placement without a team actor");
        }
        const placement = await placeTickets(
            {
                db: client,
                afterCommit,
                actor,
                effects: options.effects,
                cascadeParentIds: new Set(plan.movingParents.map((parent) => Number(parent.id))),
            },
            plan.movingParents.map(parent => Number(parent.id)),
            target ? { sprint: Number(target.id) } : { sprint: null },
        );
        const refusal = placement.find((result) => !result.ok);
        if (refusal && !refusal.ok) {
            throw new SprintCompletionError("PLACEMENT_REFUSED", refusal.error);
        }

        if (target && unfinished.length > 0) {
            await repo.stampTicketCarryover(client, options.sprintId, unfinished, orgId);
        }
        if (target) {
            await repo.linkSprintCarryover(client, options.sprintId, Number(target.id), orgId);
        }

        const completed = await repo.finishSprint(client, options.sprintId, Number(velocity.velocity), orgId);

        return {
            sprint: completed,
            velocity: Number(velocity.velocity),
            doneTasks: Number(velocity.done_tasks),
            totalTasks: Number(velocity.total_tasks),
            rolledOver: unfinished.length,
            rolloverTarget: target?.name ?? "the backlog",
            rolloverTargetType,
            targetSprint: target,
        };
    });
}
