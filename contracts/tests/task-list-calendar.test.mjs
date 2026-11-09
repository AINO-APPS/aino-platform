import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const api = JSON.parse(fs.readFileSync(new URL("../openapi.json", import.meta.url), "utf8"));
test("Task list public read documents filters, inclusive calendar ranges and the generated response", () => {
    const read = api.paths["/api/tasks"].get;
    const parameters = Object.fromEntries(read.parameters.map(parameter => [parameter.name, parameter]));
    assert.deepEqual(parameters.scope.schema.enum, ["personal", "list", "calendar"]);
    for (const name of ["key", "title", "work_item_type_id", "status", "assignee", "priority", "start_on", "due_on",
        "date", "start_date", "end_date", "undated", "sort", "direction", "offset"]) assert.ok(parameters[name], `Missing ${name}`);
    assert.deepEqual(parameters.sort.schema.enum, ["key", "title", "type", "status", "assignee", "priority", "start_date", "due_date"]);
    assert.match(parameters.start_date.description, /inclusive/i);
    assert.equal(read.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/TaskCollectionResponse");
    const schema = api.components.schemas.TaskCollectionResponse;
    assert.deepEqual(schema.required, ["tasks", "stats"]);
    assert.ok(schema.properties.pagination.properties.hasMore);
    assert.ok(api.components.schemas.Task.properties.assignee);
});
