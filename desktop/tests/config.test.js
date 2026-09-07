const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createDesktopConfig, DEFAULT_API_SERVER } = require("../config");

test("desktop config resolves development and packaged paths", () => {
  const dev = createDesktopConfig({ dirname: "C:/app/desktop", resourcesPath: "C:/resources", userData: "C:/user", isPackaged: false });
  assert.equal(dev.apiServer, DEFAULT_API_SERVER);
  assert.equal(dev.clientDist, path.join("C:/app/desktop", "..", "client", "dist"));
  assert.equal(dev.windowStateFile, path.join("C:/user", "window-state.json"));
  const packaged = createDesktopConfig({ apiServer: "https://api.example", dirname: "ignored", resourcesPath: "C:/resources", userData: "C:/user", isPackaged: true });
  assert.equal(packaged.apiServer, "https://api.example");
  assert.equal(packaged.clientDist, path.join("C:/resources", "client", "dist"));
});
