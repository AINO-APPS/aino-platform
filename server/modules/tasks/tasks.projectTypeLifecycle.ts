import { createProjectAccess, type ProjectAccessActor, type ProjectCapabilities } from "./tasks.projectAccess";
import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";
import { lockTypedProject, projectSprintStatuses, writeProjectType } from "./tasks.projectTypeRepository";
import { availableProjectTypes, isProjectType, projectTypeChangeRefusal, projectTypePolicy, type TypedProject } from "./tasks.projectTypes";

export class ProjectTypeError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export const PROJECT_TYPE_MESSAGES = {
    PROJECT_HAS_OPEN_SPRINTS: "Complete or remove every planned, active or paused sprint before leaving Scrum.",
    PROJECT_TYPE_NOT_AVAILABLE: "This organization can only create or change projects to Task list without the agile feature.",
    PROJECT_HAS_NO_SPRINTS: "Sprints are only available in Scrum projects.",
};

export function validateNewProjectType(value: unknown, agile: boolean) {
    const type = value === undefined ? agile ? "scrum" : "task_list" : value;
    if (!isProjectType(type)) throw new ProjectTypeError(400, "INVALID_PROJECT_TYPE", "Choose Scrum, Kanban or Task list.");
    if (!availableProjectTypes(agile).includes(type)) throw new ProjectTypeError(403, "PROJECT_TYPE_NOT_AVAILABLE", PROJECT_TYPE_MESSAGES.PROJECT_TYPE_NOT_AVAILABLE);
    return type;
}

export function projectPlanningResponse(project: TypedProject & { is_archived?: boolean }, capabilities: ProjectCapabilities,
    agile: boolean, statuses: readonly string[]) {
    const type = project.type ?? "scrum";
    const policy = projectTypePolicy(project);
    const availableTypes = availableProjectTypes(agile);
    const changeableTypes = capabilities.canChangeType ? availableTypes.filter((to) => !projectTypeChangeRefusal(type, to, agile, statuses)) : [];
    return { ...project, ...policy, availableTypes, changeableTypes, capabilities };
}

export async function changeProjectType(db: ProjectAccessRepositoryDb, actor: ProjectAccessActor, id: number, value: unknown, agile: boolean) {
    if (!isProjectType(value)) throw new ProjectTypeError(400, "INVALID_PROJECT_TYPE", "Choose Scrum, Kanban or Task list.");
    if (!db.transaction) throw new Error("Project type changes require a transaction");
    return db.transaction(async (client) => {
        const project = await lockTypedProject(client, id, Number(actor.orgId));
        if (!project) throw new ProjectTypeError(404, "PROJECT_NOT_FOUND", "Project not found");
        const access = createProjectAccess(client, actor);
        if (!await access.allows(id, "administer")) throw new ProjectTypeError(403, "ACCESS_DENIED", "Only project admins can change project type.");
        if (project.is_archived && project.type !== value) throw new ProjectTypeError(409, "PROJECT_ARCHIVED", "Unarchive the project before changing its type.");
        const statuses = (await projectSprintStatuses(client, [id])).get(id) ?? [];
        const refusal = projectTypeChangeRefusal(project.type, value, agile, statuses);
        if (refusal) throw new ProjectTypeError(refusal === "PROJECT_TYPE_NOT_AVAILABLE" ? 403 : 409, refusal, PROJECT_TYPE_MESSAGES[refusal]);
        return project.type === value ? project : writeProjectType(client, id, value);
    });
}
