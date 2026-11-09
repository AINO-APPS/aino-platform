import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const api = JSON.parse(fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
test("hierarchy has an inherited-create operation and typed detail summaries/capability refusals", () => {
    const operation = api.paths["/api/tasks/{id}/subtasks"]?.post;
    assert.ok(operation);
    assert.equal(operation.requestBody.content["application/json"].schema.$ref, "#/components/schemas/CreateSubtaskRequest");
    assert.ok(operation.responses["409"]);
    assert.equal(api.paths["/api/tasks/{id}/detail"].get.responses["200"].content["application/json"].schema.$ref,
        "#/components/schemas/TaskDetail");
    assert.ok(api.components.schemas.TicketCapability.properties.reason.enum.includes("INVALID_HIERARCHY"));
    assert.ok(api.components.schemas.TicketCapability.properties.reason.enum.includes("SUBTASK_FOLLOWS_PARENT"));
    assert.ok(api.components.schemas.TicketCapabilities.properties.can.required.includes("canAddSubtask"));
});
