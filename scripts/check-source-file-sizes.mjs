import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "build", "coverage"].includes(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function checkSourceFileSizes({ label, root, baselineFile, limit = 600, recursive = true }) {
  const absoluteRoot = path.resolve(root);
  const baseline = JSON.parse(fs.readFileSync(path.resolve(baselineFile), "utf8"));
  const files = (recursive ? walk(absoluteRoot) : fs.readdirSync(absoluteRoot).map((name) => path.join(absoluteRoot, name)))
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/[\\/](?:__tests__)[\\/]/.test(file))
    .filter((file) => !/\.(?:test|spec)\.(?:ts|tsx)$/.test(file));
  const failures = [];

  for (const file of files) {
    const rel = path.relative(absoluteRoot, file).replace(/\\/g, "/");
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
    const ceiling = baseline[rel] ?? limit;
    if (lines > ceiling) failures.push(`${rel}: ${lines} lines (ceiling ${ceiling})`);
    if (baseline[rel] !== undefined && lines < ceiling) {
      failures.push(`${rel}: shrank to ${lines} lines; lower its exact baseline from ${ceiling}`);
    }
  }

  for (const rel of Object.keys(baseline)) {
    if (!fs.existsSync(path.join(absoluteRoot, rel))) {
      failures.push(`${rel}: stale baseline entry; remove it after the file move/delete`);
    }
  }

  if (failures.length) {
    console.error(`${label} file-size ratchet failed:\n${failures.map((failure) => `  ${failure}`).join("\n")}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${label} file-size ratchet passed (${limit}-line limit; ${Object.keys(baseline).length} legacy exceptions).`);
}

export { checkSourceFileSizes };