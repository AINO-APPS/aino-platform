import type { Express, Response, NextFunction } from "express";
import { logger } from "../../utils/logger";
import { captureError } from "../../bootstrap/errorTracking";

function installErrorHandler(app: Express): void {
    app.use((err: unknown, req: any, res: Response, _next: NextFunction) => {
        (req.log || logger).error({ err }, "Unhandled error");
        captureError(err, { userId: req.userId, tenantId: req.tenantId, route: req.route?.path || req.baseUrl });
        res.status(500).json({ error: "Internal server error" });
    });
}

export { installErrorHandler };