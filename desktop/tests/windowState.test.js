const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_WINDOW_STATE, parseWindowState } = require("../windowState");

test("loads valid persisted window state", () => {
  assert.deepEqual(parseWindowState('{"width":1440,"height":900,"x":10,"y":20,"isMaximized":true}'), {
    width: 1440, height: 900, x: 10, y: 20, isMaximized: true,
  });
});

test("falls back for missing, corrupt, or incomplete state", () => {
  assert.deepEqual(parseWindowState(undefined), DEFAULT_WINDOW_STATE);
  assert.deepEqual(parseWindowState("{"), DEFAULT_WINDOW_STATE);
  assert.deepEqual(parseWindowState('{"width":100}'), DEFAULT_WINDOW_STATE);
  assert.deepEqual(parseWindowState('{"width":799,"height":600}'), DEFAULT_WINDOW_STATE);
  assert.deepEqual(parseWindowState('{"width":1280,"height":800,"x":"left"}'), DEFAULT_WINDOW_STATE);
});