/**
 * Set the desktop package version in `desktop/package.json` and its lockfile.
 *
 * This lives in a real file rather than inline in `release.ps1`. The previous
 * `node -e "...JSON.stringify(j,null,2)+'\\n'..."` form was escaped for
 * PowerShell, and the doubled backslash reached Node as a literal backslash-n:
 * every release wrote a trailing `}\n` two-character sequence instead of a
 * newline, producing package files that are not valid JSON. `npm ci` and
 * electron-builder both fail on that, so the break would only surface mid-release.
 *
 * Also runs `git -C` from the repository root rather than the current directory,
 * so the version is written to the intended checkout.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error(`Usage: node scripts/set-desktop-version.mjs <major.minor.patch>\nReceived: ${version ?? "<nothing>"}`);
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["desktop/package.json", "desktop/package-lock.json"];

for (const relative of targets) {
  const file = path.join(root, relative);
  const original = fs.readFileSync(file, "utf8");
  const parsed = JSON.parse(original);

  parsed.version = version;
  // npm lockfiles repeat the version on the root package entry; leaving it stale
  // makes `npm ci` fail with EUSAGE on a lock/package mismatch.
  if (parsed.packages?.[""]) parsed.packages[""].version = version;

  // Preserve the file's existing trailing newline convention instead of assuming one.
  const trailing = original.endsWith("\n") ? "\n" : "";
  const updated = `${JSON.stringify(parsed, null, 2)}${trailing}`;

  // Re-parse before writing: a corrupt release file is far more expensive to
  // discover during a signed, tagged build than here.
  JSON.parse(updated);
  fs.writeFileSync(file, updated);
  console.log(`Set ${relative} to ${version}`);
}
