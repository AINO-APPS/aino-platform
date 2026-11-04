import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateJsonSchema } from "../../scripts/lib/json-schema-lite.mjs";

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const openapi = JSON.parse(read("openapi.json"));

test("project rename and preview pin strict key input, affected count, permissions and conflicts", () => {
  for (const suffix of ["/key", "/key/preview"]) {
    const operation = openapi.paths[`/api/projects/{id}${suffix}`].post;
    assert.equal(operation.requestBody.content["application/json"].schema.$ref, "#/components/schemas/ProjectKeyRenameRequest");
    assert.equal(operation.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/ProjectKeyRenameResult");
    for (const status of ["400", "403", "404", "409"]) assert.ok(operation.responses[status], status);
  }
  const input = openapi.components.schemas.ProjectKeyRenameRequest;
  assert.deepEqual(validateJsonSchema(input, { key: "NEW_2" }), []);
  for (const key of ["bad", "A", "1NEW", "TOOLONGKEY12"]) {
    assert.ok(validateJsonSchema(input, { key }).length, key);
  }
  assert.ok(openapi.components.schemas.ProjectCapabilities.required.includes("canRenameKey"));
  const result = openapi.components.schemas.ProjectKeyRenameResult;
  assert.deepEqual(validateJsonSchema(result, {
    project_id: 10, old_key: "OLD", new_key: "NEW", affected_tickets: 2,
  }), []);
  assert.ok(result.required.includes("affected_tickets"));
});

test("project_updated is a documented post-commit invalidation and has explicit client parity", () => {
  const yaml = read("asyncapi/aino-realtime.yaml");
  assert.match(yaml, /#\/components\/messages\/ProjectUpdatedEvent/);
  assert.match(yaml, /enum: \[project_updated\]/);
  assert.match(yaml, /after commit/);
  const projectEvent = yaml.slice(yaml.indexOf("    ProjectUpdatedEvent:"), yaml.indexOf("    AttendanceUpdateEvent:"));
  assert.match(projectEvent, /required: \[project_id\]/);
  assert.match(projectEvent, /additionalProperties: false/);
  assert.doesNotMatch(projectEvent, /old_key|new_key|affected_tickets/);
  const feature = JSON.parse(read("tasks-parity.json")).features.find(item => item.id === "project-key-rename");
  assert.equal(feature.web.status, "shipped");
  assert.equal(feature.desktop.status, "shipped");
  assert.ok(feature.android.waiver);
});
