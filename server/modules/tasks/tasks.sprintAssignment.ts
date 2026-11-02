/**
 * Request-side checks before a placement: which sprint the caller may target,
 * and the due-date / planned-day pair rule on an edit. What a move does to the
 * ticket is decided by tasks.placement.ts.
 */
import type { SprintDb } from "./tasks.sprintRepository";
import type { TaskActor } from "./tasks.policy";
import { loadTicketDecisionContext, type DecisionTicket } from "./tasks.capabilities";
import { ticketActionConflict } from "./tasks.writeGuards";

export interface SprintAssignmentRequest {
    /** The id from the request body; null or "" means "leave the sprint". */
    sprintId: unknown;
    orgId: number | null;
    actorTeamId: number | null;
    /** True for super admin and above, who may target any sprint in the org. */
    isAdmin: boolean;
    ticket?: DecisionTicket;
    actor?: TaskActor;
}

/** Find a sprint the caller may move a ticket into, or an error. */
export async function resolveSprintTarget(
    db: SprintDb,
    request: SprintAssignmentRequest,
): Promise<{ sprint?: { id: number; team_id: number | null; end_date: string }; error?: { status: number; body: Record<string, unknown> } }> {
    if (request.sprintId === null || request.sprintId === "") return { sprint: undefined };
    const sprint = (await db.query(
        "SELECT s.id, s.team_id, s.end_date FROM sprints s JOIN teams t ON t.id = s.team_id WHERE s.id = $1 AND t.org_id = $2",
        [request.sprintId, request.orgId],
    )).rows[0];
    if (request.ticket && request.actor) {
        const context = await loadTicketDecisionContext(db, request.actor, [request.ticket],
            { targetSprintId: Number(request.sprintId) });
        const conflict = await ticketActionConflict(db, request.actor, request.ticket, "placeInSprint", context);
        if (conflict) {
            return { error: { ...conflict, status: conflict.body.code === "ACCESS_DENIED" ? 400 : conflict.status } };
        }
        return { sprint };
    }
    const mayUse = sprint && (sprint.team_id === request.actorTeamId || request.isAdmin);
    if (!mayUse) {
        return { error: { status: 400, body: { error: "Invalid sprint or sprint does not belong to your team" } } };
    }
    return { sprint };
}

import type { PlacementTarget } from "./tasks.placement";

/** The placement an edit asks for; the same targets `placeTickets` takes. */
export type EditTarget = PlacementTarget;

/**
 * Where an edit moves the ticket, and the planned day it will have afterwards.
 *
 * A change of sprint wins (and only when agile is on). Otherwise a planned day
 * on an unsprinted ticket plans it (a valid day) or returns it to the backlog
 * (null/invalid); on a sprinted ticket it is ignored, because the sprint
 * outranks the day (ADR-015). `joinsSprint` is true only when the ticket enters
 * a different sprint, whose end becomes the due date — so a due date sent
 * alongside is not applied. Staying in the same sprint keeps a typed due date.
 */
export function editPlacement(input: {
    requestedSprint?: { id: number } | null;
    requestedPlannedDate?: string | null;
    currentSprintId: unknown;
    currentPlannedDate: string | null;
}): { target: EditTarget | null; plannedAfter: string | null; joinsSprint: boolean } {
    // Clients resend the sprint the ticket already has (or null for none) on
    // every full save; only a different sprint is a sprint change.
    const sprint = input.requestedSprint ? input.requestedSprint.id : null;
    const sprintChanges = input.requestedSprint !== undefined
        && String(sprint ?? "") !== String(input.currentSprintId ?? "");
    if (sprintChanges) {
        return { target: { sprint }, plannedAfter: input.currentPlannedDate, joinsSprint: sprint != null };
    }
    if (input.requestedPlannedDate !== undefined && input.currentSprintId == null) {
        const day = dayOf(input.requestedPlannedDate);
        return { target: day ? { day } : "backlog", plannedAfter: day, joinsSprint: false };
    }
    return { target: null, plannedAfter: input.currentPlannedDate, joinsSprint: false };
}

export interface DateEdit {
    /** Resolved due date after the request (null clears it). */
    dueDate: string | null;
    /** Resolved planned date after the request (null clears it). */
    plannedDate: string | null;
    error?: { status: number; body: Record<string, unknown> };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (value: string | null | undefined) => (value && ISO_DAY.test(value) ? value : null);

/**
 * Resolve the two scheduling dates on an edit, refusing an impossible pair.
 *
 * A planned day is when the work happens and a due date is the deadline, so a
 * deadline before the planned day is rejected (Bug #15). `undefined` means the
 * request left that field alone.
 */
export function resolveEditDates(input: {
    currentDueDate: string | null;
    currentPlannedDate: string | null;
    requestedDueDate?: string | null;
    requestedPlannedDate?: string | null;
}): DateEdit {
    const plannedDate = input.requestedPlannedDate === undefined
        ? input.currentPlannedDate
        : dayOf(input.requestedPlannedDate);
    let dueDate = input.requestedDueDate === undefined
        ? input.currentDueDate
        : dayOf(input.requestedDueDate);
    // A due date may never precede the planned day, whichever side changed.
    if (dueDate && plannedDate && dueDate < plannedDate) {
        return {
            dueDate,
            plannedDate,
            error: { status: 400, body: { error: "Due date cannot be earlier than the planned date" } },
        };
    }
    return { dueDate, plannedDate };
}
