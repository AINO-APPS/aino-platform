import type { RequestHandler } from "express";
import { readClientVersionConfig } from "../clientVersions/clientVersions.config";
import { compareVersions } from "../clientVersions/clientVersions.version";
import { hasRetiredProjectTypesInput, isRetiredProjectTypesPath, supportedProjectTypesPayload } from "./projectTypesRemoval.http";

export async function assertProjectTypesRemovalReady(
    env: NodeJS.ProcessEnv,
    verifyOwnership: () => Promise<void>,
): Promise<void> {
    if (env.PROJECT_TYPES_REMOVAL !== "api") {
        throw new Error("PROJECT_TYPES_REMOVAL must be api before project-types contraction");
    }
    const config = readClientVersionConfig(env);
    if (config.mode !== "enforce") throw new Error("Client version gate must enforce released minimums");
    for (const [client, minimum] of Object.entries({ android: "0.27.18", desktop: "3.0.80", web: "3.0.80" })) {
        if (compareVersions(config.minimums[client as keyof typeof config.minimums], minimum) < 0) {
            throw new Error("Client version gate must enforce released minimums");
        }
    }
    await verifyOwnership();
}

export function createProjectTypesRemoval(options: {
    env?: () => NodeJS.ProcessEnv;
    verifyOwnership: () => Promise<void>;
}): RequestHandler {
    return async (req, res, next) => {
        const path = req.originalUrl.split("?")[0];
        if (!path.startsWith("/api/") || /^\/api\/(?:health|client-versions)\/?$/.test(path)) return next();
        const env = (options.env ?? (() => process.env))();
        if (!env.PROJECT_TYPES_REMOVAL || env.PROJECT_TYPES_REMOVAL === "off") return next();
        try {
            await assertProjectTypesRemovalReady(env, options.verifyOwnership);
            req.projectTypesApiRemoval = true;
            if (isRetiredProjectTypesPath(path)) return res.status(404).set("Cache-Control", "no-store").json({ error: "Not found" });
            if (hasRetiredProjectTypesInput(path, req.query, req.body)) {
                return res.status(400).json({ code: "LEGACY_PROJECT_TYPES_INPUT_REMOVED" });
            }
            const json = res.json.bind(res);
            res.json = body => json(supportedProjectTypesPayload(body));
            return next();
        } catch {
            return res.status(503).set("Cache-Control", "no-store").json({ code: "PROJECT_TYPES_REMOVAL_NOT_READY" });
        }
    };
}
