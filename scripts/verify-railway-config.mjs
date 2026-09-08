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
requireMatch(/github\(SOURCE,\s*\{\s*branch:\s*BRANCH,\s*checkSuites:\s*true\s*\}\)/,
  "Application deployments must wait for successful GitHub checks");
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
requireMatch(/DATABASE_URL:\s*Postgres\.env\.DATABASE_URL/,
  "Initial deployment must connect directly to fresh Postgres before the PgBouncer canary");

// MIG-0404: private-only exposure and side-effect-safe bootstrap defaults.
requireMatch(/networking:\s*\{\s*privateNetworkEndpoint:\s*name\s*\}/,
  "App services must be private-only by default");
// Production posture. NODE_ENV and STORAGE_DRIVER must move together:
// assertProductionStorage() refuses to boot on local disk in production, and
// local disk cannot be shared across replicas anyway.
for (const setting of [
  /NODE_ENV:\s*"production"/,
  /STORAGE_DRIVER:\s*"r2"/,
  /USE_HTTPS:\s*"true"/,
  /DISABLE_PUBLIC_TURN:\s*"true"/,
  /SERVE_SPA:\s*role === "web" \|\| role === "all" \? "true" : "false"/,
  /numReplicas:\s*1/,
  /sleepApplication:\s*role === "all"/,
]) requireMatch(setting, `Missing production setting: ${setting}`);

// Every operator-supplied credential must be preserve(), never a literal.
// Hardcoding "" here silently WIPES a value already configured in Railway on
// the next apply — which is how a working deployment loses its R2 keys.
for (const secret of [
  "JWT_SECRET",
  "ENCRYPTION_KEY",
  "DESKTOP_UPLOAD_SECRET",
  "METRICS_TOKEN",
  "CORS_ORIGIN",
  "CLOUDFLARE_TURN_API_TOKEN",
  "CLOUDFLARE_TURN_TOKEN_ID",
  "FIREBASE_SERVICE_ACCOUNT_KEY",
  "GIPHY_API_KEY",
  "GMAIL_CLIENT_ID",
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GOOGLE_API_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_ACCOUNT_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_UPLOADS_BUCKET",
  "SMTP_FROM",
  "SMTP_HOST",
  "SMTP_PASS",
  "SMTP_USER",
]) {
  requireMatch(new RegExp(`${secret}:\\s*preserve\\(\\)`), `${secret} must use preserve(), not a literal`);
  rejectMatch(new RegExp(`${secret}:\\s*""`), `${secret} is hardcoded empty and would wipe the configured value`);
}

// STORAGE_DRIVER=local in production is a boot failure, not a warning.
if (/NODE_ENV:\s*"production"/.test(src) && /STORAGE_DRIVER:\s*"local"/.test(src)) {
  errors.push("STORAGE_DRIVER=local cannot be used with NODE_ENV=production");
}

const dockerfile = fs.readFileSync("Dockerfile", "utf8");
if (/node migrate\.js\s*&&/.test(dockerfile)) errors.push("Dockerfile runs migrations at startup");
const pkg = JSON.parse(fs.readFileSync("server/package.json", "utf8"));
if (/migrate/.test(pkg.scripts?.start || "")) errors.push("Server start script runs migrations");

if (errors.length) {
  console.error("Railway config verification failed:\n" + errors.map((e) => `  ${e}`).join("\n"));
  process.exit(1);
}
console.log("Railway config verified: MIG-0401..0404 isolated, private-only, and side-effect-safe.");
