// HTTP adapter for ticket placement (modules/tasks/tasks.placement.ts).
//
// Builds the placement context from the request and maps a refusal code to
// its HTTP status, so every route that moves a ticket answers the same way.

import type { Request, Response } from "express";
import type { TransactionContext } from "../../../types/domain";
import type {
    PlacementContext,
    PlacementRefusalCode,
    PlacementResult,
} from "../../../modules/tasks/tasks.placement";
const { realtimeEffects } = require("../../../modules/tasks/tasks.placementEffects");
const { taskActorFromRequest } = require("../../../modules/tasks/tasks.policy");

const STATUS: Record<PlacementRefusalCode, number> = {
    ACCESS_DENIED: 403,
    READ_ONLY_ROLE: 403,
    PROJECT_ARCHIVED: 409,
    SPRINT_PROJECT_MISMATCH: 409,
    NOT_FOUND: 404,
    SPRINT_NOT_FOUND: 400,
    SPRINT_FROZEN: 409,
    SPRINT_TEAM_MISMATCH: 409,
    IN_SPRINT: 409,
    TEAM_NOT_FOUND: 400,
    TEAM_UNCHANGED: 400,
};

/**
 * The placement context for a request, on the given transaction client.
 * Pass `{ notify: false }` when the move is part of creating the ticket.
 * `orgId` is required on routes that do not run `loadUserContext` (which is
 * what sets `req.userOrgId`); placement scopes every row to that org.
 */
export function placementContext(
    req: Request,
    client: PlacementContext["db"],
    afterCommit: TransactionContext["afterCommit"],
    options: { notify?: boolean; orgId?: number | null } = {},
): PlacementContext {
    const xff = req.headers?.["x-forwarded-for"];
    return {
        db: client,
        afterCommit,
        actor: {
            userId: req.userId!,
            orgId: options.orgId !== undefined ? options.orgId : (req.userOrgId ?? null),
            ip: req.ip || (Array.isArray(xff) ? xff[0] : xff) || null,
            userAgent: req.headers?.["user-agent"] || null,
        },
        effects: realtimeEffects({ db: req.db, tenantId: req.tenantId, notify: options.notify ?? true }),
        ticketActor: { ...taskActorFromRequest(req), orgId: options.orgId !== undefined ? options.orgId : (req.userOrgId ?? null) },
    };
}

/** Thrown inside a transaction to roll it back and answer with the refusal. */
export class PlacementRefused extends Error {
    constructor(readonly result: Extract<PlacementResult, { ok: false }>) {
        super(result.error);
    }
}

/** The one result of a single-ticket placement, or throw to roll back. */
export function placedOrThrow(results: PlacementResult[]): Extract<PlacementResult, { ok: true }> {
    const [result] = results;
    if (!result.ok) throw new PlacementRefused(result);
    return result;
}

/** Send the refusal if `err` is one; returns false for any other error. */
export function sendPlacementRefusal(res: Response, err: unknown): boolean {
    if (!(err instanceof PlacementRefused)) return false;
    const { code, error } = err.result;
    res.status(STATUS[code]).json({ error, code });
    return true;
}
