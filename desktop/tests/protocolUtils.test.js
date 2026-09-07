const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { isAllowedAppNavigation, isReadOnlyMethod, normalizeProtocolPath, resolveClientFile } = require("../protocolUtils");

test("normalizes encoded and Windows protocol paths", () => {
  assert.equal(normalizeProtocolPath(new URL("workpulse://app/api%2Ftasks")), "/api/tasks");
  assert.equal(normalizeProtocolPath(new URL("workpulse://app/uploads%5Cavatar.png")), "/uploads/avatar.png");
});

test("keeps static files inside the client root", () => {
  const root = path.resolve("client-dist");
  assert.equal(resolveClientFile(root, "/"), path.join(root, "index.html"));
  assert.equal(resolveClientFile(root, "/assets/app.js"), path.join(root, "assets", "app.js"));
  assert.equal(resolveClientFile(root, "/../secret.txt"), null);
});

test("allows only the app custom origin for navigation", () => {
  assert.equal(isAllowedAppNavigation("workpulse://app/settings"), true);
  assert.equal(isAllowedAppNavigation("workpulse://evil/settings"), false);
  assert.equal(isAllowedAppNavigation("https://example.com"), false);
});

test("uses caching only for read-only proxy requests", () => {
  assert.equal(isReadOnlyMethod("GET"), true);
  assert.equal(isReadOnlyMethod("HEAD"), true);
  assert.equal(isReadOnlyMethod("POST"), false);
});