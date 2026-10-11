const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTrustedIpcSender, isTrustedRendererUrl } = require("../ipcSecurity");
const { isAllowedPermission, setupPermissions } = require("../permissions");

test("IPC accepts only the top-level app renderer", () => {
  const frame = { url: "workpulse://app/settings" }; frame.top = frame;
  assert.doesNotThrow(() => assertTrustedIpcSender({ senderFrame: frame }));
  for (const url of ["https://evil.example", "workpulse://evil/", "not a url", ""]) {
    assert.equal(isTrustedRendererUrl(url), false);
  }
  const top = { url: "workpulse://app/" }; top.top = top;
  assert.throws(() => assertTrustedIpcSender({ senderFrame: { url: "workpulse://app/", top } }), /untrusted/);
});

test("permission setup defers media consent until a trusted renderer requests it", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const handlers = {};
  setupPermissions({
    setPermissionRequestHandler: handler => { handlers.request = handler; },
    setPermissionCheckHandler: handler => { handlers.check = handler; },
  });
  assert.equal(typeof handlers.request, "function");
  assert.equal(typeof handlers.check, "function");
  assert.equal(fs.readFileSync(path.join(__dirname, "../permissions.js"), "utf8").includes("askForMediaAccess"), false);
  let granted;
  handlers.request({}, "media", value => { granted = value; }, { requestingUrl: "workpulse://app/chat" });
  assert.equal(granted, true);
  handlers.request({}, "media", value => { granted = value; }, { requestingUrl: "https://untrusted.example" });
  assert.equal(granted, false);
});

test("permissions are channel- and origin-restricted", () => {
  assert.equal(isAllowedPermission("geolocation", "workpulse://app/attendance"), true);
  assert.equal(isAllowedPermission("media", "https://embed.diagrams.net"), false);
  assert.equal(isAllowedPermission("notifications", "workpulse://app/"), false);
  assert.equal(isAllowedPermission("geolocation"), false);
});
