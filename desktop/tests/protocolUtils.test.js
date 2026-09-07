const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createProxyRequest, isAllowedAppNavigation, isReadOnlyMethod, normalizeProtocolPath, resolveClientFile, shouldApplyAppCsp } = require("../protocolUtils");

test("normalizes encoded and Windows protocol paths", () => {
  assert.equal(normalizeProtocolPath(new URL("workpulse://app/api%2Ftasks")), "/api/tasks");
  assert.equal(normalizeProtocolPath(new URL("workpulse://app/uploads%5Cavatar.png")), "/uploads/avatar.png");
  assert.equal(normalizeProtocolPath(new URL("workpulse://app/bad%ZZ")), "/bad%ZZ");
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

test("applies CSP only to canonical app main-frame documents", () => {
  assert.equal(shouldApplyAppCsp("workpulse://app/", "mainFrame"), true);
  assert.equal(shouldApplyAppCsp("workpulse://app/asset.js", "script"), false);
  assert.equal(shouldApplyAppCsp("workpulse://evil/", "mainFrame"), false);
});

test("builds a constrained API proxy request", () => {
  const request = new Request("workpulse://app/api/tasks?q=one", { method: "GET", headers: { host: "app", authorization: "Bearer x" } });
  const proxy = createProxyRequest("https://api.example", request);
  assert.equal(proxy.url, "https://api.example/api/tasks?q=one");
  assert.equal(proxy.init.cache, "default");
  assert.equal(proxy.init.credentials, "include");
  assert.equal(proxy.init.headers.get("host"), null);
  assert.equal(proxy.init.headers.get("origin"), "workpulse://app");
  assert.equal(createProxyRequest("https://api.example", new Request("workpulse://app/api/tasks", { method: "POST" })).init.cache, "no-store");
});
