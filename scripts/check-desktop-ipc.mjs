import fs from "node:fs";
import path from "node:path";

const desktopRoot = path.resolve("desktop");
const contractSource = fs.readFileSync(path.join(desktopRoot, "ipc-contract.ts"), "utf8");
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "build", "tests"].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}
const source = walk(desktopRoot)
  .filter((file) => file.endsWith(".ts") && !/\.(?:test|spec)\.ts$/.test(file) && path.basename(file) !== "ipc-contract.ts")
  .map((file) => fs.readFileSync(file, "utf8")).join("\n");

function matches(text, patterns) {
  const found = new Set();
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[1]);
  return found;
}
function contractChannels(constant) {
  const declaration = new RegExp(`export const ${constant} = \\[([^\\]]+)\\]`, "s").exec(contractSource);
  if (!declaration) throw new Error(`Missing ${constant} in typed IPC contract`);
  return matches(declaration[1], [/['"]([^'"]+)['"]/g]);
}

const invokes = matches(source, [/\b(?:invoke|handleIpc)\(\s*["']([^"']+)["']/g]);
const sends = matches(source, [/\b(?:send|onIpc)\(\s*["']([^"']+)["']/g]);
const listeners = matches(source, [/createListener(?:<[^>]+>)?\(\s*["']([^"']+)["']/g, /ipcRenderer\.on\(\s*["']([^"']+)["']/g]);
const mainSends = matches(source, [/\b(?:sendIpc|sendToRenderer)\([^,]+,\s*["']([^"']+)["']/g, /sendToRenderer\(\s*["']([^"']+)["']/g]);
const failures = [];
function verify(label, declared, producer, consumer) {
  for (const channel of producer) if (!declared.has(channel)) failures.push(`${label}: undeclared producer channel ${channel}`);
  for (const channel of consumer) if (!declared.has(channel)) failures.push(`${label}: undeclared consumer channel ${channel}`);
  for (const channel of declared) {
    if (!producer.has(channel)) failures.push(`${label}: declared channel has no producer ${channel}`);
    if (!consumer.has(channel)) failures.push(`${label}: declared channel has no consumer ${channel}`);
  }
}
verify("invoke", contractChannels("INVOKE_CHANNELS"), invokes, invokes);
verify("send", contractChannels("SEND_CHANNELS"), sends, sends);
verify("listener", contractChannels("LISTENER_CHANNELS"), mainSends, listeners);
if (/\[\s*key\s*:\s*string\s*\]\s*:\s*any/.test(fs.readFileSync(path.resolve("client/vite-env.d.ts"), "utf8"))) failures.push("renderer bridge has arbitrary index signature");

// The client CI job typechecks `desktop/ipc-types.ts` (via renderer imports and
// the `Window.electronAPI` declaration) without installing desktop dependencies.
// An `electron` import there fails `client && npm run typecheck` in CI while
// passing locally, where desktop/node_modules happens to exist.
const sharedTypes = fs.readFileSync(path.join(desktopRoot, "ipc-types.ts"), "utf8");
if (/\bfrom\s+["']electron["']|\brequire\(\s*["']electron["']\s*\)/.test(sharedTypes)) {
  failures.push("ipc-types.ts must not reference electron; renderer-facing types have to typecheck without desktop dependencies");
}
for (const rendererFile of ["client/vite-env.d.ts", ...walk(path.resolve("client/src")).filter((file) => /\.tsx?$/.test(file))]) {
  if (/desktop\/ipc-contract/.test(fs.readFileSync(rendererFile, "utf8"))) {
    failures.push(`${path.relative(process.cwd(), rendererFile).replace(/\\/g, "/")}: import desktop/ipc-types instead of desktop/ipc-contract`);
  }
}
if (failures.length) {
  console.error(`Desktop IPC contract guard failed:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
  process.exit(1);
}
console.log(`Desktop typed IPC contract guard passed (${invokes.size} invoke, ${sends.size} send, ${mainSends.size} listener channels).`);