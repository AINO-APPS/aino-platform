import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateJsonSchema } from "../../scripts/lib/json-schema-lite.mjs";

const read = file => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const api = read("openapi.json");
test("migration review and one-time switches have explicit operations, state and review payloads", () => {
  for (const [path, method, schema] of [
    ["review", "get", "ProjectMigrationReview"],
    ["switch", "post", "ProjectOwnershipState"],
    ["switch-back", "post", "ProjectOwnershipState"],
  ]) {
    const operation = api.paths[`/api/projects/migration/${path}`][method];
    assert.equal(operation.responses["200"].content["application/json"].schema.$ref, `#/components/schemas/${schema}`);
    for (const status of ["403", "404"]) assert.ok(operation.responses[status]);
    if (method === "post") assert.ok(operation.responses["409"]);
    assert.ok(read("http-route-inventory.json").endpoints.some(endpoint =>
      endpoint.method === method.toUpperCase() && endpoint.path === `/api/projects/migration/${path}`));
  }
  assert.deepEqual(validateJsonSchema(api.components.schemas.ProjectMigrationReview, {
    project_ownership: false, switched_at: null, projects: [], moves: [], hierarchy_repairs: [],
  }), []);
  for (const field of ["key_published", "ticket_count", "grants"]) {
    assert.ok(api.components.schemas.ProjectMigrationProject.required.includes(field));
  }
  for (const field of ["old_key", "new_key", "sprint_id"]) {
    assert.ok(api.components.schemas.ProjectMigrationMove.required.includes(field));
  }
});

test("hierarchy review preserves typed original and follow-up records in the authorized review response", () => {
  const schema = api.components.schemas.ProjectMigrationReview;
  assert.ok(schema.required.includes("hierarchy_repairs"));
  const repair = api.components.schemas.HierarchyRepair;
  assert.ok(repair);
  assert.deepEqual(validateJsonSchema(repair, {
    task_id: 7, ticket_key: "ONE-7", stage: "correction", reason: "Recovered eligible leaf",
    repaired_at: "2026-11-11T00:00:00Z",
    before: { parent_task_id: null, work_item_type_id: 3, project_id: 10, sprint_id: null, story_points: null },
    after: { parent_task_id: 2, work_item_type_id: 9, project_id: 10, sprint_id: 11, story_points: null },
  }, api), []);
  for (const name of ["Task", "SearchTask"]) {
    assert.deepEqual(api.components.schemas[name].properties.container.enum, ["sprint", "backlog", "board"]);
  }
});
