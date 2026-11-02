import type { Request } from "express";
import type { TransactionContext } from "../../types/domain";
const { retimeSprintDueDates } = require("../../modules/tasks/tasks.placement");
const { acquirePlacementLifecycleLock } = require("../../modules/tasks/tasks.placementRepository");
const { findSprintStatusInOrg } = require("../../modules/tasks/tasks.sprintRepository");
const { placementContext } = require("../tasks/_helpers/placement");

export async function withSprintLifecycleLock<T>(
    req: Request,
    work: (client: any, context: TransactionContext) => Promise<T>,
): Promise<T> {
    return req.db!.transaction!(async (client: any, context: TransactionContext) => {
        await acquirePlacementLifecycleLock(client, req.userOrgId ?? null);
        return work(client, context ?? { afterCommit: () => undefined } as TransactionContext);
    });
}

export async function withSprintEndDateRetime(
    req: Request,
    sprintId: number,
    oldEnd: string | Date,
    newEnd: string,
    updateSprint: (client: any) => Promise<unknown>,
    expectedStatus?: string,
): Promise<boolean> {
    return withSprintLifecycleLock(req, async (client: any, { afterCommit }: TransactionContext) => {
        const sprint = await findSprintStatusInOrg(client, sprintId, req.userOrgId ?? null);
        if (!sprint || sprint.status === "completed" || (expectedStatus && sprint.status !== expectedStatus)) return false;

        const previousEnd = oldEnd instanceof Date
            ? oldEnd.toISOString().slice(0, 10)
            : String(oldEnd).slice(0, 10);
        await retimeSprintDueDates(placementContext(req, client, afterCommit), sprintId, previousEnd, newEnd);
        await updateSprint(client);
        return true;
    });
}
