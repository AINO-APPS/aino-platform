const test = require("node:test");
const assert = require("node:assert/strict");
const { subscribe } = require("../preloadListeners");

test("preload subscriptions deliver values and unsubscribe exactly once", () => {
  let handler; const removed = [];
  const transport = { on: (_channel, fn) => { handler = fn; }, removeListener: (channel, fn) => removed.push([channel, fn]) };
  const values = [];
  const unsubscribe = subscribe(transport, "maximize-change", value => values.push(value));
  handler({}, true);
  unsubscribe(); unsubscribe();
  assert.deepEqual(values, [true]);
  assert.equal(removed.length, 1);
  assert.equal(removed[0][0], "maximize-change");
  assert.equal(removed[0][1], handler);
});

test("preload subscriptions apply listener transforms", () => {
  let handler;
  const transport = { on: (_channel, fn) => { handler = fn; }, removeListener() {} };
  const values = [];
  subscribe(transport, "update-not-available", value => values.push(value), () => ({}));
  handler({});
  assert.deepEqual(values, [{}]);
});
