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
import type { TaskActor } from "./tasks.policy";
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
}

export type PlacementRefusalCode =
    | "ACCESS_DENIED"
    | "NOT_FOUND"
    | "SPRINT_NOT_FOUND"
    | "SPRINT_FROZEN"
    | "SPRINT_TEAM_MISMATCH"
    | "IN_SPRINT"
    | "TEAM_NOT_FOUND"
    | "TEAM_UNCHANGED";

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
            : placementRefusal(before, target, targetSprint, sprints);
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
        const after = await write(ctx.db, id, before, target, targetSprint);
        await record(ctx, "place", before, after, historyFor(before, after, sprints));
        results.push({ id, ok: true, task: after });
    }
    return results;
}

/**
 * Move a ticket to another team (the transfer capability is admin-only).
 * Leaving the team means leaving its sprint, which is an ordinary sprint exit:
 * the own due date comes back and a planned day it already had puts it in
 * Scheduled.
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
    if (same(before.team_id, team.id)) return refusedTransfer(id, "TEAM_UNCHANGED");
    const project = await repo.ensureTeamProject(ctx.db, team.id, ctx.actor.orgId);
    if (!project) return refusedTransfer(id, "TEAM_NOT_FOUND");

    const sprints = await lockSprints(ctx, [before.sprint_id]);
    const origin = before.sprint_id == null ? null : sprints.get(Number(before.sprint_id));
    context.sprints = sprints;
    const lockedVerdict = decideTicket(ctx.ticketActor, before, context).capabilities.can.transfer;
    if (!lockedVerdict.allowed) return refusedTransfer(id, lockedVerdict.reason as PlacementRefusalCode);

    const clearedSprint = origin != null && !same(origin.team_id, team.id)
        ? { id: Number(origin.id), name: origin.name }
        : null;
    const taskNumber = await repo.reserveProjectTicketNumber(ctx.db, Number(project.id));
    const ticketKey = `${project.key}-${taskNumber}`;
    if (before.ticket_key && before.ticket_key !== ticketKey && before.org_id != null) {
        await repo.insertTicketKeyAlias(
            ctx.db,
            Number(before.org_id),
            String(before.ticket_key),
            id,
            before.project_id == null ? null : Number(before.project_id),
            "move",
        );
    }
    const after = await repo.setTeamAndProject(
        ctx.db, id, team.id, Number(project.id), taskNumber, ticketKey, clearedSprint !== null,
    );
    await record(ctx, "transfer", before, after, [
        { action: "transferred", field: "team", from: before.team_id == null ? null : String(before.team_id), to: String(team.id) },
        { action: "transferred", field: "project", from: before.project_id == null ? null : String(before.project_id), to: String(project.id) },
        { action: "transferred", field: "ticket_key", from: before.ticket_key ?? null, to: ticketKey },
        ...historyFor(before, after, sprints),
    ]);
    return {
        id,
        ok: true,
        task: after,
        oldTeamId: before.team_id ?? null,
        clearedSprint,
    };
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

async function write(db: PlacementDb, id: number, ticket: any, target: PlacementTarget, sprint: any): Promise<any> {
    if (target === "backlog") return repo.returnToBacklog(db, id);
    if (plansDay(target)) return repo.setPlannedDay(db, id, target.day);
    if (sprint) return repo.joinSprint(db, id, sprint, teamAfterSprintMove(ticket.team_id, sprint.team_id));
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
    const change: PlacementChange = { before, after, actor: ctx.actor };
    ctx.afterCommit(() => ctx.effects.changed(change));
}

function snapshot(task: any, action: string): Record<string, unknown> {
    const placement = { sprint_id: task.sprint_id ?? null, planned_date: task.planned_date ?? null, due_date: task.due_date ?? null };
    return action === "transfer" ? { team_id: task.team_id ?? null, ...placement } : placement;
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
