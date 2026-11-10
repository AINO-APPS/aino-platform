import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = JSON.parse(fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
const inventory = JSON.parse(fs.readFileSync(new URL("../http-route-inventory.json", import.meta.url), "utf8"));

test("project move preview and commit are authenticated, inventoried, typed routes", () => {
    for (const suffix of ["/preview", ""]) {
        const operation = api.paths[`/api/tasks/{id}/move-project${suffix}`].post;
        assert.deepEqual(operation.requestBody.content["application/json"].schema, { $ref: "#/components/schemas/ProjectMoveRequest" });
        assert.equal(operation.responses[200].content["application/json"].schema.$ref,
            `#/components/schemas/${suffix ? "ProjectMovePreview" : "ProjectMoveResponse"}`);
        assert.deepEqual(operation.security, [{ cookieAuth: [] }, { bearerAuth: [] }]);
        for (const status of [400, 401, 403, 404, 409]) assert.ok(operation.responses[status]);
        assert.ok(inventory.endpoints.some((endpoint) => endpoint.method === "POST" && endpoint.path === `/api/tasks/:id/move-project${suffix}`));
    }
    assert.ok(api.components.schemas.TicketCapabilities.properties.can.required.includes("canMoveProject"));
    assert.deepEqual(api.components.schemas.ProjectMovePreview.required, ["target_project_id", "key_format", "workflow_state", "leaves_sprint"]);
});
