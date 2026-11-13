/**
 * Ticket placement: the one module that moves tickets between project
 * sprints and the backlog.
 *
 * Ticket due dates are independent of sprint membership. SQL lives in
 * `tasks.placementRepository.ts`.
 *
 * Targets: "leave the sprint" and "back to the backlog" are two targets, not
 * one. Leaving a sprint (unassign, sprint completion or deletion, project
 * move) does not change ticket dates.
 *
 * Callers pass an open transaction. History and audit are written inside it;
 * realtime and notifications are handed to `effects` only after COMMIT, so a
 * rolled-back move tells nobody.
 *
 * Rank/reorder is deliberately outside this module: it changes order within a
 * container, not membership.
 */
import type { TransactionContext } from "../../types/domain";
import * as repo from "./tasks.placementRepository";
import type { HistoryRow, PlacementDb } from "./tasks.placementRepository";
import { isOrgAdmin, type TaskActor } from "./tasks.policy";
import { createProjectAccess } from "./tasks.projectAccess";
import { decideTicket, loadTicketDecisionContext } from "./tasks.capabilities";
import { CAPABILITY_DENIAL_MESSAGES } from "./tasks.denialMessages";
import { placementRefusal } from "./tasks.placementRules";
import type { PlacementTarget } from "./tasks.placementRules";
import { assertTicketHierarchy, getHierarchyTicket, getTicketSubtasks } from "./tasks.hierarchy";
import { findDecisionSubtasks } from "./tasks.capabilitiesRepository";
export { placementRefusal, type PlacementTarget } from "./tasks.placementRules";

export type { PlacementDb } from "./tasks.placementRepository";

/** Who is moving tickets, and from where (for the audit row). */
export interface PlacementActor {
    userId: number;
    orgId: number | null;
    ip?: string | null;
    userAgent?: string | null;
}

/** One committed move, handed to `effects.changed` after COMMIT. */
export interface PlacementChange {
    before: any;
    after: any;
    actor: PlacementActor;
}

export interface PlacementEffects {
    changed(change: PlacementChange): unknown | Promise<unknown>;
}

export interface PlacementContext {
    db: PlacementDb;
    afterCommit: TransactionContext["afterCommit"];
    actor: PlacementActor;
    effects: PlacementEffects;
    /** Present for user writes; sprint lifecycle maintenance is a system operation. */
    ticketActor?: TaskActor;
    /** Only the atomic create path may place a newly created subtask. */
    creatingSubtaskOf?: number;
    /** A lifecycle operation may move a subtask together with its locked parent. */
    cascadeParentIds?: Set<number>;
}

export type PlacementRefusalCode =
    | "ACCESS_DENIED"
    | "READ_ONLY_ROLE"
    | "PROJECT_ARCHIVED"
    | "SPRINT_PROJECT_MISMATCH"
    | "NOT_FOUND"
    | "SPRINT_NOT_FOUND"
    | "SPRINT_FROZEN"
    | "PROJECT_NOT_FOUND"
    | "PROJECT_UNCHANGED"
    | "WORKFLOW_NOT_FOUND"
    | "SUBTASK_FOLLOWS_PARENT";

export type PlacementResult =
    | { id: number; ok: true; task: any }
    | { id: number; ok: false; code: PlacementRefusalCode; error: string };
type PlacementRefusal = Extract<PlacementResult, { ok: false }>;
type ProjectMoveResult =
    | { id: number; ok: true; task: any; clearedSprint: { id: number; name: string } | null }
    | PlacementRefusal;

const REFUSALS: Record<PlacementRefusalCode, string> = {
    ...CAPABILITY_DENIAL_MESSAGES,
    NOT_FOUND: "Ticket not found.",
    SPRINT_NOT_FOUND: "Sprint not found.",
    PROJECT_NOT_FOUND: "Project not found in this organization.",
    PROJECT_UNCHANGED: "This ticket already belongs to that project.",
    WORKFLOW_NOT_FOUND: "The target project has no active initial workflow state.",
};

function refused(id: number, code: PlacementRefusalCode): PlacementRefusal {
    return { id, ok: false, code, error: REFUSALS[code] };
}

/**
 * Move tickets to `target`. Every ticket is decided before any is written, so a
 * rule violation never leaves a bulk move half-applied; refused tickets come
 * back with a code. A ticket already where the target puts it is returned
 * unchanged, with no history and no effect.
 */
export async function placeTickets(
    ctx: PlacementContext,
    ticketIds: number[],
    target: PlacementTarget,
): Promise<PlacementResult[]> {
    await repo.acquirePlacementLifecycleLock(ctx.db, ctx.actor.orgId);
    const ids = [...new Set(ticketIds.map(Number))];
    const subtasks = await getTicketSubtasks(ctx.db, ids, ctx.actor.orgId);
    const tickets = new Map((await repo.lockTickets(ctx.db, [...new Set([...ids, ...subtasks.map(row => Number(row.id))])], ctx.actor.orgId)).map((row) => [Number(row.id), row]));

    const targetSprintId = joinsSprint(target) ? Number(target.sprint) : null;
    const sprints = await lockSprints(ctx, [targetSprintId, ...[...tickets.values()].map((t) => t.sprint_id)]);
    const targetSprint = targetSprintId == null ? null : sprints.get(targetSprintId) ?? null;
    if (targetSprintId != null && !targetSprint && !ctx.ticketActor) {
        return ids.map((id) => refused(id, "SPRINT_NOT_FOUND"));
    }
    const context = ctx.ticketActor ? await loadTicketDecisionContext(ctx.db, ctx.ticketActor, [...tickets.values()],
        targetSprintId == null ? {} : { targetSprintId }) : null;
    if (context) {
        context.sprints = sprints;
        if (targetSprintId != null) context.targetSprint = targetSprint;
    }
    const subtaskIds = context?.subtaskIds ?? new Set((await findDecisionSubtasks(ctx.db, ids, ctx.actor.orgId)).map((row) => Number(row.id)));

    const decisions = ids.map((id) => {
        const before = tickets.get(id);
        const action = joinsSprint(target) ? "placeInSprint" : "edit";
        const creatingSubtask = ctx.creatingSubtaskOf != null && Number(before?.parent_task_id) === ctx.creatingSubtaskOf;
        const cascadingSubtask = before?.parent_task_id != null
            && ctx.cascadeParentIds?.has(Number(before.parent_task_id)) === true
            && ids.includes(Number(before.parent_task_id));
        if (creatingSubtask) context?.subtaskIds?.delete(id);
        const verdict = before && context && ctx.ticketActor
            ? decideTicket(ctx.ticketActor, before, context).capabilities.can[action] : null;
        const code = !before ? "NOT_FOUND" : verdict && !verdict.allowed ? verdict.reason
            : subtaskIds.has(id) && !creatingSubtask && !cascadingSubtask ? "SUBTASK_FOLLOWS_PARENT" : verdict ? null
            : placementRefusal(before, target, targetSprint, sprints);
        return { id, before, code };
    });

    const results: PlacementResult[] = [];
    for (const { id, before, code } of decisions) {
        if (code) {
            results.push(refused(id, code as PlacementRefusalCode));
            continue;
        }
        let parentAfter = before;
        for (const ticket of [before, ...subtasks.filter(row => Number(row.parent_task_id) === id).map(row => tickets.get(Number(row.id)))]) {
            if (alreadyThere(ticket, target)) continue;
            const after = await write(ctx.db, Number(ticket.id), targetSprint, ctx.actor.orgId);
            await record(ctx, "place", ticket, after, historyFor(ticket, after, sprints));
            if (Number(ticket.id) === id) parentAfter = after;
        }
        results.push({ id, ok: true, task: parentAfter });
    }
    return results;
}

export interface ProjectMovePreview {
    target_project_id: number;
    key_format: string;
    workflow_state: { id: number; key: string; name: string; category: string };
    leaves_sprint: boolean;
}

type MoveContext = PlacementContext & { ticketActor: TaskActor };

async function mappedMoveState(ctx: MoveContext, before: any, projectId: number) {
    const { source, states } = await repo.findMoveStates(ctx.db, before.workflow_state_id, projectId, ctx.actor.orgId);
    return states.find((candidate) => source && candidate.key === source.key)
        ?? states.find((candidate) => source && candidate.category === source.category)
        ?? states.find((candidate) => candidate.is_initial);
}

/** Preview and write share the same validation and deterministic mapping. */
async function prepareProjectMove(ctx: MoveContext, before: any, projectId: number, lock: boolean) {
    const id = Number(before.id);
    if (same(before.project_id, projectId)) return refused(id, "PROJECT_UNCHANGED");
    const projects = await repo.findMoveProjects(ctx.db, [Number(before.project_id), projectId], ctx.actor.orgId, lock);
    const source = projects.find((project) => same(project.id, before.project_id));
    const target = projects.find((project) => same(project.id, projectId));
    if (!source || !target) return refused(id, "PROJECT_NOT_FOUND");
    const access = createProjectAccess(ctx.db, {
        userId: ctx.actor.userId, orgId: ctx.actor.orgId, orgRole: ctx.ticketActor.role,
        teamIds: isOrgAdmin(ctx.ticketActor.role) ? [] : await repo.findMoveActorTeams(ctx.db, ctx.actor.userId, ctx.actor.orgId),
    });
    for (const project of [source, target]) {
        const role = isOrgAdmin(ctx.ticketActor.role) ? "project_admin"
            : await access.roleForProject(Number(project.id));
        if (role !== "member" && role !== "project_admin") return refused(id, role ? "READ_ONLY_ROLE" : "ACCESS_DENIED");
        if (project.is_archived) return refused(id, "PROJECT_ARCHIVED");
    }
    const hierarchyTicket = await getHierarchyTicket(ctx.db, id, ctx.actor.orgId);
    if (hierarchyTicket?.is_subtask) return refused(id, "SUBTASK_FOLLOWS_PARENT");
    await assertTicketHierarchy(ctx.db, { id, org_id: ctx.actor.orgId, project_id: projectId }, undefined, true);
    const state = await mappedMoveState(ctx, before, projectId);
    if (!state) return refused(id, "WORKFLOW_NOT_FOUND");
    const subtasks = await getTicketSubtasks(ctx.db, [id], ctx.actor.orgId);
    const children = [];
    for (const child of lock ? await repo.lockTickets(ctx.db, subtasks.map(row => Number(row.id)), ctx.actor.orgId) : subtasks) {
        const childState = await mappedMoveState(ctx, child, projectId);
        if (!childState) return refused(id, "WORKFLOW_NOT_FOUND");
        children.push({ before: child, stateId: Number(childState.id) });
    }
    const sprints = new Map((await repo.lockSprints(ctx.db,
        before.sprint_id == null ? [] : [Number(before.sprint_id)], ctx.actor.orgId, lock))
        .map((sprint) => [Number(sprint.id), sprint]));
    const sprint = sprints.get(Number(before.sprint_id));
    const clearedSprint = sprint && same(sprint.project_id, before.project_id) ? { id: Number(sprint.id), name: String(sprint.name) } : null;
    const preview: ProjectMovePreview = {
        target_project_id: projectId, key_format: `${target.key}-<number>`,
        workflow_state: { id: Number(state.id), key: state.key, name: state.name, category: state.category },
        leaves_sprint: clearedSprint !== null,
    };
    return { ok: true as const, target, preview, clearedSprint, sprints, children };
}

export async function previewProjectMove(ctx: MoveContext, ticketId: number, projectId: number) {
    const before = await repo.findMoveTicket(ctx.db, ticketId, ctx.actor.orgId);
    if (!before) return refused(ticketId, "NOT_FOUND");
    const prepared = await prepareProjectMove(ctx, before, projectId, false);
    return prepared.ok ? { ok: true as const, preview: prepared.preview } : prepared;
}

/** Caller owns the transaction; project/key/state, placement and history commit together. */
export async function moveTicketProject(
    ctx: MoveContext, ticketId: number, projectId: number,
): Promise<ProjectMoveResult> {
    await repo.acquirePlacementLifecycleLock(ctx.db, ctx.actor.orgId);
    const [before] = await repo.lockTickets(ctx.db, [ticketId], ctx.actor.orgId);
    if (!before) return refused(ticketId, "NOT_FOUND");
    const prepared = await prepareProjectMove(ctx, before, projectId, true);
    if (!prepared.ok) return prepared;
    const { target, preview, clearedSprint, sprints, children } = prepared;
    const after = await writeProjectMove(ctx, before, projectId, target.key, preview.workflow_state.id, sprints);
    for (const child of children) {
        await writeProjectMove(ctx, child.before, projectId, target.key, child.stateId, sprints);
    }
    return { id: ticketId, ok: true, task: after, clearedSprint };
}

async function writeProjectMove(
    ctx: MoveContext, before: any, projectId: number, projectKey: string, stateId: number,
    sprints: Map<number, any>,
) {
    const ticketId = Number(before.id);
    const number = await repo.reserveProjectTicketNumber(ctx.db, projectId);
    const key = `${projectKey}-${number}`;
    if (before.ticket_key && before.org_id != null) {
        await repo.insertTicketKeyAlias(ctx.db, Number(before.org_id), before.ticket_key, ticketId, before.project_id, "move");
    }
    const after = await repo.setProject(ctx.db, ticketId, projectId, number, key, stateId, before.sprint_id != null, ctx.actor.orgId);
    const history: HistoryRow[] = [
        { action: "transferred", field: "project", from: String(before.project_id), to: String(projectId) },
        { action: "transferred", field: "ticket_key", from: before.ticket_key, to: key },
        ...historyFor(before, after, sprints),
    ];
    if (!same(before.workflow_state_id, after.workflow_state_id)) history.push({ action: "updated", field: "workflow_state", from: before.workflow_state_id == null ? null : String(before.workflow_state_id), to: String(after.workflow_state_id) });
    await record(ctx, "move_project", before, after, history);
    return after;
}

function joinsSprint(target: PlacementTarget): target is { sprint: number } {
    return typeof target === "object" && "sprint" in target && target.sprint != null;
}

async function lockSprints(ctx: PlacementContext, ids: Array<number | null | undefined>): Promise<Map<number, any>> {
    const wanted = [...new Set(ids.filter((id): id is number => id != null).map(Number))];
    const rows = await repo.lockSprints(ctx.db, wanted, ctx.actor.orgId);
    return new Map(rows.map((row) => [Number(row.id), row]));
}

function alreadyThere(ticket: any, target: PlacementTarget): boolean {
    if (target === "backlog") return ticket.sprint_id == null;
    return same(ticket.sprint_id, target.sprint);
}

async function write(db: PlacementDb, id: number, targetSprint: any, orgId: number | null): Promise<any> {
    if (targetSprint) return repo.joinSprint(db, id, targetSprint, orgId);
    return repo.leaveSprint(db, id, orgId);
}

/** History and audit in the transaction; the change is announced after COMMIT. */
async function record(ctx: PlacementContext, action: string, before: any, after: any, history: HistoryRow[]): Promise<void> {
    await repo.insertHistory(ctx.db, Number(after.id), ctx.actor.userId, history);
    await repo.insertAudit(ctx.db, {
        orgId: ctx.actor.orgId,
        actorId: ctx.actor.userId,
        action,
        taskId: Number(after.id),
        details: { from: snapshot(before, action), to: snapshot(after, action) },
        ip: ctx.actor.ip ?? null,
        userAgent: ctx.actor.userAgent ?? null,
    });
    const change: PlacementChange = { before, after, actor: ctx.actor };
    ctx.afterCommit(() => ctx.effects.changed(change));
}

function snapshot(task: any, action: string): Record<string, unknown> {
    const placement = { sprint_id: task.sprint_id ?? null, due_date: task.due_date ?? null };
    return action === "move_project"
        ? { project_id: task.project_id, ticket_key: task.ticket_key, workflow_state_id: task.workflow_state_id, ...placement } : placement;
}

/** The history rows a move earns: only fields that actually changed. */
function historyFor(before: any, after: any, sprints: Map<number, any>): HistoryRow[] {
    const rows: HistoryRow[] = [];
    const sprintName = (id: unknown) => (id == null ? "none" : sprints.get(Number(id))?.name ?? String(id));
    if (!same(before.sprint_id, after.sprint_id)) {
        rows.push({ action: "updated", field: "sprint", from: sprintName(before.sprint_id), to: sprintName(after.sprint_id) });
    }
    if (!same(before.due_date, after.due_date)) {
        rows.push({ action: "updated", field: "due_date", from: before.due_date ?? null, to: after.due_date ?? null });
    }
    return rows;
}

function same(a: unknown, b: unknown): boolean {
    return (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
}
