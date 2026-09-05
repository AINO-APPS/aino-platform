import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const routeMap = JSON.parse(fs.readFileSync(path.join(root, "contracts/mobile-route-map.json"), "utf8"));

test("legacy mobile wrapper inventory is complete and traceable", () => {
  assert.equal(routeMap.generatedFrom.commit, "d9d779c7520dbf052ba587ac2af649ec59920864");
  assert.equal(routeMap.totals.wrapperCalls, 307);
  assert.equal(routeMap.totals.unresolvedCalls, 0);
  assert.deepEqual(routeMap.totals.classifications, {
    active: 307,
    stale: 0,
    "method-mismatch": 0,
  });
  assert.ok(routeMap.wrappers.every(wrapper =>
    wrapper.source.startsWith("mobile/src/") &&
    Number.isInteger(wrapper.line) &&
    wrapper.line > 0 &&
    wrapper.apiPath.startsWith("/api/")
  ));
});

test("every mapped wrapper has a unique source call site", () => {
  const callSites = routeMap.wrappers.map(wrapper => `${wrapper.source}:${wrapper.line}:${wrapper.method}`);
  assert.equal(new Set(callSites).size, callSites.length);
});