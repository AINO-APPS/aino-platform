const test = require("node:test");
const assert = require("node:assert/strict");
const { parseDeepLink, findDeepLink, deliverDeepLink, showWindow } = require("../deepLinks");

test("deep links accept only the canonical app origin and preserve route data", () => {
  assert.equal(parseDeepLink("workpulse://app/meet/ABC?join=1#video"), "workpulse://app/meet/ABC?join=1#video");
  assert.equal(parseDeepLink("https://app/meet/ABC"), null);
  assert.equal(parseDeepLink("workpulse://evil/meet/ABC"), null);
  assert.equal(findDeepLink(["aino.exe", "--flag", "workpulse://app/tasks/1"]), "workpulse://app/tasks/1");
});

test("deep-link delivery navigates and focuses an existing window", () => {
  const calls = [];
  const win = { isDestroyed: () => false, isMinimized: () => true, restore: () => calls.push("restore"), show: () => calls.push("show"), focus: () => calls.push("focus"), loadURL: url => calls.push(url) };
  assert.equal(deliverDeepLink(win, "workpulse://app/tasks/1"), true);
  assert.deepEqual(calls, ["workpulse://app/tasks/1", "restore", "show", "focus"]);
  assert.equal(deliverDeepLink(win, "https://evil.example"), false);
  assert.doesNotThrow(() => showWindow(null));
});
