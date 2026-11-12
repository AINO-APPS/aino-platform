/**
 * Joining or leaving a sprint changes sprint membership only. Ticket dates are
 * independent of sprint placement.
 */
export type PlacementTarget = { sprint: number } | { sprint: null } | "backlog";

export function placementRefusal(
    ticket: any,
    _target: PlacementTarget,
    targetSprint: any,
    sprints: Map<number, any>,
): "SPRINT_FROZEN" | "SPRINT_PROJECT_MISMATCH" | null {
    const origin = ticket.sprint_id == null ? null : sprints.get(Number(ticket.sprint_id));
    const staysInOrigin = origin != null && targetSprint != null && Number(targetSprint.id) === Number(origin.id);
    if ((origin?.status === "completed" && !staysInOrigin) || targetSprint?.status === "completed") return "SPRINT_FROZEN";
    if (targetSprint && (ticket.project_id == null || Number(ticket.project_id) !== Number(targetSprint.project_id))) {
        return "SPRINT_PROJECT_MISMATCH";
    }
    return null;
}
