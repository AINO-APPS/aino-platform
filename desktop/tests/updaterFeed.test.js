const test = require("node:test");
const assert = require("node:assert/strict");
const { getDesktopTag } = require("../updaterFeed");

test("reads a valid desktop tag from the release pointer", () => {
  assert.equal(getDesktopTag({ version: "3.0.13", tag: "v3.0.13" }), "v3.0.13");
  assert.equal(getDesktopTag({ version: "3.0.13" }), "v3.0.13");
});

test("rejects malformed desktop release pointers", () => {
  assert.equal(getDesktopTag(null), null);
  assert.equal(getDesktopTag({}), null);
  assert.equal(getDesktopTag({ tag: "mobile-v3.0.13" }), null);
  assert.equal(getDesktopTag({ tag: "../v3.0.13" }), null);
  assert.equal(getDesktopTag({ version: 3013 }), null);
});
