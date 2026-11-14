import { assertScrumSprintRequest } from "./tasks.projectSprintPolicy";
import { ProjectTypeError } from "./tasks.projectTypeLifecycle";
/**
 * Request-side checks before a placement: which project sprint the caller may
 * target. What a move does to the ticket is decided by tasks.placement.ts.
 */
import type { SprintDb } from "./tasks.sprintRepository";
import type { TaskActor } from "./tasks.policy";
import { loadTicketDecisionContext, type DecisionTicket } from "./tasks.capabilities";
import { ticketActionConflict } from "./tasks.writeGuards";

export interface SprintAssignmentRequest {
    /** The id from the request body; null or "" means "leave the sprint". */
    sprintId: unknown;
    orgId: number | null;
    ticket?: DecisionTicket;
    actor?: TaskActor;
}
/** Find a sprint the caller may move a ticket into, or an error. */
export async function resolveSprintTarget(
    db: SprintDb,
    request: SprintAssignmentRequest,
): Promise<{ sprint?: { id: number; project_id: number; end_date: string; is_archived: boolean }; error?: { status: number; body: Record<string, unknown> } }> {
    if (request.sprintId === null || request.sprintId === "") return { sprint: undefined };
    try { await assertScrumSprintRequest(db, request.orgId, { sprintId: request.sprintId }); }
    catch (err) {
        if (err instanceof ProjectTypeError) return { error: { status: err.status, body: { error: err.message, code: err.code } } };
        throw err;
    }
    const sprint = (await db.query(
        "SELECT s.id, s.project_id, s.end_date, p.is_archived FROM sprints s JOIN projects p ON p.id = s.project_id WHERE s.id = $1 AND p.org_id = $2",
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
    if (request.actor && sprint) {
        const role = await request.actor.projectAccess?.roleForProject(Number(sprint.project_id));
        if (sprint.is_archived) return { error: { status: 409, body: { error: "This project is archived and its tickets are read-only.", code: "PROJECT_ARCHIVED" } } };
        if (role === "member" || role === "project_admin") return { sprint };
        return { error: { status: 403, body: { error: "Your project role allows reading and commenting only.", code: "READ_ONLY_ROLE" } } };
    }
    return { error: { status: 400, body: { error: "Invalid sprint" } } };
}
