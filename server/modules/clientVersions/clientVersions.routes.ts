import { Router, type RequestHandler } from "express";
import type { VersionConfig } from "./clientVersions.types";

interface Reads {
    config(): VersionConfig;
    report(): Promise<unknown[]>;
}
export function createClientVersionRoutes(service: Reads, adminGuards: RequestHandler[]) {
    const publicRoutes = Router();
    publicRoutes.get("/", (_req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json(service.config());
    });
    const adminRoutes = Router();
    adminRoutes.use(...adminGuards);
    adminRoutes.get("/", async (_req, res, next) => {
        try {
            res.setHeader("Cache-Control", "no-store");
            res.json({ window_days: 30, versions: await service.report() });
        } catch (error) { next(error); }
    });
    return { public: publicRoutes, admin: adminRoutes };
}
