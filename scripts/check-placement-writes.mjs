/**
 * Placement has one writer (ADR-015, amended 2026-11-01).
 *
 * Only `server/modules/tasks/tasks.placementRepository.ts` may assign a
 * ticket's `sprint_id`, `planned_date` or `pre_sprint_due_date`, or use the
 * legacy `LEAVE_SPRINT` / `REMEMBER_DUE_DATE` fragments. Every other site goes
 * through `tasks.placement.ts`, so the due-date rule, the freeze, history,
 * audit and realtime cannot drift between routes.
 *
 * Existing writers are pinned per file and may only shrink as
 * `.scratch/ticket-placement` issues 03–07 move them; a new file gets 0.
 * INSERTs that name `sprint_id` / `planned_date` count too: a ticket created
 * straight into a container is a placement.
 */
import fs from "node:fs";
import path from "node:path";

const serverRoot = path.resolve("server");
const OWNER = "modules/tasks/tasks.placementRepository.ts";
const RATCHET_FILE = path.resolve("scripts/placement-writes-baseline.json");

// Assignment shape only (`SET col =` or `, col =`), so reads such as
// `WHERE sprint_id = $1` and `t.sprint_id = s.id` joins are not counted.
const WRITES = [
  /(?:\bSET\b|,)\s*(?:sprint_id|planned_date|pre_sprint_due_date)\s*=(?!=)/i,
  /\bINSERT\s+INTO\s+tasks\b[^;`]*?\b(?:sprint_id|planned_date)\b/i,
  /\b(?:LEAVE_SPRINT|REMEMBER_DUE_DATE)\b/,
];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "__tests__", "migrations"].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Count placement writes, joining each statement's lines so multi-line SQL is seen. */
function countWrites(file) {
  const code = fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  let count = 0;
  for (const re of WRITES) count += (code.match(new RegExp(re.source, re.flags + "g")) || []).length;
  return count;
}

const current = {};
for (const file of walk(serverRoot)) {
  if (!file.endsWith(".ts") || file.endsWith(".d.ts")) continue;
  const rel = path.relative(serverRoot, file).replace(/\\/g, "/");
  if (rel === OWNER) continue;
  const count = countWrites(file);
  if (count > 0) current[rel] = count;
}

if (process.argv.includes("--update")) {
  fs.writeFileSync(RATCHET_FILE, `${JSON.stringify(current, null, 2)}\n`);
  console.log(`Baseline written: ${Object.keys(current).length} files still write placement columns.`);
  process.exit(0);
}

const baseline = fs.existsSync(RATCHET_FILE) ? JSON.parse(fs.readFileSync(RATCHET_FILE, "utf8")) : {};
const failures = [];
for (const [rel, count] of Object.entries(current)) {
  const ceiling = baseline[rel];
  if (ceiling === undefined) {
    failures.push(`${rel}: ${count} placement write(s) in a NEW site — call placeTickets / transferTicket instead.`);
  } else if (count > ceiling) {
    failures.push(`${rel}: placement writes grew ${ceiling} -> ${count}. The ratchet may only shrink.`);
  }
}
const stale = Object.keys(baseline).filter((rel) => (current[rel] ?? 0) < baseline[rel]);

if (failures.length) {
  console.error(
    "Placement-writes guard failed (ADR-015: one writer for sprint / planned day / due-date bookkeeping):\n" +
    failures.map((f) => `  ${f}`).join("\n") +
    `\n\nUse server/modules/tasks/tasks.placement.ts. If you REMOVED writes, re-pin with:\n` +
    "  node scripts/check-placement-writes.mjs --update",
  );
  process.exit(1);
}
if (stale.length) {
  console.error(
    "Placement-writes guard: these files shrank — lower the baseline so it cannot grow back:\n" +
    stale.map((rel) => `  ${rel}: ${baseline[rel]} -> ${current[rel] ?? 0}`).join("\n") +
    "\n\n  node scripts/check-placement-writes.mjs --update",
  );
  process.exit(1);
}

const total = Object.values(current).reduce((a, b) => a + b, 0);
console.log(`Placement-writes guard passed: ${total} legacy write(s) across ${Object.keys(current).length} files remain to migrate.`);
