import type { Request } from "express";
const { retimeSprintDueDates } = require("../../modules/tasks/tasks.placement");
const { placementContext } = require("../tasks/_helpers/placement");

export async function withSprintEndDateRetime(
    req: Request,
    sprintId: number,
    oldEnd: string | Date,
    newEnd: string,
    updateSprint: (client: any) => Promise<unknown>,
): Promise<void> {
    await req.db!.transaction!(async (client: any, { afterCommit }: any) => {
        await updateSprint(client);
        const previousEnd = oldEnd instanceof Date
            ? oldEnd.toISOString().slice(0, 10)
            : String(oldEnd).slice(0, 10);
        await retimeSprintDueDates(placementContext(req, client, afterCommit), sprintId, previousEnd, newEnd);
    });
}
