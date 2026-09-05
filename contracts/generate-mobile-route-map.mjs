import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const legacyRepo = path.resolve(process.argv[2] || process.env.AINO_LEGACY_REPO || "../WorkPulse");
const legacyCommit = process.argv[3] || process.env.AINO_LEGACY_COMMIT || "d9d779c7520dbf052ba587ac2af649ec59920864";
const inventory = JSON.parse(fs.readFileSync(path.join(root, "contracts/http-route-inventory.json"), "utf8"));
const serverRoutes = inventory.endpoints.map(({ method, path: routePath }) => ({ method, path: routePath }));

const git = (...args) => execFileSync("git", ["-C", legacyRepo, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
const resolvedCommit = git("rev-parse", legacyCommit).trim();
if (resolvedCommit !== legacyCommit) throw new Error(`Legacy commit did not resolve exactly to ${legacyCommit}`);

const sourceFiles = git("grep", "-l", "-E", "api\\.(get|post|put|patch|delete)", legacyCommit, "--", "mobile/src/*.ts", "mobile/src/*.tsx")
  .split(/\r?\n/)
  .filter(Boolean)
  .map(name => name.replace(`${legacyCommit}:`, ""));

const lineAt = (source, index) => source.slice(0, index).split("\n").length;
const parameterName = expression => {
  const identifiers = expression.match(/[A-Za-z_$][\w$]*/g) || [];
  return identifiers.at(-1) || "param";
};
const normalizeTemplate = value => value
  .replace(/\$\{([^}]*)\}/g, (_, expression) => `:${parameterName(expression)}`)
  .replace(/\?.*$/, "")
  .replace(/\/$/, "") || "/";
const structuralPath = value => value.replace(/:[^/]+/g, ":param");

function readFirstArgument(source, callIndex) {
  let index = callIndex;
  let angleDepth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "<") angleDepth += 1;
    else if (char === ">" && angleDepth) angleDepth -= 1;
    else if (char === "(" && angleDepth === 0) break;
    index += 1;
  }
  index += 1;
  while (/\s/.test(source[index])) index += 1;
  const quote = source[index];
  if (!['"', "'", "`"].includes(quote)) return null;
  let value = "";
  for (index += 1; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") {
      value += char + (source[index + 1] || "");
      index += 1;
    } else if (char === quote) {
      return value;
    } else {
      value += char;
    }
  }
  return null;
}

const wrappers = [];
const unresolved = [];
for (const source of sourceFiles) {
  const content = git("show", `${legacyCommit}:${source}`);
  for (const match of content.matchAll(/\bapi\.(get|post|put|patch|delete)\b/g)) {
    const method = match[1].toUpperCase();
    const value = readFirstArgument(content, match.index + match[0].length);
    if (value === null) {
      unresolved.push({ source, line: lineAt(content, match.index), method, reason: "non-literal first argument" });
      continue;
    }
    const relativePath = normalizeTemplate(value);
    const apiPath = `/api${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
    const structural = structuralPath(apiPath);
    const samePath = serverRoutes.filter(route => structuralPath(route.path) === structural);
    const exact = samePath.some(route => route.method === method);
    wrappers.push({
      source,
      line: lineAt(content, match.index),
      method,
      relativePath,
      apiPath,
      classification: exact ? "active" : samePath.length ? "method-mismatch" : "stale",
      ...(samePath.length && !exact ? { serverMethods: [...new Set(samePath.map(route => route.method))].sort() } : {}),
    });
  }
}

wrappers.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line || a.method.localeCompare(b.method));
const classifications = Object.fromEntries(["active", "stale", "method-mismatch"].map(value => [value, wrappers.filter(item => item.classification === value).length]));
const output = {
  schemaVersion: 1,
  generatedFrom: { repository: "legacy WorkPulse Git history", commit: legacyCommit, path: "mobile/src/**/*.{ts,tsx}" },
  basePath: "/api",
  scopeNote: "Every legacy Axios api.get/post/put/patch/delete call with a literal or template-literal first argument. Template expressions are normalized to path parameters before comparison with the tested server route snapshot.",
  totals: { sourceFilesScanned: sourceFiles.length, wrapperCalls: wrappers.length, unresolvedCalls: unresolved.length, classifications },
  unresolved,
  wrappers,
};
fs.writeFileSync(path.join(root, "contracts/mobile-route-map.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(`Mapped ${wrappers.length} mobile wrapper calls: ${classifications.active} active, ${classifications.stale} stale, ${classifications["method-mismatch"]} method-mismatch, ${unresolved.length} unresolved.`);