/**
 * Create the backlog task that mirrors a service-desk ticket.
 *
 * The task starts in its project's initial workflow state.
 */
import { findServiceDeskProject } from "./tasks.serviceDeskRepository";
import type { ServiceDeskTaskDb } from "./tasks.serviceDeskRepository";
export type { ServiceDeskTaskDb } from "./tasks.serviceDeskRepository";
export { syncServiceDeskStatus, cancelServiceDeskCopy } from "./tasks.serviceDeskRepository";

export interface ServiceDeskTaskInput {
    creatorId: number;
    orgId: number | null;
    title: string;
    description: string;
    priority: string;
    ticketId: number;
}

export async function createServiceDeskBacklogTask(
    db: ServiceDeskTaskDb,
    input: ServiceDeskTaskInput,
): Promise<void> {
    const project = await findServiceDeskProject(db, input.orgId);
    if (!project?.workflow_state_id) throw new Error("No active Service Desk project with an initial workflow state");
    await db.query(
        `INSERT INTO tasks (user_id, title, description, priority, org_id, project_id,
                           workflow_state_id, service_desk_ticket_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [input.creatorId, input.title, input.description, input.priority, input.orgId,
            project.id, project.workflow_state_id, input.ticketId],
    );
}
