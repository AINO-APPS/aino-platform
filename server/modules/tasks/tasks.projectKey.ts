import { createProjectAccess, type ProjectAccessActor } from "./tasks.projectAccess";
import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";
import { countProjectTickets, lockProjectKey, projectKeyInUse, rewriteProjectKey } from "./tasks.projectKeyRepository";

export class ProjectKeyError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export async function changeProjectKey(
    db: ProjectAccessRepositoryDb,
    actor: ProjectAccessActor,
    projectId: number,
    key: unknown,
    preview: boolean,
) {
    if (!db.transaction) throw new Error("Project key changes require a transaction");
    try {
        return await db.transaction(async (client) => {
            const project = actor.orgId ? await lockProjectKey(client, projectId, actor.orgId) : null;
            if (!project) throw new ProjectKeyError(404, "PROJECT_NOT_FOUND", "Project not found");
            if (!await createProjectAccess(client, actor).allows(projectId, "renameKey")) {
                throw new ProjectKeyError(403, "ACCESS_DENIED", "Only project admins can rename project keys");
            }
            if (typeof key !== "string" || !/^[A-Z][A-Z0-9_]{1,9}$/.test(key)) {
                throw new ProjectKeyError(400, "INVALID_PROJECT_KEY",
                    "Project key must be 2–10 uppercase letters/digits/underscores starting with a letter.");
            }
            if (await projectKeyInUse(client, actor.orgId!, key)) {
                throw new ProjectKeyError(409, "PROJECT_KEY_CONFLICT", "Project key is already in use or reserved");
            }
            const affected = preview
                ? await countProjectTickets(client, projectId)
                : await rewriteProjectKey(client, {
                    projectId, orgId: actor.orgId!, actorId: actor.userId,
                    oldKey: project.key, newKey: key, published: project.key_published,
                });
            return { project_id: projectId, old_key: project.key, new_key: key, affected_tickets: affected };
        });
    } catch (error) {
        if ((error as { code?: string }).code === "23505") {
            throw new ProjectKeyError(409, "PROJECT_KEY_CONFLICT", "Project key is already in use or reserved");
        }
        throw error;
    }
}
