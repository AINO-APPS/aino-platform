import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const api = JSON.parse(fs.readFileSync(path.join(root, "contracts/openapi.json"), "utf8"));
const notificationOperations = Object.entries(api.paths)
  .filter(([routePath]) => routePath.startsWith("/api/notifications"))
  .flatMap(([routePath, item]) => Object.entries(item).map(([method, operation]) => ({ routePath, method, operation })));

test("all notification operations use field-level schemas", () => {
  assert.equal(notificationOperations.length, 7);
  for (const { routePath, method, operation } of notificationOperations) {
    assert.ok(!JSON.stringify(operation).includes("FreeFormValue"), `${method.toUpperCase()} ${routePath}`);
  }
});

test("notification pagination, IDs, and metric bounds match handlers", () => {
  const listParameters = api.paths["/api/notifications"].get.parameters;
  assert.deepEqual(listParameters.find(parameter => parameter.name === "page").schema, { type: "integer", minimum: 1, default: 1 });
  assert.deepEqual(listParameters.find(parameter => parameter.name === "per_page").schema, { type: "integer", minimum: 1, maximum: 100, default: 50 });
  assert.deepEqual(api.paths["/api/notifications/{id}"].delete.parameters[0].schema, { type: "integer" });
  const events = api.components.schemas.NotificationMetricBatchRequest.properties.events;
  assert.equal(events.minItems, 1);
  assert.equal(events.maxItems, 200);
  assert.deepEqual(api.components.schemas.NotificationMetricsResponse.properties.successRate.type, ["number", "null"]);
});