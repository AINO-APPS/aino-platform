import { projectTypePolicy, type ProjectType } from "./tasks.projectTypes";
import {
    isOrgAdmin, type TaskActor, type TaskRowLike,
} from "./tasks.policy";
import {
    allowsTransition, isCancelled, loadLifecycleContext, stateOf,
    type LifecycleContext, type LifecycleDb,
} from "./tasks.workflowRules";
import { isSprintFrozen, type SprintLike } from "./tasks.sprintLifecycle";
import { placementRefusal } from "./tasks.placementRules";
import { findDecisionProjects, findDecisionSprints, findDecisionHierarchy } from "./tasks.capabilitiesRepository";

export type CapabilityReason = "INVALID_TRANSITION" | "ACCESS_DENIED" | "SPRINT_FROZEN"
    | "SPRINT_PROJECT_MISMATCH" | "CANCELLED_TERMINAL" | "READ_ONLY_ROLE" | "PROJECT_ARCHIVED"
    | "PROJECT_HAS_NO_SPRINTS" | "WORKLOG_CANCELLED" | "WORKLOG_FOR_OTHERS_DENIED" | "SUBTASK_FOLLOWS_PARENT" | "INVALID_HIERARCHY";
export type Capability = { allowed: true } | { allowed: false; reason: CapabilityReason };
export type TicketAction = "edit" | "changeState" | "cancel" | "delete" | "placeInSprint"
    | "comment" | "logWork" | "logWorkForOthers" | "canEditEstimate" | "canMoveProject" | "canAddSubtask";
export interface TicketDecision {
    container: "sprint" | "board" | "backlog";
    capabilities: {
        transitions: Array<Capability & { to: number }>;
        can: Record<TicketAction, Capability>;
    };
}

export interface DecisionTicket extends TaskRowLike {
    id: number;
    sprint_id?: number | null;
    workflow_state_id?: number | string | null;
    completed_at?: unknown;
}

export interface TicketDecisionContext {
    lifecycle: LifecycleContext;
    lifecyclesByProject?: Map<number, LifecycleContext>;
    sprints: Map<number, SprintLike>;
    projects?: Map<number, { role: string | null; archived: boolean; type?: ProjectType; kanban_backlog_enabled?: boolean }>;
    /** Undefined is a general action; null is a requested but unavailable destination. */
    targetSprint?: SprintLike | null;
    subtaskIds?: Set<number>;
    epicIds?: Set<number>;
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
        Promise.all([...new Set(tickets.flatMap((ticket) => ticket.project_id == null ? [] : [Number(ticket.project_id)]))]
            .map(async (projectId) => [projectId, await loadLifecycleContext(db, actor.orgId, projectId)] as const)),
    ]);
    const sprints = new Map(sprintRows.map((sprint) => [Number(sprint.id), sprint]));
    const projects: NonNullable<TicketDecisionContext["projects"]> = new Map();
    {
        const projectIds = [...new Set(tickets.flatMap((ticket) => ticket.project_id == null ? [] : [Number(ticket.project_id)]))];
        if (projectIds.length) {
            const rows = await findDecisionProjects(db, projectIds, actor.orgId);
            await Promise.all(rows.map(async (project) => {
                projects.set(Number(project.id), {
                    role: isOrgAdmin(actor.role) ? "project_admin" : await actor.projectAccess?.roleForProject(Number(project.id)) ?? null,
                    archived: project.is_archived === true,
                    type: project.type,
                    kanban_backlog_enabled: project.kanban_backlog_enabled,
                });
            }));
        }
    }
    const hierarchy = await findDecisionHierarchy(db, tickets.map((ticket) => Number(ticket.id)), actor.orgId);
    return {
        subtaskIds: new Set(hierarchy.filter((row) => row.is_subtask).map((row) => Number(row.id))),
        epicIds: new Set(hierarchy.filter((row) => row.is_epic).map((row) => Number(row.id))),
        lifecycle: options.lifecycle ?? (lifecyclesByProject.length === 1
            ? lifecyclesByProject[0][1]
            : await loadLifecycleContext(db, actor.orgId)),
        lifecyclesByProject: new Map(lifecyclesByProject),
        sprints,
        projects,
        targetSprint: options.targetSprintId == null ? undefined : sprints.get(options.targetSprintId) ?? null,
    };
}

const allow: Capability = Object.freeze({ allowed: true });
const deny = (reason: CapabilityReason): Capability => ({ allowed: false, reason });

export function lifecycleForTicket(actor: TaskActor, ticket: DecisionTicket, context: TicketDecisionContext): LifecycleContext {
    const project = context.lifecyclesByProject?.get(Number(ticket.project_id));
    return project ?? context.lifecycle;
}

export function decideTicket(actor: TaskActor, ticket: DecisionTicket, context: TicketDecisionContext): TicketDecision {
    const followsParent = context.subtaskIds?.has(Number(ticket.id)) === true;
    const lifecycle = lifecycleForTicket(actor, ticket, context);
    const frozen = ticket.sprint_id != null && isSprintFrozen(context.sprints.get(Number(ticket.sprint_id)));
    const current = stateOf(lifecycle, ticket);
    const terminal = isCancelled(current);
    const project = context.projects?.get(Number(ticket.project_id));
    const sameOrg = actor.orgId == null ? ticket.org_id == null : Number(ticket.org_id ?? actor.orgId) === Number(actor.orgId);
    const own = Number(ticket.user_id) === actor.userId || Number(ticket.assigned_to) === actor.userId;
    const canRead = sameOrg && (actor.orgId == null ? own : isOrgAdmin(actor.role) || !!project?.role || own);
    const projectWrite = !canRead ? deny("ACCESS_DENIED")
        : project?.archived ? deny("PROJECT_ARCHIVED")
        : project?.role === "member" || project?.role === "project_admin" ? allow : deny("READ_ONLY_ROLE");
    const permission = projectWrite;
    const edit = !permission.allowed ? permission : frozen ? deny("SPRINT_FROZEN") : allow;
    const status = !edit.allowed ? edit : terminal ? deny("CANCELLED_TERMINAL") : edit;
    const cancelPermission = !permission.allowed ? permission
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
    const sprintRefusal = context.targetSprint
        ? placementRefusal(ticket, { sprint: Number(context.targetSprint.id) }, context.targetSprint, context.sprints)
        : null;
    const placeInSprint = !edit.allowed ? edit
        : followsParent ? deny("SUBTASK_FOLLOWS_PARENT")
        : project && !projectTypePolicy(project).hasSprints ? deny("PROJECT_HAS_NO_SPRINTS")
        : context.targetSprint !== undefined && context.targetSprint === null ? deny("ACCESS_DENIED")
        : sprintRefusal ? deny(sprintRefusal) : allow;
    return {
        container: projectTypePolicy(project ?? {}).hasSprints ? ticket.sprint_id != null ? "sprint" : "backlog"
            : projectTypePolicy(project ?? {}).hasBacklog && current?.is_initial ? "backlog" : "board",
        capabilities: {
            transitions,
            can: {
                edit,
                canAddSubtask: !edit.allowed ? edit : terminal ? deny("CANCELLED_TERMINAL")
                    : followsParent || context.epicIds?.has(Number(ticket.id)) ? deny("INVALID_HIERARCHY") : allow,
                logWork: !edit.allowed ? edit : terminal ? deny("WORKLOG_CANCELLED") : allow,
                logWorkForOthers: !(isOrgAdmin(actor.role) || project?.role === "project_admin") ? deny("WORKLOG_FOR_OTHERS_DENIED")
                    : !edit.allowed ? edit : terminal ? deny("WORKLOG_CANCELLED") : allow,
                canEditEstimate: !edit.allowed ? edit : terminal ? deny("WORKLOG_CANCELLED") : allow,
                changeState,
                cancel: cancel.allowed ? allow : deny(cancel.reason),
                canMoveProject: !permission.allowed ? permission : followsParent ? deny("SUBTASK_FOLLOWS_PARENT") : permission,
                delete: cancel.allowed ? allow : deny(cancel.reason),
                placeInSprint,
                comment: canRead ? allow : deny("ACCESS_DENIED"),
            },
        },
    };
}

export function decideWorklog(
    actor: Pick<TaskActor, 'userId' | 'role'> | undefined,
    worklog: { author_id: number },
    project?: { role: string | null; archived: boolean; type?: ProjectType },
) {
    const writable = project != null && !project.archived
        && (project.role === "member" || project.role === "project_admin");
    const allowed = actor != null && writable && (Number(worklog.author_id) === actor.userId
        || isOrgAdmin(actor.role) || project?.role === "project_admin");
    return { canEdit: allowed, canDelete: allowed };
}

export function decideTickets(actor: TaskActor, tickets: readonly DecisionTicket[], context: TicketDecisionContext) {
    return tickets.map((ticket) => decideTicket(actor, ticket, context));
}
