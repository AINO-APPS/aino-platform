import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const api = JSON.parse(fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
const inventory = JSON.parse(fs.readFileSync(new URL("../http-route-inventory.json", import.meta.url), "utf8"));

test("public off/report/enforce config and tenantless platform adoption read are explicit contracts", () => {
    assert.deepEqual(api.paths["/api/client-versions"].get.security, []);
    assert.ok(api.paths["/api/admin/client-versions"].get.description.includes("platform"));
    assert.deepEqual(api.components.schemas.ClientVersionConfig.properties.mode.enum, ["off", "report", "enforce"]);
    assert.deepEqual(api.components.schemas.ClientClass.enum, ["android", "desktop", "web"]);
    assert.deepEqual(api.components.schemas.ClientUpgradeRequired.required, ["code", "client", "min_version", "current_version"]);
    const parameters = api.paths["/api/tasks"].get.parameters.map(p => p.$ref ? api.components.parameters[p.$ref.split("/").pop()] : p);
    assert.ok(parameters.some(p => p.name === "X-AINO-Client"));
    assert.ok(parameters.some(p => p.name === "X-AINO-Client-Version"));
    for (const path of ["/api/client-versions", "/api/admin/client-versions"]) {
        assert.ok(inventory.endpoints.some(e => e.path === path && e.method === "GET" && e.coverage === "operation"));
    }
});

test("every gated operation documents the upgrade response while recovery reads remain exempt", () => {
    const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
    for (const [path, item] of Object.entries(api.paths)) {
        for (const [method, operation] of Object.entries(item)) {
            if (!methods.has(method)) continue;
            const exempt = ["/health", "/healthz", "/readyz", "/api/health"].includes(path)
                || (path === "/api/client-versions" && ["get", "head"].includes(method));
            if (exempt) {
                assert.equal(operation.responses["426"], undefined, `${method} ${path} must remain exempt`);
            } else {
                assert.equal(operation.responses["426"]?.$ref, "#/components/responses/ClientUpgradeRequired", `${method} ${path}`);
            }
        }
    }
    assert.equal(api.components.responses.ClientUpgradeRequired.content["application/json"].schema.$ref,
        "#/components/schemas/ClientUpgradeRequired");
});
