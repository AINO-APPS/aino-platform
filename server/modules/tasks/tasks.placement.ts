/**
 * Ticket placement: the one module that moves tickets between the three
 * planning containers (sprint, Scheduled, backlog) — ADR-015.
 *
 * Every write to `sprint_id`, `planned_date`, and the due-date bookkeeping
 * that goes with sprint membership (`due_date` ↔ `pre_sprint_due_date`) goes
 * through here, so the rules live in one place instead of in every route
 * (architecture review 2026-11-01; `.scratch/ticket-placement/spec.md`).
 * SQL lives in `tasks.placementRepository.ts`.
 *
 * Targets: "leave the sprint" and "back to the backlog" are two targets, not
 * one. Leaving a sprint (unassign, sprint completion or deletion, transfer)
 * keeps a planned day the ticket already had, so it lands in Scheduled — the
 * sprint only outranked the day. "Back to the backlog" is the user's explicit
 * request to clear both.
 *
 * Callers pass an open transaction. History and audit are written inside it;
 * realtime and notifications are handed to `effects` only after COMMIT, so a
 * rolled-back move tells nobody.
 *
 * Rank/reorder is deliberately outside this module: it changes order within a
 * container, not membership.
 */
import type { TransactionContext } from "../../types/domain";
import { teamAfterSprintMove } from "./tasks.ownership";
import * as repo from "./tasks.placementRepository";
import type { HistoryRow, PlacementDb } from "./tasks.placementRepository";
import { isOrgAdmin, type TaskActor } from "./tasks.policy";
import { createProjectAccess } from "./tasks.projectAccess";
import { decideTicket, loadTicketDecisionContext } from "./tasks.capabilities";
import { CAPABILITY_DENIAL_MESSAGES } from "./tasks.denialMessages";
import { placementRefusal } from "./tasks.placementRules";
import type { PlacementTarget } from "./tasks.placementRules";
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
    projectOwnership?: boolean;
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
    projectOwnership?: boolean;
}

export type PlacementRefusalCode =
    | "ACCESS_DENIED"
    | "READ_ONLY_ROLE"
    | "PROJECT_ARCHIVED"
    | "NOT_FOUND"
    | "SPRINT_NOT_FOUND"
    | "SPRINT_FROZEN"
    | "SPRINT_TEAM_MISMATCH"
    | "SPRINT_PROJECT_MISMATCH"
    | "IN_SPRINT"
    | "TEAM_NOT_FOUND"
    | "TEAM_UNCHANGED"
    | "PROJECT_NOT_FOUND"
    | "PROJECT_UNCHANGED"
    | "WORKFLOW_NOT_FOUND";

export type PlacementResult =
    | { id: number; ok: true; task: any }
    | { id: number; ok: false; code: PlacementRefusalCode; error: string };

export type TransferPlacementResult =
    | {
        id: number;
        ok: true;
        task: any;
        oldTeamId: number | null;
        clearedSprint: { id: number; name: string } | null;
    }
    | Extract<PlacementResult, { ok: false }>;

const REFUSALS: Record<PlacementRefusalCode, string> = {
    ...CAPABILITY_DENIAL_MESSAGES,
    NOT_FOUND: "Ticket not found.",
    SPRINT_NOT_FOUND: "Sprint not found.",
    TEAM_NOT_FOUND: "Team not found in this organization.",
    TEAM_UNCHANGED: "This ticket already belongs to that team.",
    PROJECT_NOT_FOUND: "Project not found in this organization.",
    PROJECT_UNCHANGED: "This ticket already belongs to that project.",
    WORKFLOW_NOT_FOUND: "The target project has no active initial workflow state.",
};

function refused(id: number, code: PlacementRefusalCode): PlacementResult {
    return { id, ok: false, code, error: REFUSALS[code] };
}

function refusedTransfer(id: number, code: PlacementRefusalCode): Extract<TransferPlacementResult, { ok: false }> {
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
    const projectOwnership = ctx.projectOwnership ?? ctx.ticketActor?.projectOwnership ?? false;
    const tickets = new Map((await repo.lockTickets(ctx.db, ids, ctx.actor.orgId)).map((row) => [Number(row.id), row]));

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

    const decisions = ids.map((id) => {
        const before = tickets.get(id);
        const action = plansDay(target) ? "schedule" : joinsSprint(target) ? "placeInSprint" : "edit";
        const verdict = before && context && ctx.ticketActor
            ? decideTicket(ctx.ticketActor, before, context).capabilities.can[action] : null;
        const code = !before ? "NOT_FOUND" : verdict
            ? verdict.allowed ? null : verdict.reason
            : placementRefusal(before, target, targetSprint, sprints, projectOwnership);
        return { id, before, code };
    });

    const results: PlacementResult[] = [];
    for (const { id, before, code } of decisions) {
        if (code) {
            results.push(refused(id, code as PlacementRefusalCode));
            continue;
        }
        if (alreadyThere(before, target)) {
            results.push({ id, ok: true, task: before });
            continue;
        }
        const after = await write(ctx.db, id, before, target, targetSprint, projectOwnership);
        await record(ctx, "place", before, after, historyFor(before, after, sprints));
        results.push({ id, ok: true, task: after });
    }
    return results;
}

/**
 * Legacy team transfer delegates to the generated project's placement.
 * Before switch-over it remains admin-only and also changes legacy team data.
 */
export async function transferTicket(
    ctx: PlacementContext & { ticketActor: TaskActor },
    ticketId: number,
    toTeamId: number,
): Promise<TransferPlacementResult> {
    await repo.acquirePlacementLifecycleLock(ctx.db, ctx.actor.orgId);
    const id = Number(ticketId);
    const [before] = await repo.lockTickets(ctx.db, [id], ctx.actor.orgId);
    if (!before) return refusedTransfer(id, "NOT_FOUND");
    const context = await loadTicketDecisionContext(ctx.db, ctx.ticketActor, [before]);
    const verdict = decideTicket(ctx.ticketActor, before, context).capabilities.can.transfer;
    if (!verdict.allowed) return refusedTransfer(id, verdict.reason as PlacementRefusalCode);

    const team = await repo.findTeamInOrg(ctx.db, toTeamId, ctx.actor.orgId);
    if (!team) return refusedTransfer(id, "TEAM_NOT_FOUND");
    if (!ctx.ticketActor.projectOwnership && same(before.team_id, team.id)) return refusedTransfer(id, "TEAM_UNCHANGED");
    const project = await repo.ensureTeamProject(ctx.db, team.id, ctx.actor.orgId);
    if (!project) return refusedTransfer(id, "TEAM_NOT_FOUND");
    if (same(before.project_id, project.id)) return refusedTransfer(id, "TEAM_UNCHANGED");
    return moveTicketProject(ctx, id, Number(project.id), { legacyTeamId: Number(team.id) });
}

export interface ProjectMovePreview {
    target_project_id: number;
    key_format: string;
    workflow_state: { id: number; key: string; name: string; category: string };
    leaves_sprint: boolean;
}

type MoveContext = PlacementContext & { ticketActor: TaskActor };

/** Preview and write share the same validation and deterministic mapping. */
async function prepareProjectMove(ctx: MoveContext, before: any, projectId: number, lock: boolean) {
    const id = Number(before.id);
    if (same(before.project_id, projectId)) return refusedTransfer(id, "PROJECT_UNCHANGED");
    const projects = await repo.findMoveProjects(ctx.db, [Number(before.project_id), projectId], ctx.actor.orgId, lock);
    const source = projects.find((project) => same(project.id, before.project_id));
    const target = projects.find((project) => same(project.id, projectId));
    if (!source || !target) return refusedTransfer(id, "PROJECT_NOT_FOUND");
    const access = createProjectAccess(ctx.db, {
        userId: ctx.actor.userId, orgId: ctx.actor.orgId, orgRole: ctx.ticketActor.role,
        teamIds: isOrgAdmin(ctx.ticketActor.role) ? [] : await repo.findMoveActorTeams(ctx.db, ctx.actor.userId, ctx.actor.orgId),
    });
    for (const project of [source, target]) {
        const role = isOrgAdmin(ctx.ticketActor.role) ? "project_admin"
            : await access.roleForProject(Number(project.id));
        if (role !== "member" && role !== "project_admin") return refusedTransfer(id, role ? "READ_ONLY_ROLE" : "ACCESS_DENIED");
        if (project.is_archived) return refusedTransfer(id, "PROJECT_ARCHIVED");
    }
    const { source: oldState, states } = await repo.findMoveStates(ctx.db, before.workflow_state_id, projectId, ctx.actor.orgId);
    const state = states.find((candidate) => oldState && candidate.key === oldState.key)
        ?? states.find((candidate) => oldState && candidate.category === oldState.category)
        ?? states.find((candidate) => candidate.is_initial);
    if (!state) return refusedTransfer(id, "WORKFLOW_NOT_FOUND");
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
    return { ok: true as const, target, preview, clearedSprint, sprints };
}

export async function previewProjectMove(ctx: MoveContext, ticketId: number, projectId: number) {
    if (!ctx.ticketActor.projectOwnership) return refusedTransfer(ticketId, "ACCESS_DENIED");
    const before = await repo.findMoveTicket(ctx.db, ticketId, ctx.actor.orgId);
    if (!before) return refusedTransfer(ticketId, "NOT_FOUND");
    const prepared = await prepareProjectMove(ctx, before, projectId, false);
    return prepared.ok ? { ok: true as const, preview: prepared.preview } : prepared;
}

/** Caller owns the transaction; project/key/state, placement and history commit together. */
export async function moveTicketProject(
    ctx: MoveContext, ticketId: number, projectId: number, options: { legacyTeamId?: number } = {},
): Promise<TransferPlacementResult> {
    if (!ctx.ticketActor.projectOwnership && options.legacyTeamId == null) return refusedTransfer(ticketId, "ACCESS_DENIED");
    await repo.acquirePlacementLifecycleLock(ctx.db, ctx.actor.orgId);
    const [before] = await repo.lockTickets(ctx.db, [ticketId], ctx.actor.orgId);
    if (!before) return refusedTransfer(ticketId, "NOT_FOUND");
    const prepared = await prepareProjectMove(ctx, before, projectId, true);
    if (!prepared.ok) return prepared;
    const { target, preview, clearedSprint, sprints } = prepared;
    const number = await repo.reserveProjectTicketNumber(ctx.db, projectId);
    const key = `${target.key}-${number}`;
    if (before.ticket_key && before.org_id != null) {
        await repo.insertTicketKeyAlias(ctx.db, Number(before.org_id), before.ticket_key, ticketId, before.project_id, "move");
    }
    // Project moves deliberately leave legacy team ownership untouched.
    const after = await repo.setProject(ctx.db, ticketId, projectId, number, key, preview.workflow_state.id,
        clearedSprint !== null, ctx.ticketActor.projectOwnership ? undefined : options.legacyTeamId);
    const history: HistoryRow[] = [
        { action: "transferred", field: "project", from: String(before.project_id), to: String(projectId) },
        { action: "transferred", field: "ticket_key", from: before.ticket_key, to: key },
        ...historyFor(before, after, sprints),
    ];
    if (!same(before.workflow_state_id, after.workflow_state_id)) history.push({ action: "updated", field: "workflow_state", from: before.workflow_state_id == null ? null : String(before.workflow_state_id), to: String(after.workflow_state_id) });
    if (!same(before.team_id, after.team_id)) history.push({ action: "transferred", field: "team", from: before.team_id == null ? null : String(before.team_id), to: String(after.team_id) });
    await record(ctx, options.legacyTeamId == null ? "move_project" : "transfer", before, after, history);
    return { id: ticketId, ok: true, task: after, oldTeamId: before.team_id ?? null, clearedSprint };
}

/**
 * A sprint's end date moved: members whose due date is still the old end take
 * the new one (ADR-015, amended 2026-11-01). A due date someone edited by hand
 * inside the sprint is theirs and stays. Returns how many tickets moved; a
 * sprint outside the actor's org moves nothing.
 */
export async function retimeSprintDueDates(
    ctx: PlacementContext,
    sprintId: number,
    oldEnd: string,
    newEnd: string,
): Promise<number> {
    if (oldEnd === newEnd) return 0;
    await repo.acquirePlacementLifecycleLock(ctx.db, ctx.actor.orgId);
    const members = await repo.lockSprintMembersDueOn(ctx.db, sprintId, oldEnd, ctx.actor.orgId);
    for (const before of members) {
        const after = await repo.setDueDate(ctx.db, Number(before.id), newEnd);
        await record(ctx, "place", before, after, historyFor(before, after, new Map()));
    }
    return members.length;
}

function joinsSprint(target: PlacementTarget): target is { sprint: number } {
    return typeof target === "object" && "sprint" in target && target.sprint != null;
}

function plansDay(target: PlacementTarget): target is { day: string } {
    return typeof target === "object" && "day" in target;
}

async function lockSprints(ctx: PlacementContext, ids: Array<number | null | undefined>): Promise<Map<number, any>> {
    const wanted = [...new Set(ids.filter((id): id is number => id != null).map(Number))];
    const rows = await repo.lockSprints(ctx.db, wanted, ctx.actor.orgId);
    return new Map(rows.map((row) => [Number(row.id), row]));
}

function alreadyThere(ticket: any, target: PlacementTarget): boolean {
    if (target === "backlog") return ticket.sprint_id == null && ticket.planned_date == null;
    if (plansDay(target)) return same(ticket.planned_date, target.day);
    return same(ticket.sprint_id, target.sprint);
}

async function write(db: PlacementDb, id: number, ticket: any, target: PlacementTarget, sprint: any, projectOwnership = false): Promise<any> {
    if (target === "backlog") return repo.returnToBacklog(db, id);
    if (plansDay(target)) return repo.setPlannedDay(db, id, target.day);
    if (sprint) return repo.joinSprint(db, id, sprint, projectOwnership ? ticket.team_id : teamAfterSprintMove(ticket.team_id, sprint.team_id));
    return repo.leaveSprint(db, id);
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
    const change: PlacementChange = { before, after, actor: ctx.actor,
        projectOwnership: ctx.projectOwnership ?? ctx.ticketActor?.projectOwnership ?? false };
    ctx.afterCommit(() => ctx.effects.changed(change));
}

function snapshot(task: any, action: string): Record<string, unknown> {
    const placement = { sprint_id: task.sprint_id ?? null, planned_date: task.planned_date ?? null, due_date: task.due_date ?? null };
    return action === "transfer" || action === "move_project"
        ? { team_id: task.team_id ?? null, project_id: task.project_id, ticket_key: task.ticket_key, workflow_state_id: task.workflow_state_id, ...placement } : placement;
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
    if (!same(before.planned_date, after.planned_date)) {
        rows.push(after.planned_date == null
            ? { action: "unscheduled", field: "planned_date", from: before.planned_date, to: "backlog" }
            : { action: "scheduled", field: "planned_date", from: before.planned_date ?? "backlog", to: after.planned_date });
    }
    return rows;
}

function same(a: unknown, b: unknown): boolean {
    return (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
}
