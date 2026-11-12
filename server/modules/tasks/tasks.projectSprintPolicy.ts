import type { ProjectAccessRepositoryDb } from "./tasks.projectAccessRepository";
import { projectTypePolicy } from "./tasks.projectTypes";
import { ProjectTypeError, PROJECT_TYPE_MESSAGES } from "./tasks.projectTypeLifecycle";

export async function assertScrumProject(db: ProjectAccessRepositoryDb, projectId: number, orgId: number | null) {
    const project = (await db.query("SELECT id, type FROM projects WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2", [projectId, orgId])).rows[0];
    if (project && !projectTypePolicy(project).hasSprints) {
        throw new ProjectTypeError(409, "PROJECT_HAS_NO_SPRINTS", PROJECT_TYPE_MESSAGES.PROJECT_HAS_NO_SPRINTS);
    }
}

export async function assertScrumSprintRequest(db: ProjectAccessRepositoryDb, orgId: number | null, input: {
    sprintId?: unknown; projectId?: unknown; teamId?: unknown;
}) {
    if (input.projectId != null) await assertScrumProject(db, Number(input.projectId), orgId);
    if (input.sprintId != null) {
        const sprint = (await db.query(
            "SELECT s.project_id FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = $1 AND p.org_id IS NOT DISTINCT FROM $2", [input.sprintId, orgId],
        )).rows[0];
        if (sprint) await assertScrumProject(db, Number(sprint.project_id), orgId);
    }
    if (input.projectId == null && input.sprintId == null && input.teamId != null) {
        const project = (await db.query("SELECT id FROM projects WHERE origin_team_id = $1 AND org_id = $2", [input.teamId, orgId])).rows[0];
        if (project) await assertScrumProject(db, Number(project.id), orgId);
    }
}
