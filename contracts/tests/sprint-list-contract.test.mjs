import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(
  path.join(root, "fixtures/sprint-list.current.json"),
  "utf8",
));
const api = JSON.parse(fs.readFileSync(path.join(root, "openapi.json"), "utf8"));

test("the current-sprint fixture matches the sprint-list contract", () => {
  const schema = api.components.schemas.SprintList;
  assert.ok(schema);
  assert.equal(fixture.schema, "../../openapi.json#/components/schemas/SprintList");
  assert.deepEqual(schema.required, ["sprints", "currentSprintId"]);
  assert.deepEqual(fixture.data, {
    sprints: [{
      id: 31,
      project_id: 7,
      name: "Sprint 12",
      status: "paused",
    }],
    currentSprintId: 31,
  });

  assert.deepEqual(fixture.data.sprints[0], fixture.data.sprints.find(
    (sprint) => sprint.id === fixture.data.currentSprintId,
  ));
  for (const field of ["team_id", "team_name", "auto_managed", "is_auto", "sprint_number"]) {
    assert.equal(api.components.schemas.Sprint.properties[field], undefined);
  }
  assert.ok(api.components.schemas.Sprint.required.includes("project_id"));
});

test("the sprint-list contract preserves no current sprint alongside planned and completed sprints", () => {
  const noCurrent = JSON.parse(fs.readFileSync(
    path.join(root, "fixtures/sprint-list.no-current.json"),
    "utf8",
  ));
  assert.equal(noCurrent.schema, fixture.schema);
  assert.ok(api.components.schemas.SprintList.properties.currentSprintId.type.includes("null"));
  assert.equal(noCurrent.data.currentSprintId, null);
  assert.deepEqual(noCurrent.data.sprints.map((sprint) => sprint.status), ["planned", "completed"]);
});
