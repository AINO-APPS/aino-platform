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

test("planning cards and detail expose nested families and separate own/aggregate effort", () => {
    const task = api.components.schemas.Task.properties;
    assert.equal(task.is_subtask.type, "boolean");
    assert.deepEqual(task.parent_key.type, ["string", "null"]);
    assert.equal(task.subtasks.items.properties.parent_task_id.type[0], "integer");
    assert.deepEqual(task.subtask_summary.required, ["total", "done"]);
    assert.deepEqual(task.effort.required, [
        "own_time_spent_minutes", "total_time_spent_minutes",
        "own_remaining_estimate_minutes", "total_remaining_estimate_minutes",
    ]);
    assert.deepEqual(task.effort.properties.total_remaining_estimate_minutes.type, ["integer", "null"]);
    const detail = api.components.schemas.TaskDetail.allOf[1];
    assert.ok(detail.required.includes("effort"));
    assert.ok(detail.required.includes("subtask_summary"));
});
