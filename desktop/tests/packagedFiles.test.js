const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

// The installer only contains files listed in electron-builder.yml; dev runs load every file.
test("every local module reachable from main.js is packaged", () => {
  const config = fs.readFileSync(path.join(root, "electron-builder.yml"), "utf8");
  const section = config.split(/\r?\n/);
  const start = section.indexOf("files:");
  const packaged = new Set();
  for (const line of section.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const entry = line.match(/^\s+-\s+(\S+)/);
    if (entry) packaged.add(entry[1]);
  }
  const missing = [];
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    if (!packaged.has(file)) missing.push(file);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const [, name] of source.matchAll(/require\(["']\.\/([^"']+)["']\)/g)) {
      visit(name.endsWith(".js") || name.endsWith(".json") ? name : `${name}.js`);
    }
  };
  visit("main.js");
  visit("preload.js");
  assert.deepEqual(missing, []);
  assert.ok(visited.has("messageAlertWindow.js"));
});
