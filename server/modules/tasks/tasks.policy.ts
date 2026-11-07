/**
 * The one ticket visibility and write policy.
 *
 * A ticket belongs to exactly one team while `project_ownership` is off, and
 * exactly one project when it is on. This is the one visibility boundary for
 * all ticket surfaces.
 *
 * Every list, detail, history, comment, attachment, dependency, timer, rank,
 * bulk, search, export, carry-over, notes-picker, service-desk and sprint
 * surface must come through this module. Per-endpoint visibility predicates
 * are a bug, not a shortcut.
 *
 * The per-org `project_ownership` flag switches between project roles and the
 * existing team/legacy-team policy without changing flag-off behaviour.
 */

import { createProjectAccess } from "./tasks.projectAccess";
import type { ProjectRole } from "./tasks.projectAccess";

export const ORG_ADMIN_ROLES = ["super_admin", "hr_admin", "platform_admin"] as const;

export function isOrgAdmin(role: string | null | undefined): boolean {
    return ORG_ADMIN_ROLES.includes(role as (typeof ORG_ADMIN_ROLES)[number]);
}

/** The actor as the policy sees them, resolved once per request. */
export interface TaskActor {
    userId: number;
    orgId: number | null;
    teamId: number | null;
    role: string | null;
    /** Per-org `team_visibility` flag. Off restores the creator-team rule. */
    teamVisibility: boolean;
    /** Per-org project switch, loaded from organizations.project_ownership. */
    projectOwnership?: boolean;
    projectAccess?: {
        roleForProject(projectId: number): Promise<ProjectRole | null>;
        accessibleProjectIds(): Promise<number[]>;
        projectForTeam(teamId: number): Promise<number | null>;
    };
}

/** What a list surface asked for. Admins may ask for another team or the
 *  Unassigned bucket; non-admins are pinned to their own team. */
export interface VisibilityRequest {
    /** `personal` restricts the list to the actor's own tickets. */
    scope?: "personal" | null;
    /** Admin team switcher. Ignored (and rejected by the route) for others. */
    teamId?: number | null;
    /** Admin-only bucket for legacy rows with no owning team. */
    unassigned?: boolean;
    /** New project scope; legacy team_id remains supported separately. */
    projectId?: number | null;
}

export type TaskVisibility =
    | { kind: "org-admin" }
    | { kind: "team"; userId: number; teamId: number }
    /** Pre-`team_visibility` behaviour: visibility via the creator's team. */
    | { kind: "legacy-team"; userId: number; teamId: number }
    | { kind: "personal"; userId: number }
    | { kind: "unassigned" }
    | { kind: "projects"; projectIds: number[]; userId: number }
    | { kind: "project"; projectId: number }
    | { kind: "project-scope"; projectId: number; accessible: boolean; userId: number }
    | { kind: "empty" };

/** Build the actor from the request context populated by `loadUserContext`. */
export function taskActorFromRequest(req: any): TaskActor {
    if (req.__taskPolicyActor) return req.__taskPolicyActor;
    // `isFeatureEnabled(null)` is deliberately true: a request without tenant
    // context (single-tenant development, generic middleware tests) behaves
    // like the new model rather than silently regressing.
    const { isFeatureEnabled } = require("../../utils/planCatalog");
    const userId = Number(req.userId);
    const orgId = req.userOrgId ?? null;
    const teamId = req.userTeamId ?? null;
    const projectOwnership = req.projectOwnership === true;
    const actor: TaskActor = {
        userId,
        orgId,
        teamId,
        role: req.userRole ?? null,
        teamVisibility: isFeatureEnabled(req.tenant ?? null, "team_visibility"),
        projectOwnership,
        projectAccess: projectOwnership && req.db
            ? createProjectAccess(req.db, {
                userId,
                orgId,
                orgRole: req.userRole ?? null,
                teamIds: req.userTeamIds ?? (teamId == null ? [] : [Number(teamId)]),
            })
            : undefined,
    };
    req.__taskPolicyActor = actor;
    return actor;
}

/** Build the policy actor for another user row (mentions, notes pickers). */
export function taskActorFromUser(
    row: { id?: unknown; org_id?: unknown; team_id?: unknown; role?: unknown } | null | undefined,
    teamVisibility: boolean,
    db?: Parameters<typeof createProjectAccess>[0],
    projectOwnership = false,
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
        teamVisibility,
        projectOwnership,
        projectAccess: projectOwnership && db
            ? createProjectAccess(db, {
                userId,
                orgId,
                orgRole: role,
                teamIds: teamId == null ? [] : [teamId],
            })
            : undefined,
    };
}

/** Resolve the project-based list scope through the shared project access module. */
export async function resolveTaskVisibilityForRequest(
    actor: TaskActor,
    request: VisibilityRequest = {},
): Promise<TaskVisibility> {
    if (!actor.projectOwnership) return resolveTaskVisibility(actor, request);
    if (request.unassigned) return { kind: "empty" };
    if (request.scope === "personal") return personal(actor);

    const access = actor.projectAccess;
    if (!access) return { kind: "empty" };

    if (request.projectId != null) {
        const projectId = Number(request.projectId);
        if (!Number.isInteger(projectId) || projectId < 1) return { kind: "empty" };
        return {
            kind: "project-scope",
            projectId,
            accessible: (await access.roleForProject(projectId)) !== null,
            userId: actor.userId,
        };
    }

    if (request.teamId != null) {
        const projectId = await access.projectForTeam(Number(request.teamId));
        if (projectId == null || !await access.roleForProject(projectId)) return { kind: "empty" };
        return { kind: "project", projectId };
    }

    return {
        kind: "projects",
        projectIds: await access.accessibleProjectIds(),
        userId: actor.userId,
    };
}

/**
 * Resolve the visibility a list query should use.
 *
 * Order matters: a non-admin can never widen scope by supplying `team_id` or
 * `unassigned`; the routes reject those requests explicitly, and this
 * function additionally fails closed by pinning them to their own team.
 */
export function resolveTaskVisibility(
    actor: TaskActor,
    request: VisibilityRequest = {},
): TaskVisibility {
    const admin = isOrgAdmin(actor.role);

    if (request.unassigned) {
        return admin ? { kind: "unassigned" } : personal(actor);
    }

    if (request.scope === "personal") return personal(actor);

    if (admin) {
        if (request.teamId != null) return teamVisibility(actor, request.teamId);
        return { kind: "org-admin" };
    }

    if (actor.teamId == null) return personal(actor);
    return teamVisibility(actor, actor.teamId);
}

function personal(actor: TaskActor): TaskVisibility {
    return { kind: "personal", userId: actor.userId };
}

function teamVisibility(actor: TaskActor, teamId: number): TaskVisibility {
    return actor.teamVisibility
        ? { kind: "team", userId: actor.userId, teamId }
        : { kind: "legacy-team", userId: actor.userId, teamId };
}

/** True when a non-admin is trying to read a team they do not belong to. */
export function rejectsForeignTeamRequest(actor: TaskActor, teamId: number | null | undefined): boolean {
    if (teamId == null) return false;
    if (isOrgAdmin(actor.role)) return false;
    return actor.teamId == null || Number(actor.teamId) !== Number(teamId);
}

export interface VisibilityPredicate {
    sql: string;
    params: unknown[];
    /** The next free positional parameter number. */
    nextIndex: number;
}

/**
 * Translate a visibility decision into a SQL predicate over `tasks t`.
 *
 * Empty SQL means "no restriction" (org admins). Callers must still apply the
 * tenant predicate themselves.
 */
export function buildVisibilityPredicate(
    visibility: TaskVisibility,
    startIndex = 1,
): VisibilityPredicate {
    switch (visibility.kind) {
        case "empty":
            return { sql: "FALSE", params: [], nextIndex: startIndex };
        case "org-admin":
            // Organisations see every owned ticket; legacy unowned rows are
            // confined to the explicit Unassigned bucket (D3).
            return { sql: "t.team_id IS NOT NULL", params: [], nextIndex: startIndex };
        case "unassigned":
            return { sql: "t.team_id IS NULL", params: [], nextIndex: startIndex };
        case "team": {
            const p = startIndex;
            return {
                sql: `t.team_id = $${p}`,
                params: [visibility.teamId],
                nextIndex: p + 1,
            };
        }
        case "legacy-team": {
            const p = startIndex;
            return {
                sql: `(t.user_id = $${p} OR t.assigned_to = $${p} OR t.user_id IN (SELECT id FROM users WHERE team_id = $${p + 1}))`,
                params: [visibility.userId, visibility.teamId],
                nextIndex: p + 2,
            };
        }
        case "personal": {
            const p = startIndex;
            return {
                sql: `(t.user_id = $${p} OR t.assigned_to = $${p})`,
                params: [visibility.userId],
                nextIndex: p + 1,
            };
        }
        case "projects": {
            const projectIndex = startIndex;
            const userIndex = startIndex + 1;
            return {
                sql: `(t.project_id = ANY($${projectIndex}::int[]) OR t.user_id = $${userIndex} OR t.assigned_to = $${userIndex})`,
                params: [visibility.projectIds, visibility.userId],
                nextIndex: userIndex + 1,
            };
        }
        case "project": {
            const p = startIndex;
            return {
                sql: `t.project_id = $${p}`,
                params: [visibility.projectId],
                nextIndex: p + 1,
            };
        }
        case "project-scope": {
            const projectIndex = startIndex;
            if (visibility.accessible) {
                return {
                    sql: `t.project_id = $${projectIndex}`,
                    params: [visibility.projectId],
                    nextIndex: projectIndex + 1,
                };
            }
            const userIndex = projectIndex + 1;
            return {
                sql: `(t.project_id = $${projectIndex} AND (t.user_id = $${userIndex} OR t.assigned_to = $${userIndex}))`,
                params: [visibility.projectId, visibility.userId],
                nextIndex: userIndex + 1,
            };
        }
    }
}

/** The subset of a task row the policy reads. */
export interface TaskRowLike {
    user_id?: unknown;
    assigned_to?: unknown;
    org_id?: unknown;
    team_id?: unknown;
    project_id?: unknown;
}

function isOwn(task: TaskRowLike, userId: number): boolean {
    return Number(task.user_id) === Number(userId) || Number(task.assigned_to) === Number(userId);
}

function sameOrg(task: TaskRowLike, actor: TaskActor): boolean {
    if (actor.orgId == null) return task.org_id == null;
    // Legacy rows may lack org_id (the tenant DB is still the isolation
    // boundary). Treat them as same-org rather than hiding them from the
    // creator and admins.
    return task.org_id == null || Number(task.org_id) === Number(actor.orgId);
}

/**
 * Can this actor read (and therefore write) this ticket?
 *
 * `ownerTeamId` is only needed for the legacy flag-off rule, where visibility
 * still depends on the creator's *current* team; callers that have already
 * resolved it can pass it, otherwise the DB-backed wrapper loads it.
 */
export function canReadTask(
    task: TaskRowLike | null | undefined,
    actor: TaskActor,
    ownerTeamId?: number | null,
): boolean {
    if (!task) return false;

    // Callers without an org context keep the strict personal rule.
    if (actor.orgId == null) return isOwn(task, actor.userId);

    if (!sameOrg(task, actor)) return false;
    if (isOrgAdmin(actor.role)) return true;

    // A user without a team keeps the personal fallback (D4).
    if (actor.teamId == null) return isOwn(task, actor.userId);

    if (!actor.teamVisibility) {
        // Legacy: the creator's current team, plus the creator/assignee.
        if (isOwn(task, actor.userId)) return true;
        return ownerTeamId != null && Number(actor.teamId) === Number(ownerTeamId);
    }

    // Legacy unowned rows (team_id NULL) are only readable by their creator or
    // assignee, and by admins (handled above). They surface in the admin
    // Unassigned bucket rather than silently vanishing.
    if (task.team_id == null) return isOwn(task, actor.userId);

    // Ownership is authoritative: creating or being assigned a ticket does not
    // grant access once the ticket belongs to another team.
    return Number(task.team_id) === Number(actor.teamId);
}

/** Project-role visibility for direct ticket surfaces; writes remain governed by capabilities. */
export async function canReadProjectTask(
    task: TaskRowLike | null | undefined,
    actor: TaskActor,
): Promise<boolean> {
    if (!task) return false;
    if (!actor.projectOwnership) return canReadTask(task, actor);
    if (actor.orgId == null) return isOwn(task, actor.userId);
    if (!sameOrg(task, actor)) return false;
    if (isOrgAdmin(actor.role) || isOwn(task, actor.userId)) return true;
    if (task.project_id == null || !actor.projectAccess) return false;
    return (await actor.projectAccess.roleForProject(Number(task.project_id))) !== null;
}

/** Writing has the same boundary as reading in the team-owned model. */
export const canWriteTask = canReadTask;

/** Flag-off cancellation retains the creator/admin-only legacy permission. */
export function canCancelTask(task: TaskRowLike | null | undefined, actor: TaskActor): boolean {
    if (!task) return false;
    if (!actor.teamVisibility) {
        return isOrgAdmin(actor.role) || Number(task.user_id) === Number(actor.userId);
    }
    return canWriteTask(task, actor);
}

/**
 * May this actor move the ticket's workflow state?
 *
 * Any member of the owning team may, plus the creator/assignee and admins.
 * With the flag off this keeps the legacy assignee/reporter rule so turning
 * the feature off restores the previous behaviour exactly.
 */
export function canChangeTaskStatus(
    task: TaskRowLike | null | undefined,
    actor: TaskActor,
    ownerTeamId?: number | null,
): boolean {
    if (!task) return false;
    if (!canReadTask(task, actor, ownerTeamId)) return false;
    if (isOrgAdmin(actor.role)) return true;
    if (isOwn(task, actor.userId)) return true;
    if (!actor.teamVisibility) return false;
    return actor.teamId != null
        && task.team_id != null
        && Number(task.team_id) === Number(actor.teamId);
}

/** Sprint read boundary: admins see every sprint in the org, others their team's. */
export function canAccessSprint(sprint: any, actor: TaskActor): boolean {
    if (!sprint) return false;
    const sprintOrgId = sprint.org_id ?? sprint.team_org_id ?? null;
    if (actor.orgId != null && sprintOrgId != null && Number(sprintOrgId) !== Number(actor.orgId)) {
        return false;
    }

    if (isOrgAdmin(actor.role)) return true;
    return actor.teamId != null
        && sprint.team_id != null
        && Number(sprint.team_id) === Number(actor.teamId);
}

export async function canReadProjectSprint(sprint: any, actor: TaskActor): Promise<boolean> {
    if (!actor.projectOwnership) return canAccessSprint(sprint, actor);
    if (!sprint) return false;
    const sprintOrgId = sprint.org_id ?? sprint.team_org_id ?? null;
    if (actor.orgId != null && sprintOrgId != null && Number(sprintOrgId) !== Number(actor.orgId)) {
        return false;
    }
    if (isOrgAdmin(actor.role)) return true;
    if (sprint.project_id == null || !actor.projectAccess) return false;
    return (await actor.projectAccess.roleForProject(Number(sprint.project_id))) !== null;
}
