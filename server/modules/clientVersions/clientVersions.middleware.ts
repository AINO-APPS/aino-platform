import type { Request, Response, NextFunction } from "express";
import { isMobileClient } from "../../middleware/webOnly";
import type { Client, VersionConfig } from "./clientVersions.types";
import { validVersion } from "./clientVersions.config";
import { compareVersions } from "./clientVersions.version";

export function createClientVersionGate(config: () => VersionConfig) {
    return (req: Request, res: Response, next: NextFunction) => {
        const settings = config();
        const path = req.path.replace(/\/$/, "");
        if (settings.mode === "off" || ["/health", "/healthz", "/readyz", "/api/health"].includes(path)
            || (["GET", "HEAD"].includes(req.method) && path === "/api/client-versions")) return next();
        const header = req.headers["x-aino-client"];
        let client: Client | undefined;
        if (header !== undefined) {
            const value = String(header).toLowerCase();
            if (value === "android" || value === "desktop" || value === "web") client = value;
        } else if (isMobileClient(req)) client = "android";
        else if (req.headers.origin === "workpulse://app") client = "desktop";
        if (client) {
            const version = req.headers["x-aino-client-version"];
            const currentVersion = validVersion(version) ? version : "0";
            if (settings.mode === "enforce" && compareVersions(currentVersion, settings.minimums[client]) < 0) {
                res.setHeader("Cache-Control", "no-store");
                return res.status(426).json({
                    code: "CLIENT_UPGRADE_REQUIRED", client,
                    min_version: settings.minimums[client], current_version: currentVersion,
                });
            }
            (req as any).clientVersionObservation = { client, version: currentVersion };
        }
        next();
    };
}
