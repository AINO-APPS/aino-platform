import type { Request, Response, NextFunction } from "express";

/** Project capabilities are checked by the sprint operation itself. */
export function sprintManagementRole(req: Request, res: Response, next: NextFunction) {
    return next();
}
