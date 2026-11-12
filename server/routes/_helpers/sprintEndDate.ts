import type { Request } from "express";
import type { TransactionContext } from "../../types/domain";
const { retimeSprintDueDates } = require("../../modules/tasks/tasks.placement");
const { acquirePlacementLifecycleLock } = require("../../modules/tasks/tasks.placementRepository");
const { findSprintStatusInOrg } = require("../../modules/tasks/tasks.sprintRepository");

export async function withSprintLifecycleLock<T>(
    req: Request,
    work: (client: any, context: TransactionContext) => Promise<T>,
): Promise<T> {
    return req.db!.transaction!(async (client: any, context: TransactionContext) => {
        await acquirePlacementLifecycleLock(client, req.userOrgId ?? null);
        return work(client, context ?? { afterCommit: () => undefined } as TransactionContext);
    });
}

export async function withLockedSprintUpdate(
    req: Request,
    sprintId: number,
    updateSprint: (client: any) => Promise<unknown>,
    expectedStatus?: string,
): Promise<boolean> {
    return withSprintLifecycleLock(req, async (client: any) => {
        const sprint = await findSprintStatusInOrg(client, sprintId, req.userOrgId ?? null);
        if (!sprint || sprint.status === "completed" || (expectedStatus && sprint.status !== expectedStatus)) return false;

        await updateSprint(client);
        return true;
    });
}
