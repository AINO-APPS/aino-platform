import type { Request, Response, NextFunction } from "express";
import { isMobileClient } from "../../middleware/webOnly";
import type { Client, VersionConfig } from "./clientVersions.types";
import { validVersion } from "./clientVersions.config";

export function createClientVersionGate(config: () => VersionConfig) {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (config().mode === "off" || ["/health", "/healthz", "/readyz", "/api/health"].includes(req.path.replace(/\/$/, ""))
            || (req.method === "GET" && req.path === "/api/client-versions")) return next();
        const header = req.headers["x-aino-client"];
        let client: Client | undefined;
        if (header !== undefined) {
            const value = String(header).toLowerCase();
            if (value === "android" || value === "desktop" || value === "web") client = value;
        } else if (isMobileClient(req)) client = "android";
        else if (req.headers.origin === "workpulse://app") client = "desktop";
        if (client) {
            const version = req.headers["x-aino-client-version"];
            (req as any).clientVersionObservation = { client, version: validVersion(version) ? version : "0" };
        }
        next();
    };
}
