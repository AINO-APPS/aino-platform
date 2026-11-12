import type { Request, Response, NextFunction } from "express";
import { assertScrumSprintRequest } from "../../modules/tasks/tasks.projectSprintPolicy";
import { ProjectTypeError } from "../../modules/tasks/tasks.projectTypeLifecycle";

export async function requireScrumSprint(req: Request, res: Response, next: NextFunction) {
    try {
        const sprintId = req.path.match(/^\/(\d+)(?:\/|$)/)?.[1];
        await assertScrumSprintRequest(req.db!, req.userOrgId ?? null, {
            sprintId,
            projectId: req.body?.project_id ?? req.query.project_id,
        });
        next();
    } catch (err) {
        if (err instanceof ProjectTypeError) return res.status(err.status).json({ error: err.message, code: err.code });
        next(err);
    }
}
