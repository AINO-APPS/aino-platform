import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts/validate-tasks-parity.mjs");
const matrixPath = path.join(root, "contracts/tasks-parity.json");

const run = () => {
  try {
    const stdout = execFileSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
};

const withMatrix = mutate => {
  const original = fs.readFileSync(matrixPath, "utf8");
  const matrix = JSON.parse(original);
  mutate(matrix);
  fs.writeFileSync(matrixPath, JSON.stringify(matrix, null, 2));
  try {
    return run();
  } finally {
    fs.writeFileSync(matrixPath, original);
  }
};

test("committed matrix is valid", () => {
  const result = run();
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /tasks-parity: ok/);
});

test("rejects a client silently drifting when web is shipped", () => {
  const result = withMatrix(matrix => {
    const feature = matrix.features[0];
    feature.web = { status: "shipped", owner_test: "contracts/tests/tasks-parity.test.mjs" };
    feature.desktop = { status: "shipped", owner_test: "contracts/tests/tasks-parity.test.mjs" };
    feature.android = { status: "planned" };
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /do not let it drift/);
});

test("accepts a client explicitly waived while web ships", () => {
  const result = withMatrix(matrix => {
    const feature = matrix.features[0];
    feature.web = { status: "shipped", owner_test: "contracts/tests/tasks-parity.test.mjs" };
    feature.desktop = { status: "shipped", owner_test: "contracts/tests/tasks-parity.test.mjs" };
    feature.android = { status: "waived", waiver: "Native Compose implementation covers this behaviour elsewhere." };
    feature.ios = { status: "waived", waiver: "Scoped webview shares the web implementation by construction." };
  });
  assert.equal(result.code, 0, result.stderr);
});

test("rejects shipping without a concrete owning test", () => {
  const result = withMatrix(matrix => {
    matrix.features[0].web = { status: "shipped", owner_test: "shared with web" };
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /concrete owner_test/);
});

test("rejects desktop diverging from web", () => {
  const result = withMatrix(matrix => {
    matrix.features[0].web = { status: "shipped", owner_test: "contracts/tests/tasks-parity.test.mjs" };
    matrix.features[0].desktop = { status: "planned", owner_test: "contracts/tests/tasks-parity.test.mjs" };
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /must match web/);
});

test("rejects a decision id that the spec does not reference", () => {
  const result = withMatrix(matrix => {
    matrix.features[0].decision = "D999";
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /not referenced in docs\/TASKS_DESIGN_SPEC\.md/);
});

test("rejects n/a without a waiver and phase", () => {
  const result = withMatrix(matrix => {
    matrix.features[0].ios = { status: "n/a" };
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /n\/a requires waiver text/);
  assert.match(result.stderr, /n\/a requires a phase/);
});

test("rejects duplicate feature ids", () => {
  const result = withMatrix(matrix => {
    matrix.features.push({ ...matrix.features[0] });
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /duplicate feature id/);
});

test("rejects a shipped feature whose owning test does not exist", () => {
  const result = withMatrix(matrix => {
    matrix.features[0].web = { status: "shipped", owner_test: "e2e/tasks/does-not-exist.spec.ts" };
    matrix.features[0].desktop = { status: "shipped", owner_test: "e2e/tasks/does-not-exist.spec.ts" };
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /does not exist/);
});

test("accepts a shipped feature whose owning test exists", () => {
  const result = withMatrix(matrix => {
    const owner = "contracts/tests/tasks-parity.test.mjs";
    matrix.features[0].web = { status: "shipped", owner_test: owner };
    matrix.features[0].desktop = { status: "shipped", owner_test: owner };
    // Android's owning test lives in a sibling repository. When that repo is
    // not checked out (single-repo CI) the path cannot be verified, so the
    // gate must not fail on it — use a waived entry to keep this test about
    // the web/desktop rule.
    matrix.features[0].android = { status: "waived", waiver: "Native Compose implementation covers this behaviour elsewhere." };
    matrix.features[0].ios = { status: "waived", waiver: "Scoped webview shares the web implementation by construction." };
  });
  assert.equal(result.code, 0, result.stderr);
});

test("a sibling client's owner_test is only checked when that repo is present", () => {
  // The platform repo is checked out alone in CI, so an Android path cannot be
  // resolved. The gate must treat that as "cannot verify", not "missing".
  const androidRepo = path.resolve(root, "..", "aino-android");
  const result = withMatrix(matrix => {
    const owner = "contracts/tests/tasks-parity.test.mjs";
    matrix.features[0].web = { status: "shipped", owner_test: owner };
    matrix.features[0].desktop = { status: "shipped", owner_test: owner };
    matrix.features[0].android = {
      status: "shipped",
      owner_test: "app/src/test/java/app/aino/mobile/feature/tasks/DoesNotExist.kt",
    };
    matrix.features[0].ios = { status: "waived", waiver: "Scoped webview shares the web implementation by construction." };
  });
  if (fs.existsSync(androidRepo)) {
    assert.equal(result.code, 1, "a present sibling repo must be verified");
    assert.match(result.stderr, /does not exist/);
  } else {
    assert.equal(result.code, 0, "an absent sibling repo cannot be verified and must not fail the gate");
  }
});

test("desktop is tracked as the web bundle, never an independent client", () => {
  const matrix = JSON.parse(fs.readFileSync(matrixPath, "utf8"));
  for (const feature of matrix.features) {
    assert.equal(
      feature.desktop.status,
      feature.web.status,
      `${feature.id}: desktop must mirror web`,
    );
  }
});
