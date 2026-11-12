import { projectTypePolicy } from "./tasks.projectTypes";
import { PROJECT_TYPE_MESSAGES } from "./tasks.projectTypeLifecycle";
import type { SprintDb } from "./tasks.sprintRepository";
import { resolveTaskVisibilityForRequest, type TaskActor } from "./tasks.policy";

/** Project scopes for sprint lists never include reporter/assignee exceptions. */
export async function sprintProjectIds(actor: TaskActor, query: Record<string, unknown>): Promise<number[]> {
    const parse = (value: unknown) => value == null ? null : Number(value);
    const visibility = await resolveTaskVisibilityForRequest(actor, {
        projectId: parse(query.project_id),
    });
    if (visibility.kind === "projects") return visibility.projectIds;
    if (visibility.kind === "project") return [visibility.projectId];
    if (visibility.kind === "project-scope" && visibility.accessible) return [visibility.projectId];
    return [];
}

export async function projectSprintVelocity(db: SprintDb, actor: TaskActor, query: Record<string, unknown>) {
    const { findSprintsForProjects } = require("./tasks.sprintRepository");
    const ids = await sprintProjectIds(actor, query);
    const limit = Math.max(1, Math.min(Number(query.limit) || 6, 20));
    const series = (await findSprintsForProjects(db, actor.orgId, ids))
        .filter((sprint: any) => sprint.status === "completed")
        .sort((a: any, b: any) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
        .slice(0, limit).reverse();
    const average = series.length
        ? series.reduce((sum: number, sprint: any) => sum + Number(sprint.velocity_points || 0), 0) / series.length : 0;
    return { sprints: series, average: Number(average.toFixed(1)) };
}

export async function activeProjectSprint(db: SprintDb, orgId: number | null, projectIds: number[]) {
    if (projectIds.length === 0) return null;
    return (await db.query(
        `SELECT s.* FROM sprints s JOIN projects p ON p.id = s.project_id
         WHERE p.org_id IS NOT DISTINCT FROM $1 AND p.id = ANY($2::int[])
           AND s.status = 'active' ORDER BY s.start_date DESC LIMIT 1`,
        [orgId, projectIds],
    )).rows[0] ?? null;
}

export async function canManageSprint(db: SprintDb, sprint: any, actor: TaskActor): Promise<boolean> {
    if (!sprint?.project_id) return false;
    const role = await actor.projectAccess?.roleForProject(Number(sprint.project_id));
    if (!role || role === "viewer") return false;
    const project = (await db.query("SELECT is_archived FROM projects WHERE id = $1", [sprint.project_id])).rows[0];
    return !!project && !project.is_archived;
}

export async function addSprintManagementCapability(
    db: SprintDb,
    sprints: any[],
    actor: TaskActor,
): Promise<any[]> {
    const projectAccess = actor.projectAccess;
    const projectIds = [...new Set(sprints
        .map((sprint) => Number(sprint.project_id))
        .filter((id) => Number.isInteger(id) && id > 0))];
    if (projectIds.length === 0 || !projectAccess?.rolesForProjects) {
        return sprints.map((sprint) => ({ ...sprint, can_manage: false }));
    }

    const [roles, projects] = await Promise.all([
        projectAccess.rolesForProjects(projectIds),
        db.query(
            "SELECT id, is_archived FROM projects WHERE org_id IS NOT DISTINCT FROM $1 AND id = ANY($2::int[])",
            [actor.orgId, projectIds],
        ),
    ]);
    const archivedIds = new Set(
        projects.rows.filter((project) => project.is_archived).map((project) => Number(project.id)),
    );
    return sprints.map((sprint) => {
        const projectId = Number(sprint.project_id);
        const role = roles.get(projectId);
        return {
            ...sprint,
            can_manage: role != null && role !== "viewer" && !archivedIds.has(projectId),
        };
    });
}

export async function createProjectSprint(
    db: SprintDb,
    actor: TaskActor,
    body: Record<string, any>,
) {
    const projectId = body.project_id == null ? null : Number(body.project_id);
    const role = projectId && Number.isInteger(projectId)
        ? await actor.projectAccess?.roleForProject(projectId) : null;
    if (!role || role === "viewer") {
        return { error: { status: 403, body: { error: "Project membership required" } } };
    }
    const project = (await db.query(
        "SELECT id, type, is_archived FROM projects WHERE id = $1 AND org_id IS NOT DISTINCT FROM $2",
        [projectId, actor.orgId],
    )).rows[0];
    if (!project || project.is_archived) {
        return { error: { status: 409, body: { error: "Project is archived", code: "PROJECT_ARCHIVED" } } };
    }
    if (!projectTypePolicy(project).hasSprints) return { error: { status: 409, body: { error: PROJECT_TYPE_MESSAGES.PROJECT_HAS_NO_SPRINTS, code: "PROJECT_HAS_NO_SPRINTS" } } };
    const existing = (await db.query(
        "SELECT id FROM sprints WHERE project_id = $1 AND name = $2", [projectId, body.name],
    )).rows[0];
    if (existing) return { error: { status: 400, body: { error: "A sprint with this name already exists for this project" } } };
    const sprint = (await db.query(
        `INSERT INTO sprints (project_id, name, start_date, end_date, goal, status)
         VALUES ($1, $2, $3, $4, $5, 'planned') RETURNING *`,
        [projectId, body.name, body.start_date, body.end_date, body.goal || null],
    )).rows[0];
    return { sprint };
}
