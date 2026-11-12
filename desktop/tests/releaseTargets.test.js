const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("macOS releases include ZIP update payloads for both supported architectures", () => {
  const config = fs.readFileSync(path.join(__dirname, "..", "electron-builder.yml"), "utf8");
  const mac = config.match(/^mac:\r?\n([\s\S]*?)(?=^[a-z][\w-]*:|(?![\s\S]))/m)?.[1];
  assert.ok(mac, "macOS packaging configuration is required");
  assert.match(mac, /- target: zip\s+arch:\s+- x64\s+- arm64/, "MacUpdater requires a ZIP for each architecture");
});
