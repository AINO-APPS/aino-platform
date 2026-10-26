/**
 * The one ticket visibility and write policy.
 *
 * A ticket belongs to exactly one team (`tasks.team_id`). Membership of that
 * team — not authorship of the ticket — is the boundary for reading and
 * writing it. Org admins read and write everything in the org. Users without
 * a team keep a personal fallback (only tickets they created or are assigned).
 *
 * Every list, detail, history, comment, attachment, dependency, timer, rank,
 * bulk, search, export, carry-over, notes-picker, service-desk and sprint
 * surface must come through this module. Per-endpoint visibility predicates
 * are a bug, not a shortcut.
 *
 * Rollout is gated by the per-org `team_visibility` flag. When it is off the
 * legacy creator-team predicate is used so the change is reversible without a
 * data migration.
 */

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
}

export type TaskVisibility =
    | { kind: "org-admin" }
    | { kind: "team"; userId: number; teamId: number }
    /** Pre-`team_visibility` behaviour: visibility via the creator's team. */
    | { kind: "legacy-team"; userId: number; teamId: number }
    | { kind: "personal"; userId: number }
    | { kind: "unassigned" };

/** Build the actor from the request context populated by `loadUserContext`. */
export function taskActorFromRequest(req: any): TaskActor {
    // `isFeatureEnabled(null)` is deliberately true: a request without tenant
    // context (single-tenant development, generic middleware tests) behaves
    // like the new model rather than silently regressing.
    const { isFeatureEnabled } = require("../../utils/planCatalog");
    return {
        userId: Number(req.userId),
        orgId: req.userOrgId ?? null,
        teamId: req.userTeamId ?? null,
        role: req.userRole ?? null,
        teamVisibility: isFeatureEnabled(req.tenant ?? null, "team_visibility"),
    };
}

/** Build the policy actor for another user row (mentions, notes pickers). */
export function taskActorFromUser(
    row: { id?: unknown; org_id?: unknown; team_id?: unknown; role?: unknown } | null | undefined,
    teamVisibility: boolean,
): TaskActor {
    return {
        userId: Number(row?.id),
        orgId: row?.org_id == null ? null : Number(row.org_id),
        teamId: row?.team_id == null ? null : Number(row.team_id),
        role: row?.role == null ? null : String(row.role),
        teamVisibility,
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
    }
}

/** The subset of a task row the policy reads. */
export interface TaskRowLike {
    user_id?: unknown;
    assigned_to?: unknown;
    org_id?: unknown;
    team_id?: unknown;
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

/** Writing has the same boundary as reading in the team-owned model. */
export const canWriteTask = canReadTask;

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
