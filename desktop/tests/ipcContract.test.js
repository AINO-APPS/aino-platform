const test = require("node:test");
const assert = require("node:assert/strict");
const { INVOKE_CHANNELS, SEND_CHANNELS, LISTENER_CHANNELS } = require("../ipc-contract");

test("IPC channel groups contain unique, non-overlapping request channels", () => {
  for (const channels of [INVOKE_CHANNELS, SEND_CHANNELS, LISTENER_CHANNELS]) {
    assert.equal(new Set(channels).size, channels.length);
  }
  for (const channel of INVOKE_CHANNELS) assert.equal(SEND_CHANNELS.includes(channel), false);
});

test("critical preload channels remain declared", () => {
  assert.ok(INVOKE_CHANNELS.includes("get-wifi-info"));
  assert.ok(SEND_CHANNELS.includes("screen-source-selected"));
  assert.ok(LISTENER_CHANNELS.includes("screen-sources"));
});