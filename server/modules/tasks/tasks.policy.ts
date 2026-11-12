import { createProjectAccess } from "./tasks.projectAccess";
import type { ProjectRole } from "./tasks.projectAccess";

export const ORG_ADMIN_ROLES = ["super_admin", "hr_admin", "platform_admin"] as const;

export function isOrgAdmin(role: string | null | undefined): boolean {
    return ORG_ADMIN_ROLES.includes(role as (typeof ORG_ADMIN_ROLES)[number]);
}

export interface TaskActor {
    userId: number;
    orgId: number | null;
    teamId: number | null;
    role: string | null;
    projectAccess?: {
        roleForProject(projectId: number): Promise<ProjectRole | null>;
        rolesForProjects?(projectIds: number[]): Promise<Map<number, ProjectRole | null>>;
        accessibleProjectIds(): Promise<number[]>;
    };
}

export interface VisibilityRequest {
    scope?: "personal" | null;
    projectId?: number | null;
}

export type TaskVisibility =
    | { kind: "org-admin" }
    | { kind: "personal"; userId: number }
    | { kind: "projects"; projectIds: number[]; userId: number }
    | { kind: "project"; projectId: number }
    | { kind: "project-scope"; projectId: number; accessible: boolean; userId: number }
    | { kind: "empty" };

export function taskActorFromRequest(req: any): TaskActor {
    if (req.__taskPolicyActor) return req.__taskPolicyActor;
    const userId = Number(req.userId);
    const orgId = req.userOrgId ?? null;
    const teamId = req.userTeamId ?? null;
    const role = req.userRole ?? null;
    const actor: TaskActor = {
        userId,
        orgId,
        teamId,
        role,
        projectAccess: req.db ? createProjectAccess(req.db, {
            userId,
            orgId,
            orgRole: role,
            teamIds: req.userTeamIds ?? (teamId == null ? [] : [Number(teamId)]),
        }) : undefined,
    };
    req.__taskPolicyActor = actor;
    return actor;
}

export function taskActorFromUser(
    row: { id?: unknown; org_id?: unknown; team_id?: unknown; role?: unknown } | null | undefined,
    db?: Parameters<typeof createProjectAccess>[0],
): TaskActor {
    const userId = Number(row?.id);
    const orgId = row?.org_id == null ? null : Number(row.org_id);
    const teamId = row?.team_id == null ? null : Number(row.team_id);
    const role = row?.role == null ? null : String(row.role);
    return {
        userId,
        orgId,
        teamId,
        role,
        projectAccess: db ? createProjectAccess(db, {
            userId, orgId, orgRole: role, teamIds: teamId == null ? [] : [teamId],
        }) : undefined,
    };
}

export async function resolveTaskVisibilityForRequest(
    actor: TaskActor,
    request: VisibilityRequest = {},
): Promise<TaskVisibility> {
    if (request.scope === "personal") return personal(actor);
    const access = actor.projectAccess;
    if (request.projectId != null) {
        const projectId = Number(request.projectId);
        if (!Number.isInteger(projectId) || projectId < 1) return { kind: "empty" };
        return {
            kind: "project-scope",
            projectId,
            accessible: isOrgAdmin(actor.role) || (await access?.roleForProject(projectId)) != null,
            userId: actor.userId,
        };
    }
    if (isOrgAdmin(actor.role)) return { kind: "org-admin" };
    if (!access) return { kind: "empty" };
    return { kind: "projects", projectIds: await access.accessibleProjectIds(), userId: actor.userId };
}

export function resolveTaskVisibility(actor: TaskActor, request: VisibilityRequest = {}): TaskVisibility {
    if (request.scope === "personal") return personal(actor);
    return isOrgAdmin(actor.role) ? { kind: "org-admin" } : personal(actor);
}

function personal(actor: TaskActor): TaskVisibility {
    return { kind: "personal", userId: actor.userId };
}

export interface VisibilityPredicate {
    sql: string;
    params: unknown[];
    nextIndex: number;
}

export function buildVisibilityPredicate(visibility: TaskVisibility, startIndex = 1): VisibilityPredicate {
    switch (visibility.kind) {
        case "empty":
            return { sql: "FALSE", params: [], nextIndex: startIndex };
        case "org-admin":
            return { sql: "", params: [], nextIndex: startIndex };
        case "personal": {
            return {
                sql: `(t.user_id = $${startIndex} OR t.assigned_to = $${startIndex})`,
                params: [visibility.userId],
                nextIndex: startIndex + 1,
            };
        }
        case "projects": {
            const userIndex = startIndex + 1;
            return {
                sql: `(t.project_id = ANY($${startIndex}::int[]) OR t.user_id = $${userIndex} OR t.assigned_to = $${userIndex})`,
                params: [visibility.projectIds, visibility.userId],
                nextIndex: userIndex + 1,
            };
        }
        case "project":
            return { sql: `t.project_id = $${startIndex}`, params: [visibility.projectId], nextIndex: startIndex + 1 };
        case "project-scope": {
            if (visibility.accessible) {
                return { sql: `t.project_id = $${startIndex}`, params: [visibility.projectId], nextIndex: startIndex + 1 };
            }
            const userIndex = startIndex + 1;
            return {
                sql: `(t.project_id = $${startIndex} AND (t.user_id = $${userIndex} OR t.assigned_to = $${userIndex}))`,
                params: [visibility.projectId, visibility.userId],
                nextIndex: userIndex + 1,
            };
        }
    }
}

export interface TaskRowLike {
    user_id?: unknown;
    assigned_to?: unknown;
    org_id?: unknown;
    project_id?: unknown;
}

function isOwn(task: TaskRowLike, userId: number): boolean {
    return Number(task.user_id) === Number(userId) || Number(task.assigned_to) === Number(userId);
}

function sameOrg(task: TaskRowLike, actor: TaskActor): boolean {
    return actor.orgId == null
        ? task.org_id == null
        : task.org_id == null || Number(task.org_id) === Number(actor.orgId);
}

export function canReadTask(task: TaskRowLike | null | undefined, actor: TaskActor): boolean {
    return !!task && sameOrg(task, actor) && (isOrgAdmin(actor.role) || isOwn(task, actor.userId));
}

export async function canReadProjectTask(
    task: TaskRowLike | null | undefined,
    actor: TaskActor,
): Promise<boolean> {
    if (!task || !sameOrg(task, actor)) return false;
    if (isOrgAdmin(actor.role) || isOwn(task, actor.userId)) return true;
    if (task.project_id == null || !actor.projectAccess) return false;
    return (await actor.projectAccess.roleForProject(Number(task.project_id))) !== null;
}

export const canWriteTask = canReadTask;

export function canCancelTask(task: TaskRowLike | null | undefined, actor: TaskActor): boolean {
    return canReadTask(task, actor);
}

export function canChangeTaskStatus(task: TaskRowLike | null | undefined, actor: TaskActor): boolean {
    return canReadTask(task, actor);
}

export function canAccessSprint(sprint: any, actor: TaskActor): boolean {
    return !!sprint && isOrgAdmin(actor.role)
        && (actor.orgId == null || sprint.org_id == null || Number(sprint.org_id) === Number(actor.orgId));
}

export async function canReadProjectSprint(sprint: any, actor: TaskActor): Promise<boolean> {
    if (!sprint || (actor.orgId != null && sprint.org_id != null
        && Number(sprint.org_id) !== Number(actor.orgId))) return false;
    if (isOrgAdmin(actor.role)) return true;
    if (sprint.project_id == null || !actor.projectAccess) return false;
    return (await actor.projectAccess.roleForProject(Number(sprint.project_id))) !== null;
}
