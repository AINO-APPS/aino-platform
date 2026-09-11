import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateJsonSchema } from "./lib/json-schema-lite.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const json = file => JSON.parse(read(file));
const fail = [];
const check = (condition, message) => { if (!condition) fail.push(message); };

const fixtureDir = path.join(root, "contracts/fixtures/push");
for (const name of fs.readdirSync(fixtureDir).filter(x => x.endsWith(".json")).sort()) {
  const fixturePath = path.join(fixtureDir, name);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const schemaPath = path.resolve(path.dirname(fixturePath), fixture.schema);
  check(schemaPath.startsWith(path.join(root, "contracts", "schemas")), `${name}: schema escapes contracts/schemas`);
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const errors = validateJsonSchema(schema, fixture.data);
  check(errors.length === 0, `${name}: ${errors.join("; ")}`);
}

const asyncapi = read("contracts/asyncapi/aino-realtime.yaml");
for (const marker of ["asyncapi: 2.6.0", "url: aino.org.in/ws", "cookieToken:", "queryToken:", "subprotocolToken:", "ChatMessageCommand:", "CallInitiateCommand:", "CallCancelCommand:"]) {
  check(asyncapi.includes(marker), `AsyncAPI missing ${marker}`);
}
const ws = [
  "server/utils/ws.ts",
  "server/realtime/auth.ts",
  "server/realtime/messageRouter.ts",
  "server/realtime/fanout.ts",
].map(read).join("\n");
for (const marker of ['path: "/ws"', "cookies[TENANT_COOKIE]", 'searchParams.get("token")', 'headers["sec-websocket-protocol"]', 'ws.close(4001', 'ws.close(4003', 'ws.close(4029', 'JSON.stringify({ type, data })']) {
  check(ws.includes(marker), `documented WS behavior absent from server: ${marker}`);
}
for (const type of ["chat_message", "call_initiate", "call_accept", "call_cancel", "call_reject", "call_end"]) {
  check(ws.includes(`case "${type}"`), `documented inbound type absent from dispatcher: ${type}`);
  check(asyncapi.includes(`const: ${type}`), `dispatcher type absent from AsyncAPI: ${type}`);
}
const call = [
  "server/utils/wsHandlers/call.ts",
  "server/utils/wsHandlers/callLifecycle.ts",
  "server/utils/wsHandlers/callTermination.ts",
  "server/utils/wsHandlers/callSignaling.ts",
].map(read).join("\n");
for (const [wire, action] of [["call_accept", "answer"], ["call_reject", "reject"], ["call_end", "end"]]) {
  check(call.includes(`action: "${action}"`), `${wire} idempotency action mapping missing: ${action}`);
}
check(call.includes('type: "call_initiate"'), "call_initiate idempotency mapping missing");
check(call.includes('type: "call_cancel"'), "call_cancel idempotency mapping missing");
const push = read("server/services/pushNotifications.ts");
for (const marker of ['type: "incoming_call"', 'type: "call_handled_elsewhere"', 'type: "chat_message"', 'dedupeKey: `call:', 'dedupeKey: `call_cancel:', 'dedupeKey: `msg:', 'dedupeKey: `notif:', "hideSensitiveContent ? {}"])
  check(push.includes(marker), `documented push behavior absent from service: ${marker}`);

if (fail.length) {
  console.error(`Realtime contract validation failed (${fail.length}):\n- ${fail.join("\n- ")}`);
  process.exit(1);
}
console.log(`Realtime contracts valid: ${fs.readdirSync(fixtureDir).filter(x => x.endsWith(".json")).length} canonical push fixtures and baseline WS source mappings.`);
