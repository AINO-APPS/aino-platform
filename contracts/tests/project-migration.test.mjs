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
    project_ownership: false, switched_at: null, projects: [], moves: [],
  }), []);
  for (const field of ["key_published", "ticket_count", "grants"]) {
    assert.ok(api.components.schemas.ProjectMigrationProject.required.includes(field));
  }
  for (const field of ["old_key", "new_key", "sprint_id"]) {
    assert.ok(api.components.schemas.ProjectMigrationMove.required.includes(field));
  }
});
