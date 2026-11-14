export function applyClientVersionContract(paths, schemas) {
    const ref = name => ({ $ref: `#/components/schemas/${name}` });
    const object = (properties, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
    const version = { type: "string", description: "Semantic version, including optional prerelease/build metadata." };
    schemas.ClientClass = { type: "string", enum: ["android", "desktop", "web"] };
    schemas.ClientVersionConfig = object({
        mode: { type: "string", enum: ["off", "report", "enforce"] },
        minimums: object({ android: version, desktop: version, web: version }),
    });
    schemas.ClientVersionAdoption = object({
        client: ref("ClientClass"), version: { type: "string", description: "Bundled version, or 0 for missing/invalid versions." },
        users: { type: "integer", minimum: 0 },
    });
    schemas.ClientVersionReport = object({
        window_days: { type: "integer", const: 30 },
        versions: { type: "array", items: ref("ClientVersionAdoption") },
    });
    schemas.ClientUpgradeRequired = object({
        code: { type: "string", const: "CLIENT_UPGRADE_REQUIRED" }, client: ref("ClientClass"),
        min_version: version, current_version: { type: "string" },
    });
    schemas.ClientUpgradeRequired.description = "Returned when an enforced minimum client version is not met.";
    const content = schema => ({ "application/json": { schema: ref(schema) } });
    paths["/api/client-versions"] = { get: {
        operationId: "getClientVersions", tags: ["client-versions"], summary: "Public platform-wide version configuration",
        description: "Available before authentication, tenant resolution and maintenance checks. No-store. OFF by default; ENFORCE requires a configured minimum for each client class.",
        security: [], responses: { "200": { description: "Mode and valid semantic minimums", content: content("ClientVersionConfig") } },
    } };
    paths["/api/admin/client-versions"] = { get: {
        operationId: "getClientVersionAdoption", tags: ["client-versions"], summary: "Read client adoption",
        description: "Tenantless platform administrator on the platform realm only. Distinct tenant-safe users per class/version in the last 30 days by authenticated request last-seen. Logout does not remove history.",
        security: [{ cookieAuth: [] }], responses: {
            "200": { description: "Adoption window", content: content("ClientVersionReport") },
            "401": { description: "Authentication required" }, "403": { description: "Platform identity required" },
        },
    } };
    for (const [path, methods] of Object.entries(paths)) {
        if (!path.startsWith("/api/") || path === "/api/client-versions" || path === "/api/health") continue;
        for (const [method, operation] of Object.entries(methods)) {
            if (!["get", "post", "put", "patch", "delete", "head", "options"].includes(method)) continue;
            operation.parameters ??= [];
            operation.parameters.push(
                { $ref: "#/components/parameters/AinoClient" },
                { $ref: "#/components/parameters/AinoClientVersion" },
            );
            operation.responses ??= {};
            operation.responses["426"] = { $ref: "#/components/responses/ClientUpgradeRequired" };
        }
    }
}
export const clientVersionHeaderParameters = {
    AinoClient: {
        name: "X-AINO-Client", in: "header", required: false,
        schema: { $ref: "#/components/schemas/ClientClass" },
        description: "First-party client class; unknown clients are never gated.",
    },
    AinoClientVersion: {
        name: "X-AINO-Client-Version", in: "header", required: false,
        schema: { type: "string" },
        description: "Android version name or the bundled web build semantic version (also for desktop). Missing/invalid versions report as 0.",
    },
};
