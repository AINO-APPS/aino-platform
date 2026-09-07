const test = require("node:test");
const assert = require("node:assert/strict");
const { setupLifecycle } = require("../lifecycle");

function fakeApp({ lock = true, packaged = true } = {}) {
  const handlers = new Map(); const calls = [];
  return { handlers, calls, isPackaged: packaged, on: (name, fn) => handlers.set(name, fn), setAsDefaultProtocolClient: scheme => calls.push(["protocol", scheme]), requestSingleInstanceLock: () => lock, quit: () => calls.push(["quit"]), isQuitting: false };
}

test("lifecycle registers protocol and routes second-instance deep links", () => {
  const app = fakeApp(); const loaded = [];
  const window = { isDestroyed: () => false, isMinimized: () => false, loadURL: url => loaded.push(url), show() {}, focus() {} };
  assert.equal(setupLifecycle(app, () => window), true);
  app.handlers.get("second-instance")({}, ["aino", "workpulse://app/tasks/7"]);
  assert.deepEqual(loaded, ["workpulse://app/tasks/7"]);
  assert.deepEqual(app.calls[0], ["protocol", "workpulse"]);
});

test("lifecycle quits when the single-instance lock is unavailable", () => {
  const app = fakeApp({ lock: false });
  assert.equal(setupLifecycle(app, () => null), false);
  assert.deepEqual(app.calls.at(-1), ["quit"]);
});
