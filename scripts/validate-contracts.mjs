import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const inventory = readJson("contracts/http-route-inventory.json");
const mobileRoutes = readJson("contracts/mobile-route-map.json");
const api = readJson("contracts/openapi.json");
const errors = [];
const check = (ok, message) => { if (!ok) errors.push(message); };

check(api.openapi === "3.1.0", "openapi.json must declare OpenAPI 3.1.0");
check(api.info?.version, "OpenAPI info.version is required");
check(api.components?.securitySchemes?.cookieAuth, "cookieAuth security scheme is required");
check(api.components?.securitySchemes?.bearerAuth, "bearerAuth security scheme is required");
check(api.components?.schemas?.Error, "shared Error schema is required");
check(Array.isArray(inventory.mounts) && inventory.mounts.length > 0, "route inventory mounts are required");
check(Array.isArray(inventory.endpoints) && inventory.endpoints.length > 0, "route inventory endpoints are required");
check(mobileRoutes.generatedFrom?.commit === "d9d779c7520dbf052ba587ac2af649ec59920864", "mobile route map must use the immutable legacy commit");
check(Array.isArray(mobileRoutes.wrappers) && mobileRoutes.wrappers.length > 0, "mobile route wrappers are required");
check(Array.isArray(mobileRoutes.unresolved) && mobileRoutes.unresolved.length === 0, "all mobile wrapper calls must have a literal or template-literal route");

const sourceRoutes = fs.readFileSync(path.join(root, "server/http/routes.ts"), "utf8");
const sourceMounts = [...sourceRoutes.matchAll(/app\.use\("(\/api\/[^" ]+)"\s*,[^;]*?([A-Za-z][A-Za-z0-9]*)Routes\);/g)]
  .map(([, mountPath]) => mountPath);
for (const mountPath of sourceMounts) check(inventory.mounts.some(m => m.mountPath === mountPath), `mounted router missing from inventory: ${mountPath}`);
for (const mount of inventory.mounts) {
  check(fs.existsSync(path.join(root, mount.source)), `inventory source does not exist: ${mount.source}`);
  check(sourceRoutes.includes(`"${mount.mountPath}"`), `inventory mount is absent from server/http/routes.ts: ${mount.mountPath}`);
}

const operationKeys = new Set();
const refs = [];
const walk = value => {
  if (!value || typeof value !== "object") return;
  if (typeof value.$ref === "string") refs.push(value.$ref);
  for (const child of Object.values(value)) walk(child);
};
walk(api);
for (const ref of refs) {
  if (!ref.startsWith("#/")) continue;
  const found = ref.slice(2).split("/").reduce((v, part) => v?.[part.replace(/~1/g, "/").replace(/~0/g, "~")], api);
  check(found !== undefined, `unresolved local reference: ${ref}`);
}
for (const [routePath, item] of Object.entries(api.paths || {})) {
  for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
    const operation = item[method];
    if (!operation) continue;
    const expressPath = routePath.replace(/\{([^}]+)\}/g, ":$1");
    const key = `${method.toUpperCase()} ${expressPath}`;
    operationKeys.add(key);
    check(inventory.endpoints.some(e => `${e.method} ${e.path}` === key), `OpenAPI operation is not in server route inventory: ${key}`);
    check(operation.responses && Object.keys(operation.responses).length, `operation has no responses: ${key}`);
    if (["post", "put", "patch", "delete"].includes(method) && routePath.startsWith("/api/") && !routePath.startsWith("/api/webhooks/")) {
      check((operation.parameters || []).some(p => p.$ref === "#/components/parameters/CsrfHeader"), `mutating API operation lacks X-Requested-With header: ${key}`);
    }
  }
}
for (const endpoint of inventory.endpoints.filter(e => e.coverage === "operation")) {
  check(operationKeys.has(`${endpoint.method} ${endpoint.path}`), `endpoint marked covered but missing from OpenAPI: ${endpoint.method} ${endpoint.path}`);
}
check(operationKeys.size === inventory.totals.openApiOperations, "inventory OpenAPI operation total is stale");
for (const [routePath, item] of Object.entries(api.paths || {}).filter(([routePath]) => routePath.startsWith("/api/notifications"))) {
  for (const method of ["get", "post", "delete"]) {
    if (!item[method]) continue;
    check(!JSON.stringify(item[method]).includes("FreeFormValue"), `notification operation is not exhaustively modeled: ${method.toUpperCase()} ${routePath}`);
  }
}
check(!JSON.stringify(api.paths?.["/api/search"]?.get || {}).includes("FreeFormValue"), "search operation is not exhaustively modeled: GET /api/search");

const structuralPath = value => value.replace(/:[^/]+/g, ":param");
const classificationTotals = { active: 0, stale: 0, "method-mismatch": 0 };
for (const wrapper of mobileRoutes.wrappers || []) {
  const samePath = inventory.endpoints.filter(endpoint => structuralPath(endpoint.path) === structuralPath(wrapper.apiPath));
  const exact = samePath.some(endpoint => endpoint.method === wrapper.method);
  const expected = exact ? "active" : samePath.length ? "method-mismatch" : "stale";
  check(wrapper.classification === expected, `mobile route classification is stale: ${wrapper.method} ${wrapper.apiPath}`);
  check(wrapper.source?.startsWith("mobile/src/"), `invalid mobile route source: ${wrapper.source}`);
  check(Number.isInteger(wrapper.line) && wrapper.line > 0, `invalid mobile route source line: ${wrapper.source}:${wrapper.line}`);
  if (expected in classificationTotals) classificationTotals[expected] += 1;
}
check(mobileRoutes.totals?.wrapperCalls === mobileRoutes.wrappers?.length, "mobile wrapper total is stale");
check(mobileRoutes.totals?.unresolvedCalls === mobileRoutes.unresolved?.length, "mobile unresolved total is stale");
for (const [classification, total] of Object.entries(classificationTotals)) {
  check(mobileRoutes.totals?.classifications?.[classification] === total, `mobile ${classification} total is stale`);
}

if (errors.length) {
  console.error(`Contract validation failed (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Contracts valid: ${inventory.mounts.length} router mounts, ${inventory.endpoints.length} endpoints inventoried, ${operationKeys.size} OpenAPI operations, ${mobileRoutes.wrappers.length} mobile wrapper calls classified.`);

// Keep the realtime baseline dependency-free and part of the same repository gate.
await import("./validate-realtime-contracts.mjs");
