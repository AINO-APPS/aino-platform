import {
    canAccessSprint, canCancelTask, canChangeTaskStatus, canWriteTask,
    isOrgAdmin, type TaskActor, type TaskRowLike,
} from "./tasks.policy";
import {
    allowsTransition, isCancelled, loadLifecycleContext, stateOf,
    type LifecycleContext, type LifecycleDb,
} from "./tasks.workflowRules";
import { isSprintFrozen, type SprintLike } from "./tasks.sprintLifecycle";
import { placementRefusal } from "./tasks.placementRules";
import { findDecisionOwners, findDecisionProjects, findDecisionSprints } from "./tasks.capabilitiesRepository";

export type CapabilityReason = "INVALID_TRANSITION" | "ACCESS_DENIED" | "SPRINT_FROZEN"
    | "IN_SPRINT" | "SPRINT_TEAM_MISMATCH" | "SPRINT_PROJECT_MISMATCH" | "CANCELLED_TERMINAL" | "READ_ONLY_ROLE" | "PROJECT_ARCHIVED"
    | "WORKLOG_CANCELLED" | "WORKLOG_FOR_OTHERS_DENIED";
export type Capability = { allowed: true } | { allowed: false; reason: CapabilityReason };
export type TicketAction = "edit" | "changeState" | "cancel" | "transfer" | "delete" | "placeInSprint" | "schedule"
    | "comment" | "logWork" | "logWorkForOthers" | "canEditEstimate";
export interface TicketDecision {
    container: "sprint" | "scheduled" | "backlog";
    capabilities: {
        transitions: Array<Capability & { to: number }>;
        can: Record<TicketAction, Capability>;
    };
}

export interface DecisionTicket extends TaskRowLike {
    id: number;
    sprint_id?: number | null;
    planned_date?: unknown;
    workflow_state_id?: number | string | null;
    completed_at?: unknown;
}

export interface TicketDecisionContext {
    lifecycle: LifecycleContext;
    lifecyclesByProject?: Map<number, LifecycleContext>;
    sprints: Map<number, SprintLike>;
    ownerTeams: Map<number, number | null>;
    projects?: Map<number, { role: string | null; archived: boolean }>;
    /** Undefined is a general action; null is a requested but unavailable destination. */
    targetSprint?: SprintLike | null;
}

export async function loadTicketDecisionContext(
    db: LifecycleDb,
    actor: TaskActor,
    tickets: readonly DecisionTicket[],
    options: { targetSprintId?: number; lifecycle?: LifecycleContext } = {},
): Promise<TicketDecisionContext> {
    const ids = [...new Set(tickets.flatMap((ticket) => ticket.sprint_id == null ? [] : [Number(ticket.sprint_id)]))];
    if (options.targetSprintId != null) ids.push(options.targetSprintId);
    const [sprintRows, lifecyclesByProject] = await Promise.all([
        findDecisionSprints(db, ids, actor.orgId),
        Promise.all([...new Set(tickets.flatMap((ticket) => !actor.projectOwnership || ticket.project_id == null ? [] : [Number(ticket.project_id)]))]
            .map(async (projectId) => [projectId, await loadLifecycleContext(db, actor.orgId, projectId)] as const)),
    ]);
    const sprints = new Map(sprintRows.map((sprint) => [Number(sprint.id), sprint]));
    const owners = actor.teamVisibility ? [] : await findDecisionOwners(db,
        [...new Set(tickets.flatMap((ticket) => ticket.user_id == null ? [] : [Number(ticket.user_id)]))], actor.orgId);
    const projects = new Map<number, { role: string | null; archived: boolean }>();
    if (actor.projectOwnership) {
        const projectIds = [...new Set(tickets.flatMap((ticket) => ticket.project_id == null ? [] : [Number(ticket.project_id)]))];
        if (projectIds.length) {
            const rows = await findDecisionProjects(db, projectIds, actor.orgId);
            await Promise.all(rows.map(async (project) => {
                projects.set(Number(project.id), {
                    role: isOrgAdmin(actor.role) ? "project_admin" : await actor.projectAccess?.roleForProject(Number(project.id)) ?? null,
                    archived: project.is_archived === true,
                });
            }));
        }
    }
    return {
        lifecycle: options.lifecycle ?? (lifecyclesByProject.length === 1
            ? lifecyclesByProject[0][1]
            : await loadLifecycleContext(db, actor.orgId, actor.projectOwnership ? undefined : null)),
        lifecyclesByProject: new Map(lifecyclesByProject),
        sprints,
        ownerTeams: new Map(owners.map((owner) => [Number(owner.id), owner.team_id])),
        projects,
        targetSprint: options.targetSprintId == null ? undefined : sprints.get(options.targetSprintId) ?? null,
    };
}

const allow: Capability = Object.freeze({ allowed: true });
const deny = (reason: CapabilityReason): Capability => ({ allowed: false, reason });

export function decideTicket(actor: TaskActor, ticket: DecisionTicket, context: TicketDecisionContext): TicketDecision {
    const lifecycle = context.lifecyclesByProject?.get(Number(ticket.project_id)) ?? context.lifecycle;
    const frozen = ticket.sprint_id != null && isSprintFrozen(context.sprints.get(Number(ticket.sprint_id)));
    const current = stateOf(lifecycle, ticket);
    const terminal = isCancelled(current);
    const ownerTeam = context.ownerTeams.get(Number(ticket.user_id));
    const project = context.projects?.get(Number(ticket.project_id));
    const sameOrg = actor.orgId == null ? ticket.org_id == null : Number(ticket.org_id ?? actor.orgId) === Number(actor.orgId);
    const own = Number(ticket.user_id) === actor.userId || Number(ticket.assigned_to) === actor.userId;
    const canRead = sameOrg && (actor.orgId == null ? own : isOrgAdmin(actor.role) || !!project?.role || own);
    const projectWrite = !canRead ? deny("ACCESS_DENIED")
        : project?.archived ? deny("PROJECT_ARCHIVED")
        : project?.role === "member" || project?.role === "project_admin" ? allow : deny("READ_ONLY_ROLE");
    const permission = actor.projectOwnership ? projectWrite : canWriteTask(ticket, actor, ownerTeam) ? allow : deny("ACCESS_DENIED");
    const edit = !permission.allowed ? permission : frozen ? deny("SPRINT_FROZEN") : allow;
    const status = actor.projectOwnership && !edit.allowed ? edit : terminal ? deny("CANCELLED_TERMINAL")
        : actor.projectOwnership ? edit
        : !canChangeTaskStatus(ticket, actor, ownerTeam) ? deny("ACCESS_DENIED") : frozen ? deny("SPRINT_FROZEN") : allow;
    const cancelPermission = !(actor.projectOwnership ? permission.allowed : canCancelTask(ticket, actor)) ? permission.allowed ? deny("ACCESS_DENIED") : permission
        : ticket.completed_at || current?.is_terminal || current?.category === "done" ? deny("INVALID_TRANSITION") : allow;
    const transitions = lifecycle.states
        .filter((state) => Number(state.id) !== Number(ticket.workflow_state_id))
        .map((state) => ({
            to: Number(state.id),
            ...(!status.allowed ? status
                : isCancelled(state) && !cancelPermission.allowed ? cancelPermission
                : allowsTransition(lifecycle, ticket.workflow_state_id, state.id)
                    ? allow : deny("INVALID_TRANSITION")),
        }));
    const changeState = transitions.some((transition) => transition.allowed)
        ? allow : !status.allowed ? status : deny("INVALID_TRANSITION");
    const cancelled = lifecycle.states.find(isCancelled);
    const cancel = !edit.allowed ? edit
        : terminal ? deny("CANCELLED_TERMINAL")
        : !cancelPermission.allowed ? cancelPermission
        : cancelled ? transitions.find((transition) => transition.to === Number(cancelled.id)) ?? deny("INVALID_TRANSITION")
            : deny("INVALID_TRANSITION");
    const schedulingRefusal = placementRefusal(ticket, { day: "" }, null, context.sprints, actor.projectOwnership);
    const sprintRefusal = context.targetSprint
        ? placementRefusal(ticket, { sprint: Number(context.targetSprint.id) }, context.targetSprint, context.sprints, actor.projectOwnership)
        : null;
    const placeInSprint = !edit.allowed ? edit
        : context.targetSprint !== undefined && !(actor.projectOwnership
            ? context.targetSprint !== null
            : canAccessSprint(context.targetSprint, actor)) ? deny("ACCESS_DENIED")
        : sprintRefusal ? deny(sprintRefusal) : allow;
    return {
        container: ticket.sprint_id != null ? "sprint" : ticket.planned_date != null ? "scheduled" : "backlog",
        capabilities: {
            transitions,
            can: {
                edit,
                logWork: !edit.allowed ? edit : terminal ? deny("WORKLOG_CANCELLED") : allow,
                logWorkForOthers: actor.projectOwnership && !edit.allowed ? edit
                    : !(isOrgAdmin(actor.role) || actor.projectOwnership && project?.role === "project_admin") ? deny("WORKLOG_FOR_OTHERS_DENIED")
                    : !edit.allowed ? edit : terminal ? deny("WORKLOG_CANCELLED") : allow,
                canEditEstimate: !edit.allowed ? edit : terminal ? deny("WORKLOG_CANCELLED") : allow,
                changeState,
                cancel: cancel.allowed ? allow : deny(cancel.reason),
                transfer: actor.projectOwnership && !edit.allowed ? edit : !isOrgAdmin(actor.role) ? deny("ACCESS_DENIED") : edit,
                delete: cancel.allowed ? allow : deny(cancel.reason),
                placeInSprint,
                schedule: !edit.allowed ? edit : schedulingRefusal ? deny(schedulingRefusal) : allow,
                comment: actor.projectOwnership ? canRead ? allow : deny("ACCESS_DENIED")
                    : canWriteTask(ticket, actor, ownerTeam) ? allow : deny("ACCESS_DENIED"),
            },
        },
    };
}

export function decideWorklog(
    actor: Pick<TaskActor, 'userId' | 'role' | 'projectOwnership'> | undefined,
    worklog: { author_id: number },
    project?: { role: string | null; archived: boolean },
) {
    const writable = !actor?.projectOwnership || project != null && !project.archived
        && (project.role === "member" || project.role === "project_admin");
    const allowed = actor != null && writable && (Number(worklog.author_id) === actor.userId
        || isOrgAdmin(actor.role) || actor.projectOwnership && project?.role === "project_admin");
    return { canEdit: allowed, canDelete: allowed };
}

export function decideTickets(actor: TaskActor, tickets: readonly DecisionTicket[], context: TicketDecisionContext) {
    return tickets.map((ticket) => decideTicket(actor, ticket, context));
}
