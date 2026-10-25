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

test("Android v4 registration uses the actual deviceToken field and retains older versions", () => {
  const schema = load("contracts/openapi.json").components.schemas.DeviceTokenRequest;
  for (const pushVersion of [1, 2, 3, 4]) {
    assert.deepEqual(validateJsonSchema(schema, { deviceToken: "fcm-token", platform: "android", pushVersion }), []);
  }
  assert.deepEqual(validateJsonSchema(schema, { deviceToken: "fcm-token", platform: "android" }), []);
  assert.ok(validateJsonSchema(schema, { token: "obsolete", platform: "android", pushVersion: 4 }).length > 0);
});

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

test("v4 group metadata is optional, string-valued and has bounded strict members", () => {
  const { fixture, schema } = validateFixture("contracts/fixtures/push/chat-message.group-v4.json");
  const { groupAvatar, groupMemberPreviews, ...legacy } = fixture.data;
  assert.deepEqual(validateJsonSchema(schema, legacy), []);
  assert.ok(Buffer.byteLength(JSON.stringify(fixture.data), "utf8") <= 3800);
  assert.ok(Object.values(fixture.data).every(value => typeof value === "string"));
  for (const value of ["bad", "{}", '[{"name":2,"avatar":null}]', '[{"name":"A"}]',
    '[{"name":"A","avatar":null,"extra":"x"}]', JSON.stringify(Array(5).fill({ name: "A", avatar: null }))]) {
    assert.ok(validateJsonSchema(schema, { ...fixture.data, groupMemberPreviews: value }).length > 0, value);
  }
  assert.ok(validateJsonSchema(schema, { ...fixture.data, isGroup: "false" }).length > 0);
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

// ── Task field deltas ───────────────────────────────────────────────────────
// The `task_updated` frame carries only the fields that changed, the actor and
// a timestamp. These assertions pin the payload shape so a client can patch the
// card it already holds instead of replacing the whole object.
const taskUpdatedSchema = () => {
  const yaml = fs.readFileSync(path.join(root, "contracts/asyncapi/aino-realtime.yaml"), "utf8");
  const start = yaml.indexOf("    TaskUpdatedEvent:");
  assert.ok(start > 0, "TaskUpdatedEvent missing from AsyncAPI");
  const block = yaml.slice(start, yaml.indexOf("    AttendanceUpdateEvent:", start));
  const fieldsStart = block.indexOf("                  fields:");
  const fieldsEnd = block.indexOf("                  actor:", fieldsStart);
  const fieldNames = [...block.slice(fieldsStart, fieldsEnd).matchAll(/^ {22}([a-z_]+):/gm)].map(m => m[1]);
  return { block, fieldNames };
};

test("task_updated documents a field-level delta, not a whole object", () => {
  const { block, fieldNames } = taskUpdatedSchema();
  assert.ok(block.includes("fields:"), "delta fields missing");
  assert.ok(block.includes("actor:"), "delta actor missing");
  assert.ok(block.includes("at:"), "delta timestamp missing");
  assert.ok(!/^ {18}task:/m.test(block), "delta must not carry the whole task object");
  assert.ok(fieldNames.length >= 10, `expected the allow-listed fields, got ${fieldNames.join(",")}`);
});

test("the delta field allow-list matches the server module", () => {
  const { fieldNames } = taskUpdatedSchema();
  const source = fs.readFileSync(path.join(root, "server/modules/tasks/tasks.deltas.ts"), "utf8");
  const listStart = source.indexOf("export const DELTA_FIELDS = [");
  const listEnd = source.indexOf("] as const;", listStart);
  const serverFields = [...source.slice(listStart, listEnd).matchAll(/"([a-z_]+)"/g)].map(m => m[1]);
  assert.deepEqual([...fieldNames].sort(), [...serverFields].sort());
});

test("the client mirror of the delta allow-list matches the server", () => {
  const read = file => fs.readFileSync(path.join(root, file), "utf8");
  const extract = source => {
    const start = source.indexOf("export const DELTA_FIELDS = [");
    const end = source.indexOf("] as const;", start);
    return [...source.slice(start, end).matchAll(/"([a-z_]+)"/g)].map(m => m[1]).sort();
  };
  assert.deepEqual(
    extract(read("client/src/pages/tasks/hooks/taskDeltas.ts")),
    extract(read("server/modules/tasks/tasks.deltas.ts")),
  );
});
