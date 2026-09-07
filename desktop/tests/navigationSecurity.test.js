const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyWindowOpen } = require("../navigationSecurity");

test("window-open policy keeps authenticated uploads internal", () => {
  assert.deepEqual(classifyWindowOpen("workpulse://app/uploads/report.pdf?v=1", "https://api.example"), { kind: "upload", value: "/uploads/report.pdf?v=1" });
  assert.deepEqual(classifyWindowOpen("https://api.example/uploads/report.pdf", "https://api.example"), { kind: "upload", value: "/uploads/report.pdf" });
});

test("window-open policy externalizes web URLs and denies other schemes", () => {
  assert.equal(classifyWindowOpen("https://docs.example/x", "https://api.example").kind, "external");
  assert.equal(classifyWindowOpen("file:///secret", "https://api.example").kind, "deny");
  assert.equal(classifyWindowOpen("workpulse://evil/uploads/x", "https://api.example").kind, "deny");
});
