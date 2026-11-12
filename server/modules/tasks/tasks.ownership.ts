import { isOrgAdmin, type TaskActor } from "./tasks.policy";
import { findDefaultTicketProject } from "./tasks.repository";
import { findProjectById } from "./tasks.projectAccessRepository";
import { projectCapabilities } from "./tasks.projectAccess";

export interface OwnershipDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

export interface OwnershipError {
    status: number;
    body: Record<string, unknown>;
}

export async function resolveCreateProjectId(
    db: OwnershipDb,
    options: { actor: TaskActor; explicitProjectId?: unknown; sprintId: number | null },
): Promise<{ projectId: number | null; error?: OwnershipError }> {
    const { actor, explicitProjectId } = options;
    if (actor.orgId == null) throw new Error("Ticket creation requires an organization project");
    const explicit = explicitProjectId !== undefined && explicitProjectId !== null && explicitProjectId !== "";
    const id = explicit ? Number(explicitProjectId) : null;
    if (explicit && (!Number.isSafeInteger(id) || Number(id) <= 0)) {
        return { projectId: null, error: { status: 400, body: { error: "Invalid project" } } };
    }

    const resolvedProjectId = id ?? await findDefaultTicketProject(db, actor.orgId, options.sprintId);
    if (resolvedProjectId == null) throw new Error("No default project exists for this organization");
    const projectId: number = resolvedProjectId;
    const project = await findProjectById(db, projectId, actor.orgId);
    if (!project) return { projectId: null, error: { status: 400, body: { error: "Invalid project" } } };
    if (project.is_archived) return { projectId: null, error: { status: 409, body: {
        error: "This project is archived and its tickets are read-only.", code: "PROJECT_ARCHIVED",
    } } };
    const role = isOrgAdmin(actor.role) ? "project_admin" : await actor.projectAccess?.roleForProject(projectId) ?? null;
    if (!projectCapabilities(role).canCreateTickets) return { projectId: null, error: { status: 403, body: {
        error: "Your project role allows reading and commenting only.", code: "READ_ONLY_ROLE",
    } } };
    return { projectId };
}
