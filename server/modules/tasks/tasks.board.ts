import { isCancelled, type LifecycleContext, type WorkflowState } from "./tasks.workflow";
import { createProjectAccess, type ProjectAccessActor } from "./tasks.projectAccess";
import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";
import { findBoardProject, findBoardSprint, listProjectBoardTickets, writeBoardSettings } from "./tasks.boardRepository";
import { lockTypedProject } from "./tasks.projectTypeRepository";
import { projectTypePolicy, type TypedProject } from "./tasks.projectTypes";

export interface SprintBoardColumn {
    stateId: number;
    count: number;
    limit: number | null;
    accepting: boolean;
}

export function buildSprintBoardColumns(
    lifecycle: LifecycleContext,
    counts: Array<{ state_id: number | string; count: number | string }>,
): SprintBoardColumn[] {
    const countByState = new Map(counts.map((row) => [Number(row.state_id), Number(row.count)]));
    return lifecycle.states
        .filter((state: WorkflowState) => !isCancelled(state))
        .map((state) => {
            const count = countByState.get(Number(state.id)) ?? 0;
            const limit = state.wip_limit == null ? null : Number(state.wip_limit);
            return {
                stateId: Number(state.id),
                count,
                limit,
                accepting: !lifecycle.wipEnabled || !limit || count < limit,
            };
        });
}

export class ProjectBoardError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function buildProjectBoardColumns(lifecycle: LifecycleContext, project: TypedProject, tickets: Array<{ workflow_state_id: number }>) {
    const counts = new Map<number, number>();
    for (const ticket of tickets) counts.set(Number(ticket.workflow_state_id), (counts.get(Number(ticket.workflow_state_id)) ?? 0) + 1);
    return buildSprintBoardColumns(lifecycle, [...counts].map(([state_id, count]) => ({ state_id, count })))
        .filter((column) => projectTypePolicy(project).boardScope !== "open_except_initial"
            || !lifecycle.stateById.get(column.stateId)?.is_initial)
        .map((column) => ({ ...column, state: lifecycle.stateById.get(column.stateId) }));
}

export async function readProjectBoard(db: ProjectAccessRepositoryDb, actor: ProjectAccessActor,
    projectId: number, requestedSprint?: number, backlog = false) {
    const project = await findBoardProject(db, actor.orgId, projectId);
    const access = createProjectAccess(db, actor);
    if (!project || !await access.roleForProject(projectId)) {
        throw new ProjectBoardError(404, "PROJECT_NOT_FOUND", "Project not found");
    }

    const policy = projectTypePolicy(project);
    if (requestedSprint != null && !policy.hasSprints) {
        throw new ProjectBoardError(409, "PROJECT_HAS_NO_SPRINTS", "Sprints are only available in Scrum projects.");
    }
    if (backlog && !policy.hasBacklog) {
        throw new ProjectBoardError(409, "PROJECT_HAS_NO_BACKLOG", "Enable the Kanban backlog in project settings first.");
    }
    const sprint = policy.hasSprints && !backlog ? await findBoardSprint(db, projectId, requestedSprint) : null;
    if (requestedSprint != null && !sprint) throw new ProjectBoardError(404, "SPRINT_NOT_FOUND", "Sprint not found in this project");
    const tickets = await listProjectBoardTickets(db, project, sprint?.id ?? null, backlog);
    return { project, sprint, tickets, capabilities: await access.capabilities(projectId, project.is_archived) };
}

export async function changeBoardSettings(db: ProjectAccessRepositoryDb, actor: ProjectAccessActor, projectId: number, patch: Record<string, unknown>) {
    for (const key of Object.keys(patch)) {
        if (!["kanban_backlog_enabled", "enable_wip_limits"].includes(key) || typeof patch[key] !== "boolean") {
            throw new ProjectBoardError(400, "INVALID_BOARD_SETTINGS", "Board settings must be boolean switches.");
        }
    }
    if (!db.transaction) throw new Error("Board settings require a transaction");
    return db.transaction(async (client) => {
        const project = await lockTypedProject(client, projectId, Number(actor.orgId));
        if (!project || !await createProjectAccess(client, actor).roleForProject(projectId)) {
            throw new ProjectBoardError(404, "PROJECT_NOT_FOUND", "Project not found");
        }
        if (!await createProjectAccess(client, actor).allows(projectId, "administer")) {
            throw new ProjectBoardError(403, "ACCESS_DENIED", "Only project admins can change board settings.");
        }
        if (project.is_archived) throw new ProjectBoardError(409, "PROJECT_ARCHIVED", "Unarchive the project before changing its board.");
        if (patch.kanban_backlog_enabled !== undefined && project.type !== "kanban") {
            throw new ProjectBoardError(409, "PROJECT_HAS_NO_KANBAN_BACKLOG", "Only Kanban projects have an optional backlog.");
        }
        return writeBoardSettings(client, projectId, patch);
    });
}
