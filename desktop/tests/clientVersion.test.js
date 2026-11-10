const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { readBundledWebVersion } = require("../clientVersion");

test("the proxy fallback reads the immutable bundled WEB version, never Electron's shell version", () => {
  assert.equal(readBundledWebVersion(path.join(__dirname, "fixtures", "client-dist")), "3.0.80+web.abcdef012345");
  assert.equal(readBundledWebVersion(path.join(__dirname, "fixtures", "missing-dist")), undefined);
});
