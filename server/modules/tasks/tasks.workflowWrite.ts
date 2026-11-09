import { assertLifecycleMove } from "./tasks.workflow";
import { lockBoardWrite } from "./tasks.boardRepository";
import type { DecisionTicket } from "./tasks.capabilities";
import type { TaskActor } from "./tasks.policy";
import type { Conflict, LifecycleDb, WorkflowState } from "./tasks.workflowRules";

export class LifecycleWriteError extends Error {
    constructor(readonly conflict: Conflict) { super(conflict.body.error); }
}

/** Recheck after the project lock, so concurrent moves cannot claim one slot. */
export async function guardLifecycleWrite(db: LifecycleDb, orgId: number | null | undefined, task: DecisionTicket,
    target: WorkflowState | null | undefined, actor: TaskActor) {
    if (task.project_id == null || !target) return;
    const fresh = await lockBoardWrite(db, Number(task.project_id), task.id, orgId ?? null);
    if (!fresh) throw new LifecycleWriteError({ status: 404, body: { code: "TASK_NOT_FOUND", error: "Ticket not found" } });
    const conflict = await assertLifecycleMove(db, orgId, fresh, target, undefined, actor);
    if (conflict) throw new LifecycleWriteError(conflict);
}

export async function withLifecycleWrite<T>(db: LifecycleDb & { transaction?: (fn: (client: any) => Promise<T>) => Promise<T> },
    orgId: number | null | undefined, task: DecisionTicket, target: WorkflowState, actor: TaskActor,
    write: (client: LifecycleDb) => Promise<T>): Promise<T> {
    if (task.project_id == null) return write(db);
    if (!db.transaction) throw new Error("Project workflow writes require a transaction");
    return db.transaction(async (client) => {
        await guardLifecycleWrite(client, orgId, task, target, actor);
        return write(client);
    });
}
