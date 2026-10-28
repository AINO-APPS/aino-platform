/**
 * Moving a ticket into or out of a sprint on the edit path.
 *
 * The PATCH route had the sprint lookup, the same-team rule and the due-date
 * bookkeeping inline; `assign-sprint` and create have their own equivalents.
 * This keeps the rules in one place so the three paths cannot disagree about
 * who may join which sprint and what happens to the ticket's own dates.
 */
import { canMoveIntoTeamSprint, teamAfterSprintMove } from "./tasks.ownership";
import { nextSprintDates, type SprintDb } from "./tasks.sprintRepository";

export interface SprintAssignmentRequest {
    /** The id from the request body; `undefined` means "leave the sprint alone". */
    sprintId: unknown;
    orgId: number | null;
    actorTeamId: number | null;
    /** True for super admin and above, who may target any sprint in the org. */
    isAdmin: boolean;
}

export interface SprintAssignmentOutcome {
    sprintId: unknown;
    teamId?: number | null;
    dueDate?: string | null;
    preSprintDueDate?: string | null;
    /** Set when the request must be refused. */
    error?: { status: number; body: Record<string, unknown> };
}

/**
 * Resolve and apply a sprint change from an edit request in one step, so the
 * route only has to spread the result onto the ticket.
 */
export async function planSprintEdit(
    db: SprintDb,
    input: {
        request: SprintAssignmentRequest;
        current: {
            sprintId: unknown;
            teamId: number | null;
            dueDate: string | null;
            preSprintDueDate: string | null;
        };
        requestedDueDate?: string | null;
    },
) {
    if (input.request.sprintId === undefined) return applySprintAssignment(input);
    const target = await resolveSprintTarget(db, input.request);
    if (target.error) return { ...input.current, error: target.error };
    return applySprintAssignment({ ...input, sprint: target.sprint });
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
    const mayUse = sprint && (sprint.team_id === request.actorTeamId || request.isAdmin);
    if (!mayUse) {
        return { error: { status: 400, body: { error: "Invalid sprint or sprint does not belong to your team" } } };
    }
    return { sprint };
}

/**
 * Where the ticket ends up: the sprint, its team, and the dates that follow.
 *
 * `requestedDueDate` is `undefined` when the request does not set one, which
 * only matters when leaving a sprint (an explicit date wins over the restore).
 */
export function applySprintAssignment(input: {
    request: SprintAssignmentRequest;
    current: {
        sprintId: unknown;
        teamId: number | null;
        dueDate: string | null;
        preSprintDueDate: string | null;
    };
    requestedDueDate?: string | null;
    sprint?: { id: number; team_id: number | null; end_date: string } | null;
}): {
    sprintId: unknown;
    teamId: number | null;
    dueDate: string | null;
    preSprintDueDate: string | null;
    error?: { status: number; body: Record<string, unknown> };
} {
    const { request, current, sprint } = input;
    if (request.sprintId === undefined) {
        return {
            sprintId: current.sprintId,
            teamId: current.teamId,
            dueDate: current.dueDate,
            preSprintDueDate: current.preSprintDueDate,
        };
    }
    const leaving = request.sprintId === null || request.sprintId === "";
    if (!leaving && sprint && !canMoveIntoTeamSprint(current.teamId, sprint.team_id)) {
        return {
            sprintId: current.sprintId,
            teamId: current.teamId,
            dueDate: current.dueDate,
            preSprintDueDate: current.preSprintDueDate,
            error: { status: 409, body: { error: "A ticket can only join its own team's sprint", code: "SPRINT_TEAM_MISMATCH" } },
        };
    }
    const dates = nextSprintDates({
        currentSprintId: current.sprintId,
        currentDueDate: current.dueDate,
        currentPreSprintDueDate: current.preSprintDueDate,
        requestedDueDate: input.requestedDueDate,
        join: leaving ? null : (sprint ? { endDate: sprint.end_date } : null),
    });
    const teamId = leaving
        ? current.teamId
        : (current.teamId == null && sprint ? teamAfterSprintMove(current.teamId, sprint.team_id) : current.teamId);
    return {
        sprintId: leaving ? null : request.sprintId,
        teamId,
        dueDate: dates.dueDate,
        preSprintDueDate: dates.preSprintDueDate,
    };
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
