/** Static MIG-0401..0404 checks. No Railway auth, plan, or apply is used. */
import fs from "node:fs";

const path = ".railway/railway.ts";
const src = fs.readFileSync(path, "utf8");
const errors = [];
const requireMatch = (pattern, message) => { if (!pattern.test(src)) errors.push(message); };
const rejectMatch = (pattern, message) => { if (pattern.test(src)) errors.push(message); };

// MIG-0401: an isolated project with fresh data-plane declarations.
requireMatch(/project\("aino-platform-next"/, "Project must be aino-platform-next");
for (const resource of ["Postgres", "Redis", "PgBouncer"]) {
  requireMatch(new RegExp(`[\\"']${resource}[\\"']`), `Missing fresh ${resource} resource`);
}

// MIG-0402: no legacy project/repository or production-domain coupling.
requireMatch(/SOURCE\s*=\s*"AINO-APPS\/aino-platform"/, "Source must be AINO-APPS/aino-platform");
for (const forbidden of [
  /renewed-fascination/i,
  /vvronline\/WorkPulse/i,
  /aino\.org\.in/i,
  /workpulse-prod\.up\.railway\.app/i,
  /customDomains\s*:/,
  /serviceDomains\s*:/,
  /tcpProxies\s*:/,
  /domains\s*:/,
]) rejectMatch(forbidden, `Forbidden active-IaC reference: ${forbidden}`);

// MIG-0403: exact fresh role topology and role assignment.
const expected = {
  "aino-next-web": "web",
  "aino-next-realtime": "realtime",
  "aino-next-worker": "worker",
  "aino-next-rollback": "all",
};
for (const [name, role] of Object.entries(expected)) {
  requireMatch(new RegExp(`appService\\("${name}",\\s*"${role}"\\)`), `${name} must have ROLE=${role}`);
}
requireMatch(/preDeployCommand:\s*role === "web" \? \["node migrate\.js"\] : undefined/,
  "Only the web service may run pre-deploy migrations");

// MIG-0404: private-only exposure and side-effect-safe bootstrap defaults.
requireMatch(/networking:\s*\{\s*privateNetworkEndpoint:\s*name\s*\}/,
  "App services must be private-only by default");
for (const setting of [
  /NODE_ENV:\s*"development"/,
  /STORAGE_DRIVER:\s*"local"/,
  /DISABLE_PUBLIC_TURN:\s*"true"/,
  /CORS_ORIGIN:\s*""/,
  /SERVE_SPA:\s*role === "web" \|\| role === "all" \? "true" : "false"/,
  /numReplicas:\s*1/,
  /sleepApplication:\s*role === "all"/,
  /JWT_SECRET:\s*preserve\(\)/,
  /ENCRYPTION_KEY:\s*preserve\(\)/,
  /DESKTOP_UPLOAD_SECRET:\s*preserve\(\)/,
  /METRICS_TOKEN:\s*preserve\(\)/,
  /SMTP_HOST:\s*""/,
  /FIREBASE_SERVICE_ACCOUNT_KEY:\s*""/,
  /R2_ACCESS_KEY_ID:\s*""/,
]) requireMatch(setting, `Missing safe bootstrap setting: ${setting}`);

const dockerfile = fs.readFileSync("Dockerfile", "utf8");
if (/node migrate\.js\s*&&/.test(dockerfile)) errors.push("Dockerfile runs migrations at startup");
const pkg = JSON.parse(fs.readFileSync("server/package.json", "utf8"));
if (/migrate/.test(pkg.scripts?.start || "")) errors.push("Server start script runs migrations");

if (errors.length) {
  console.error("Railway config verification failed:\n" + errors.map((e) => `  ${e}`).join("\n"));
  process.exit(1);
}
console.log("Railway config verified: MIG-0401..0404 isolated, private-only, and side-effect-safe.");
