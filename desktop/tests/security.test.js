const test = require("node:test");
const assert = require("node:assert/strict");
const { assertTrustedIpcSender, isTrustedRendererUrl } = require("../ipcSecurity");
const { isAllowedPermission } = require("../permissions");

test("IPC accepts only the top-level app renderer", () => {
  const frame = { url: "workpulse://app/settings" }; frame.top = frame;
  assert.doesNotThrow(() => assertTrustedIpcSender({ senderFrame: frame }));
  for (const url of ["https://evil.example", "workpulse://evil/", "not a url", ""]) {
    assert.equal(isTrustedRendererUrl(url), false);
  }
  const top = { url: "workpulse://app/" }; top.top = top;
  assert.throws(() => assertTrustedIpcSender({ senderFrame: { url: "workpulse://app/", top } }), /untrusted/);
});

test("permissions are channel- and origin-restricted", () => {
  assert.equal(isAllowedPermission("geolocation", "workpulse://app/attendance"), true);
  assert.equal(isAllowedPermission("media", "https://embed.diagrams.net"), false);
  assert.equal(isAllowedPermission("notifications", "workpulse://app/"), false);
  assert.equal(isAllowedPermission("geolocation"), false);
});
