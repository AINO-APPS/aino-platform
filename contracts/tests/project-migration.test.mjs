import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = file => JSON.parse(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
const api = read("openapi.json");
test("ticket 11 removes project migration operations and their retired response schemas", () => {
  for (const [method, path] of [
    ["GET", "/api/projects/migration/review"],
    ["POST", "/api/projects/migration/switch"],
    ["POST", "/api/projects/migration/switch-back"],
  ]) {
    assert.equal(api.paths[path]?.[method.toLowerCase()], undefined);
  }
  const inventory = read("http-route-inventory.json");
  for (const [method, path] of [
    ["GET", "/api/projects/migration/review"],
    ["POST", "/api/projects/migration/switch"],
    ["POST", "/api/projects/migration/switch-back"],
  ]) {
    assert.ok(inventory.endpoints.some(endpoint =>
      endpoint.method === method && endpoint.path === path && endpoint.deprecated && endpoint.retiredBy === "ticket-11"));
  }
  for (const name of ["ProjectOwnershipState", "ProjectMigrationGrant", "ProjectMigrationProject",
    "ProjectMigrationMove", "ProjectMigrationReview"]) {
    assert.equal(api.components.schemas[name], undefined, `${name} remains in the supported contract`);
  }
  for (const name of ["Task", "SearchTask"]) {
    assert.deepEqual(api.components.schemas[name].properties.container.enum, ["sprint", "backlog", "board"]);
  }
  const review = api.paths["/api/projects/hierarchy-repairs"].get;
  assert.deepEqual(review.security, [{ cookieAuth: [] }]);
  assert.equal(review.responses["200"].content["application/json"].schema.properties.hierarchy_repairs.items.$ref,
    "#/components/schemas/HierarchyRepair");
  assert.deepEqual(api.components.schemas.HierarchyRepairStage.enum, ["original", "correction"]);
});
