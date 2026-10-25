import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(root, "..");
const SOURCE = path.join(root, "contracts/design/tokens.json");

const run = (script, args = []) => {
  try {
    const stdout = execFileSync(process.execPath, [path.join(root, "scripts", script), ...args], {
      cwd: root,
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

test("token source exists and declares both themes", () => {
  assert.ok(fs.existsSync(SOURCE), "contracts/design/tokens.json must exist");
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  assert.equal(source.version, 1);
  assert.deepEqual(source.themes, ["dark", "light"]);
  assert.ok(Object.keys(source.tokens.color).length > 20, "canonical colour set is expected to be substantial");
  for (const [name, entry] of Object.entries(source.tokens.color)) {
    for (const theme of source.themes) {
      assert.ok(entry[theme], `${name} is missing a ${theme} value`);
    }
  }
});

test("generator is deterministic and reproduces committed files", () => {
  const result = run("generate-tokens.mjs", ["--check"]);
  assert.equal(result.code, 0, result.stderr);
});

test("validator passes against the committed tree", () => {
  const result = run("validate-tokens.mjs");
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /tokens: ok/);
});

test("every generated platform file exists", () => {
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  for (const output of source.outputs) {
    const absolute = path.resolve(repoRoot, output.path);
    // Android and iOS outputs live in sibling repositories, which a
    // single-repo CI checkout does not have. Their absence is "cannot verify",
    // not a missing generated file.
    if (!fs.existsSync(path.dirname(absolute)) && !absolute.startsWith(root)) continue;
    assert.ok(fs.existsSync(absolute), `expected generated file at ${output.path}`);
    assert.ok(fs.statSync(absolute).size > 0, `${output.path} is empty`);
  }
});

test("validator fails when a generated file is edited by hand", () => {
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const cssOutput = source.outputs.find(o => o.path.endsWith(".css"));
  assert.ok(cssOutput, "a CSS output is expected");
  const target = path.resolve(repoRoot, cssOutput.path);
  const original = fs.readFileSync(target, "utf8");
  try {
    fs.writeFileSync(target, original.replace(/#2383e2/i, "#000000"));
    const result = run("validate-tokens.mjs");
    assert.equal(result.code, 1, "validation must fail on hand-edited output");
    assert.match(result.stderr + result.stdout, /drift|out of date/i);
  } finally {
    fs.writeFileSync(target, original);
  }
});

test("validator fails when a token source value drifts from the web client", () => {
  const original = fs.readFileSync(SOURCE, "utf8");
  try {
    const source = JSON.parse(original);
    const key = Object.keys(source.tokens.color)[0];
    assert.ok(key, "the colour group must not be empty");
    source.tokens.color[key].dark = "#000001";
    fs.writeFileSync(SOURCE, JSON.stringify(source, null, 2));
    const result = run("validate-tokens.mjs");
    assert.equal(result.code, 1, "validation must fail when the source disagrees with global.css");
    assert.match(result.stderr + result.stdout, /drift/i);
  } finally {
    fs.writeFileSync(SOURCE, original);
  }
});

test("generated web CSS preserves every value the hand-written stylesheet declares", () => {
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const webOutput = source.outputs.find(o => o.platform === "web");
  const generated = fs.readFileSync(path.resolve(repoRoot, webOutput.path), "utf8");
  const global = fs.readFileSync(path.join(root, "client/src/global.css"), "utf8");

  const declarationsOf = css => {
    const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const out = new Map();
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let match;
    while ((match = re.exec(clean)) !== null) {
      if (!/data-theme=["']?dark["']?/.test(match[1])) continue;
      for (const declaration of match[2].split(";")) {
        const pair = declaration.trim().match(/^(--[a-z0-9-]+)\s*:\s*(.+)$/);
        if (pair) out.set(pair[1], pair[2].trim().toLowerCase().replace(/\s+/g, " "));
      }
    }
    return out;
  };

  const handWritten = declarationsOf(global);
  const emitted = declarationsOf(generated);
  const derived = ["color", "radius", "elevation", "motion"];
  const derivedNames = new Set(derived.flatMap(group => Object.keys(source.tokens[group])));

  // Every derived token the generator emits must already exist in the stylesheet
  // with an identical value: that is what makes "the seed was preserved"
  // checkable. Crafted groups (space, typography, density) have no counterpart in
  // the old stylesheet and are deliberately new.
  for (const [name, value] of emitted) {
    if (!derivedNames.has(name)) continue;
    assert.ok(handWritten.has(name), `generated CSS declares ${name}, which global.css does not define`);
    assert.equal(value, handWritten.get(name), `generated CSS changed the value of ${name}`);
  }

  // And it must not quietly drop a derived group the stylesheet still owns.
  for (const group of derived) {
    const names = Object.keys(source.tokens[group]).filter(n => !n.startsWith("--sig-"));
    for (const name of names) {
      assert.ok(emitted.has(name), `generated CSS dropped ${name} from the ${group} group`);
    }
  }
});

test("no platform file hand-transcribes a canonical colour that disagrees with the source", () => {
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const legacy = path.resolve(repoRoot, source.legacyAndroidTokens);
  // The legacy Android token file lives in a sibling repository. A single-repo
  // CI checkout cannot see it, so there is nothing to compare against.
  if (!fs.existsSync(legacy)) return;
  const text = fs.readFileSync(legacy, "utf8").toUpperCase();
  for (const [name, entry] of Object.entries(source.tokens.color)) {
    const kotlinName = name.replace(/^--/, "").replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    if (!new RegExp(`\\b${kotlinName}\\s*=`).test(text)) continue;
    // Alpha tolerance of 1/255: a stylesheet stores alpha as a fraction while a
    // platform literal must pick an integer, and rounding differs from truncation.
    assert.ok(
      matchesArgb(text, entry.dark),
      `${legacy} disagrees with the token source for ${name}`
    );
  }
});

function matchesArgb(uppercasedFile, value) {
  const { alpha, rgb } = decompose(value);
  for (let a = alpha - 1; a <= alpha + 1; a += 1) {
    if (a < 0 || a > 255) continue;
    if (uppercasedFile.includes(`0X${hex2(a)}${rgb}`)) return true;
  }
  return false;
}

const hex2 = n => n.toString(16).padStart(2, "0").toUpperCase();

function decompose(value) {
  const hex = value.trim();
  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  if (full) {
    return {
      alpha: 255,
      rgb: `${full[1].slice(0, 2)}${full[1].slice(2, 4)}${full[1].slice(4, 6)}`.toUpperCase(),
    };
  }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(hex);
  if (rgba) {
    return {
      alpha: Math.round(Number(rgba[4] ?? 1) * 255),
      rgb: hex2(Number(rgba[1])) + hex2(Number(rgba[2])) + hex2(Number(rgba[3])),
    };
  }
  throw new Error(`unsupported colour value: ${value}`);
}
