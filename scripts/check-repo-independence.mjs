/**
 * MIG-0904: keep this repository free of operational coupling to the legacy
 * `vvronline/WorkPulse` monorepo it was split out of.
 *
 * The split is complete at the source level, but release plumbing is easy to
 * regress: a copied workflow, a restored electron-builder block or a pasted
 * absolute path silently re-points published artifacts (or an installed app's
 * update feed) at a repository this project no longer controls. That failure is
 * invisible in tests and only surfaces when users stop receiving updates, so it
 * is enforced statically here instead.
 *
 * Scope is tracked, non-documentation source. Markdown keeps its historical
 * provenance references on purpose: `contracts/mobile-route-map.json` is derived
 * from the legacy history and must stay traceable to it.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const forbidden = [
  {
    pattern: /vvronline\/WorkPulse/i,
    message: "legacy repository slug",
  },
  {
    // Release ownership, not the bootstrap operator account. Matches the
    // electron-builder `owner:` key and JS/TS owner constants.
    pattern: /(?:^|[^\w-])(?:owner|GITHUB_OWNER)\s*[:=]\s*["']?vvronline["']?/im,
    message: "legacy release owner",
  },
  {
    pattern: /D:\\+Learnings\\+WorkPulse(?!-Split)/i,
    message: "absolute path into the legacy checkout",
  },
];

/**
 * `vvronline` is also the bootstrap platform-administrator username (DECISIONS.md
 * item 2 and 5). Those occurrences are legitimate and must not be rewritten, so
 * the owner rule above is deliberately narrow rather than allow-listing files.
 */
const skipped = /^(?:docs|specs|\.specify|\.github\/agents)\/|(?:^|\/)(?:package-lock\.json|check-repo-independence\.mjs)$|\.md$/;

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => !skipped.test(file));

const failures = [];
for (const file of tracked) {
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    continue; // Binary or unreadable entries carry no references.
  }
  if (source.includes("\0")) continue;
  for (const { pattern, message } of forbidden) {
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (pattern.test(line)) failures.push(`${file}:${index + 1}: ${message} -> ${line.trim()}`);
    });
  }
}

if (failures.length) {
  console.error(
    `Repository independence guard failed:\n${failures.map((failure) => `  ${failure}`).join("\n")}\n\n` +
      "This repository must not reference vvronline/WorkPulse. Use AINO-APPS/aino-platform.",
  );
  process.exit(1);
}
console.log(`Repository independence guard passed (${tracked.length} tracked files checked).`);
