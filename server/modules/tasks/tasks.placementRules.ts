import { canMoveIntoTeamSprint } from "./tasks.ownership";

/**
 * Joining a sprint or planning a day enters that container. Leaving a sprint
 * keeps the planned day; returning to backlog clears both sprint and day.
 */
export type PlacementTarget =
    | { sprint: number }
    | { sprint: null }
    | { day: string }
    | "backlog";

export function placementRefusal(
    ticket: any,
    target: PlacementTarget,
    targetSprint: any,
    sprints: Map<number, any>,
): "SPRINT_FROZEN" | "SPRINT_TEAM_MISMATCH" | "IN_SPRINT" | null {
    const origin = ticket.sprint_id == null ? null : sprints.get(Number(ticket.sprint_id));
    const staysInOrigin = origin != null && targetSprint != null && Number(targetSprint.id) === Number(origin.id);
    if ((origin?.status === "completed" && !staysInOrigin) || targetSprint?.status === "completed") return "SPRINT_FROZEN";
    if (targetSprint && !canMoveIntoTeamSprint(ticket.team_id, targetSprint.team_id)) return "SPRINT_TEAM_MISMATCH";
    if (typeof target === "object" && "day" in target && ticket.sprint_id != null) return "IN_SPRINT";
    return null;
}
