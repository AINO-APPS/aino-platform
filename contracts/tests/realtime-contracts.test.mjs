import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { validateJsonSchema } from "../../scripts/lib/json-schema-lite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const load = relative => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const validateFixture = relative => {
  const fixturePath = path.join(root, relative);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const schema = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fixturePath), fixture.schema), "utf8"));
  return { fixture, schema, errors: validateJsonSchema(schema, fixture.data) };
};

test("all canonical push fixtures satisfy their declared schemas", () => {
  for (const name of fs.readdirSync(path.join(root, "contracts/fixtures/push"))) {
    const { errors } = validateFixture(`contracts/fixtures/push/${name}`);
    assert.deepEqual(errors, [], `${name}: ${errors.join("; ")}`);
  }
});

test("incoming-call privacy variants are exclusive", () => {
  const { fixture, schema } = validateFixture("contracts/fixtures/push/incoming-call.private.json");
  const leaked = structuredClone(fixture.data);
  leaked.callerName = "Secret Name";
  assert.ok(validateJsonSchema(schema, leaked).length > 0);
});

test("dedupe keys are tied to the payload class", () => {
  const { fixture, schema } = validateFixture("contracts/fixtures/push/chat-message.json");
  const wrong = { ...fixture.data, dedupeKey: `call:${fixture.data.messageId}` };
  assert.ok(validateJsonSchema(schema, wrong).some(error => error.includes("pattern mismatch")));
});

test("general alerts carry a relative deep link (or empty string) only for link-aware devices", () => {
  const { fixture, schema } = validateFixture("contracts/fixtures/push/general-notification.task.json");
  assert.deepEqual(validateJsonSchema(schema, { ...fixture.data, link: "", linkTaskId: "" }), []);
  for (const link of ["https://evil.example/x", "//evil.example/x", "tasks?task=1"]) {
    assert.ok(validateJsonSchema(schema, { ...fixture.data, link }).length > 0, link);
  }
  // Legacy (pushVersion 1) payloads omit both keys: Android <= 0.14.0 rejects unknown keys.
  const { link, linkTaskId, ...legacy } = fixture.data;
  assert.deepEqual(validateJsonSchema(schema, legacy), []);
  assert.ok(validateJsonSchema(schema, { ...fixture.data, linkTaskId: "abc" }).length > 0);
});

test("call teardown reasons are the server-supported action mapping", () => {
  const { fixture, schema } = validateFixture("contracts/fixtures/push/call-cancel.json");
  assert.deepEqual(["accepted", "cancelled", "rejected", "ended", "handled_elsewhere"].filter(reason =>
    validateJsonSchema(schema, { ...fixture.data, reason }).length === 0
  ), ["accepted", "cancelled", "rejected", "ended", "handled_elsewhere"]);
  assert.ok(validateJsonSchema(schema, { ...fixture.data, reason: "declined" }).length > 0);
});
