import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const api = JSON.parse(fs.readFileSync(path.join(root, "contracts/openapi.json"), "utf8"));
const operation = api.paths["/api/search"].get;

test("global search uses a field-level seven-group response", () => {
  assert.ok(!JSON.stringify(operation).includes("FreeFormValue"));
  assert.equal(operation.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/GlobalSearchResponse");
  assert.deepEqual(api.components.schemas.GlobalSearchResponse.required, ["tasks", "notes", "users", "events", "leaves", "sprints", "logs"]);
});

test("global search documents query normalization and group limits", () => {
  const query = operation.parameters.find(parameter => parameter.name === "q");
  assert.equal(query.required, false);
  assert.match(query.description, /truncated to 100 characters/);
  const response = api.components.schemas.GlobalSearchResponse.properties;
  assert.deepEqual(Object.fromEntries(Object.entries(response).map(([name, schema]) => [name, schema.maxItems])), {
    tasks: 20,
    notes: 15,
    users: 10,
    events: 7,
    leaves: 7,
    sprints: 7,
    logs: 10,
  });
});

test("ticket search exposes current and former keys", () => {
  const task = api.components.schemas.SearchTask;
  assert.deepEqual(task.required.slice(0, 4), ["id", "ticket_key", "issue_key", "key_aliases"]);
  assert.equal(task.properties.key_aliases.items.type, "string");
});

test("fetch-by-key documents alias resolution and invisible-ticket 404s", () => {
  const operation = api.paths["/api/tasks/by-key/{key}"].get;
  assert.equal(operation.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/TaskByKey");
  assert.match(operation.responses["404"].description, /not visible/);
  assert.deepEqual(api.components.schemas.TaskByKey.required, [
    "id", "ticket_key", "issue_key", "key_aliases", "key_alias", "requested_key",
  ]);
});