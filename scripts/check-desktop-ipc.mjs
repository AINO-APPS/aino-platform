import fs from "node:fs";
import path from "node:path";

const desktopRoot = path.resolve("desktop");
const declaration = JSON.parse(fs.readFileSync(path.join(desktopRoot, "ipc-channels.json"), "utf8"));
const files = fs.readdirSync(desktopRoot)
  .filter((name) => name.endsWith(".ts") && !/\.(?:test|spec)\.ts$/.test(name))
  .map((name) => fs.readFileSync(path.join(desktopRoot, name), "utf8"));
const source = files.join("\n");

function matches(patterns) {
  const found = new Set();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) found.add(match[1]);
  }
  return found;
}

const rendererCalls = matches([
  /ipcRenderer\.(?:send|invoke)\(\s*["']([^"']+)["']/g,
]);
const mainHandlers = matches([
  /ipcMain\.(?:on|handle)\(\s*["']([^"']+)["']/g,
]);
const rendererListeners = matches([
  /createListener(?:<[^>]+>)?\(\s*["']([^"']+)["']/g,
  /ipcRenderer\.on\(\s*["']([^"']+)["']/g,
]);
const mainSends = matches([
  /webContents\.send\(\s*["']([^"']+)["']/g,
  /sendToRenderer\(\s*["']([^"']+)["']/g,
]);

const failures = [];
function verify(label, declaredValues, producer, consumer) {
  const declared = new Set(declaredValues);
  for (const channel of producer) {
    if (!declared.has(channel)) failures.push(`${label}: undeclared producer channel ${channel}`);
  }
  for (const channel of consumer) {
    if (!declared.has(channel)) failures.push(`${label}: undeclared consumer channel ${channel}`);
  }
  for (const channel of declared) {
    if (!producer.has(channel)) failures.push(`${label}: declared channel has no producer ${channel}`);
    if (!consumer.has(channel)) failures.push(`${label}: declared channel has no consumer ${channel}`);
  }
}

verify("rendererToMain", declaration.rendererToMain, rendererCalls, mainHandlers);
verify("mainToRenderer", declaration.mainToRenderer, mainSends, rendererListeners);

if (failures.length) {
  console.error(`Desktop IPC contract guard failed:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exit(1);
}

console.log(`Desktop IPC contract guard passed (${rendererCalls.size} renderer→main, ${mainSends.size} main→renderer channels).`);