/**
 * Ticket ownership: which team a ticket belongs to, and the rules for changing
 * that team.
 *
 * Ownership is a property of the ticket (`tasks.team_id`), not of who created
 * it. It is set on create (explicit team for admins, else the sprint's team,
 * else the creator's team), adopted from a sprint on first assignment, and
 * changed only by an explicit admin transfer.
 *
 * Cross-team sprint assignment is rejected: an admin must transfer the ticket
 * first, so the move is deliberate and auditable.
 */

import { isOrgAdmin, type TaskActor } from "./tasks.policy";
import { findDefaultTicketProject } from "./tasks.repository";

export interface OwnershipDb {
    query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount: number }>;
}

export interface OwnershipError {
    status: number;
    body: Record<string, unknown>;
}

export interface ResolvedCreateTeam {
    teamId: number | null;
    error?: OwnershipError;
}

export async function requireTicketProjectId(
    db: OwnershipDb,
    projectId: number | null,
    orgId: number | null,
    sprintId: number | null,
    teamId: number | null,
): Promise<number> {
    const resolved = projectId ?? await findDefaultTicketProject(db, orgId, sprintId, teamId);
    if (!resolved) throw new Error("No default project exists for this organization");
    return resolved;
}

function parseId(value: unknown): number | null {
    if (value === undefined || value === null || value === "") return null;
    const parsed = Number.parseInt(String(value), 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Resolve the team a new ticket should belong to.
 *
 * `sprint` is the already-validated sprint row (or null). An explicit
 * `team_id` is honoured for org admins only; for everyone else it must match
 * their own team. A sprint assignment must not contradict the decided team.
 */
export async function resolveCreateTeamId(
    db: OwnershipDb,
    options: {
        actor: TaskActor;
        orgId: number | null;
        explicitTeamId?: unknown;
        sprint?: { id: number; team_id: number | null } | null;
    },
): Promise<ResolvedCreateTeam> {
    const { actor } = options;
    const explicit = parseId(options.explicitTeamId);

    let teamId: number | null = null;
    if (explicit !== null) {
        // Ownership is never chosen by non-admins. Their tickets inherit the
        // sprint's team or their own team; only an admin may name one.
        if (!isOrgAdmin(actor.role)) {
            return {
                teamId: null,
                error: { status: 403, body: { error: "Only an org admin can choose a team" } },
            };
        }
        const team = options.orgId
            ? (await db.query("SELECT id FROM teams WHERE id = $1 AND org_id = $2", [explicit, options.orgId])).rows[0]
            : (await db.query("SELECT id FROM teams WHERE id = $1", [explicit])).rows[0];
        if (!team) {
            return {
                teamId: null,
                error: { status: 400, body: { error: "Team not found in this organization" } },
            };
        }
        teamId = explicit;
    }

    if (options.sprint) {
        const sprintTeamId = options.sprint.team_id ?? null;
        if (teamId !== null && sprintTeamId !== null && Number(teamId) !== Number(sprintTeamId)) {
            return { teamId: null, error: { status: 409, body: sprintTeamMismatchBody() } };
        }
        if (teamId === null) teamId = sprintTeamId;
    }

    if (teamId === null) teamId = actor.teamId;
    return { teamId };
}

export function sprintTeamMismatchBody(): Record<string, unknown> {
    return {
        error: "This ticket belongs to another team. An org admin must transfer it before it can join this sprint.",
        code: "SPRINT_TEAM_MISMATCH",
    };
}

/**
 * A ticket may enter a sprint only when the sprint's team is the ticket's team.
 * A legacy ticket with no team adopts the sprint's team; a ticket with a team
 * cannot silently change owners by being dragged into another team's sprint.
 */
export function canMoveIntoTeamSprint(
    taskTeamId: unknown,
    sprintTeamId: unknown,
): boolean {
    if (taskTeamId === null || taskTeamId === undefined) return true;
    if (sprintTeamId === null || sprintTeamId === undefined) return false;
    return Number(taskTeamId) === Number(sprintTeamId);
}

/** The team a ticket should have after a sprint move. */
export function teamAfterSprintMove(taskTeamId: unknown, sprintTeamId: unknown): number | null {
    if (taskTeamId !== null && taskTeamId !== undefined) return Number(taskTeamId);
    if (sprintTeamId !== null && sprintTeamId !== undefined) return Number(sprintTeamId);
    return null;
}
