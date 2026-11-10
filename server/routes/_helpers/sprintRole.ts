import type { Request, Response, NextFunction } from "express";
const { requireRole } = require("../../middleware/rbac");
const legacyLead = requireRole("team_lead");

/** Project membership is checked on the selected sprint, not the org role. */
export function sprintManagementRole(req: Request, res: Response, next: NextFunction) {
    return req.projectOwnership ? next() : legacyLead(req, res, next);
}
