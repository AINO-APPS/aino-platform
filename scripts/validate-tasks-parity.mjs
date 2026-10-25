#!/usr/bin/env node
/**
 * Validates contracts/tasks-parity.json — the machine-checked parity matrix for
 * the Tasks area (see docs/TASKS_DESIGN_SPEC.md, decision D44).
 *
 * "Same design and features on every client" is a guarantee only if drift fails
 * a build. This script is that build step. It uses Node built-ins only, matching
 * the other validators in scripts/.
 *
 * Enforced rules:
 *   1. Shape: version/updated/spec/clients/features/non_goals present and typed.
 *   2. Unique kebab-case feature ids; every feature names a decision (D<n>).
 *   3. Every decision id referenced exists in docs/TASKS_DESIGN_SPEC.md.
 *   4. Every feature has an entry for every client, with a known status.
 *   5. `shipped` requires a concrete owner_test (no "shared with web").
 *   6. If web is shipped, any other client must be shipped or waived — never
 *      silently planned. This is the drift gate.
 *   7. `n/a` requires waiver text and a phase.
 *   8. `waived` requires waiver text (a reason, not a shrug).
 *   9. Desktop is the web bundle over workpulse:// (desktop/windows.ts:30) and must
 *      never diverge from web: it is shipped when web is shipped, planned when
 *      web is planned. Treating it as an independent client is how a desktop
 *      regression gets "fixed" by editing the matrix.
 *  10. `updated` must be a real ISO date.
 *  11. A feature must not regress to a status this script cannot reason about.
 *
 * Exit code 0 = valid. Exit code 1 = violations printed to stderr.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATRIX = "contracts/tasks-parity.json";
const SPEC = "docs/TASKS_DESIGN_SPEC.md";
const CLIENTS = ["web", "desktop", "android", "ios"];
const STATUSES = new Set(["shipped", "planned", "n/a", "waived"]);
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DECISION = /^D[0-9]+$/;

const fail = [];
const check = (condition, message) => { if (!condition) fail.push(message); };
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const matrix = JSON.parse(read(MATRIX));
const spec = read(SPEC);

check(matrix.version === 1, `${MATRIX}: version must be 1`);
check(matrix.spec === SPEC, `${MATRIX}: spec must point at ${SPEC}`);
check(
  typeof matrix.updated === "string" && /^\d{4}-\d{2}-\d{2}$/.test(matrix.updated) && !Number.isNaN(Date.parse(matrix.updated)),
  `${MATRIX}: updated must be an ISO date (yyyy-mm-dd)`
);
check(
  Array.isArray(matrix.clients) && matrix.clients.length === CLIENTS.length && CLIENTS.every(c => matrix.clients.includes(c)),
  `${MATRIX}: clients must be exactly ${CLIENTS.join(", ")}`
);
check(Array.isArray(matrix.features) && matrix.features.length > 0, `${MATRIX}: features must be a non-empty array`);
check(Array.isArray(matrix.non_goals) && matrix.non_goals.length > 0, `${MATRIX}: non_goals must be a non-empty array`);

const specDecisions = new Set(spec.match(/\bD[0-9]{1,3}\b/g) ?? []);

const seen = new Set();
for (const feature of matrix.features ?? []) {
  const label = feature.id ?? "<missing id>";
  check(typeof feature.id === "string" && KEBAB.test(feature.id), `${label}: id must be kebab-case`);
  check(!seen.has(feature.id), `${label}: duplicate feature id`);
  seen.add(feature.id);

  check(typeof feature.name === "string" && feature.name.length > 10, `${label}: name must be descriptive`);
  check(DECISION.test(feature.decision ?? ""), `${label}: decision must look like D12`);
  check(specDecisions.has(feature.decision), `${label}: decision ${feature.decision} is not referenced in ${SPEC}`);
  check(Number.isInteger(feature.phase) && feature.phase >= 0 && feature.phase <= 3, `${label}: phase must be 0-3`);

  for (const client of CLIENTS) {
    const entry = feature[client];
    check(entry && typeof entry === "object", `${label}: missing entry for client "${client}"`);
    if (!entry) continue;
    check(STATUSES.has(entry.status), `${label}/${client}: unknown status "${entry.status}"`);

    if (entry.status === "shipped") {
      const test = entry.owner_test;
      check(
        typeof test === "string" && test.trim().length > 0 && !/shared with web/i.test(test),
        `${label}/${client}: shipped requires a concrete owner_test`
      );
    }
    if (entry.status === "n/a") {
      check(typeof entry.waiver === "string" && entry.waiver.length > 20, `${label}/${client}: n/a requires waiver text explaining why`);
      check(Number.isInteger(entry.phase), `${label}/${client}: n/a requires a phase by which it resolves`);
    }
    if (entry.status === "waived") {
      check(typeof entry.waiver === "string" && entry.waiver.length > 20, `${label}/${client}: waived requires waiver text`);
    }

    // Rule 6 — the drift gate.
    if (feature.web?.status === "shipped" && client !== "web") {
      check(
        entry.status === "shipped" || entry.status === "waived",
        `${label}/${client}: web is shipped but ${client} is "${entry.status}" — ship it or waive it, do not let it drift`
      );
    }
  }

  // Rule 9 — desktop is the same bundle as web, so the statuses must agree.
  check(
    feature.desktop?.status === feature.web?.status,
    `${label}/desktop: desktop is the web bundle over workpulse:// and must match web ("${feature.web?.status}"), not be "${feature.desktop?.status}"`
  );
}

for (const goal of matrix.non_goals ?? []) {
  check(typeof goal.id === "string" && KEBAB.test(goal.id), `non_goals/${goal.id ?? "?"}: id must be kebab-case`);
  check(!seen.has(goal.id), `non_goals/${goal.id}: id collides with a feature`);
  check(typeof goal.rationale === "string" && goal.rationale.length > 20, `non_goals/${goal.id}: rationale required`);
}

if (fail.length > 0) {
  console.error(`tasks-parity: ${fail.length} violation(s)`);
  for (const message of fail) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(
  `tasks-parity: ok — ${matrix.features.length} features across ${CLIENTS.length} clients, ` +
  `${matrix.non_goals.length} explicit non-goals, ${specDecisions.size} decisions referenced`
);
