import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const api = JSON.parse(fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
const inventory = JSON.parse(fs.readFileSync(new URL("../http-route-inventory.json", import.meta.url), "utf8"));

test("public off/report config and tenantless platform adoption read are explicit contracts", () => {
    assert.deepEqual(api.paths["/api/client-versions"].get.security, []);
    assert.ok(api.paths["/api/admin/client-versions"].get.description.includes("platform"));
    assert.deepEqual(api.components.schemas.ClientVersionConfig.properties.mode.enum, ["off", "report"]);
    assert.deepEqual(api.components.schemas.ClientClass.enum, ["android", "desktop", "web"]);
    assert.deepEqual(api.components.schemas.ClientUpgradeRequired.required, ["code", "client", "min_version", "current_version"]);
    const parameters = api.paths["/api/tasks"].get.parameters.map(p => p.$ref ? api.components.parameters[p.$ref.split("/").pop()] : p);
    assert.ok(parameters.some(p => p.name === "X-AINO-Client"));
    assert.ok(parameters.some(p => p.name === "X-AINO-Client-Version"));
    for (const path of ["/api/client-versions", "/api/admin/client-versions"]) {
        assert.ok(inventory.endpoints.some(e => e.path === path && e.method === "GET" && e.coverage === "operation"));
    }
});
