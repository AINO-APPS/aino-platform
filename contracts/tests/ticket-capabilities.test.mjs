import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const api = JSON.parse(fs.readFileSync(path.join(root, "contracts/openapi.json"), "utf8"));
const fixture = JSON.parse(fs.readFileSync(
  path.join(root, "contracts/fixtures/ticket-with-capabilities.json"),
  "utf8",
));

function assertMatchesSchema(schema, value, pathName) {
  if (schema.$ref) {
    const resolved = schema.$ref.slice(2).split("/").reduce((current, part) => current[part], api);
    return assertMatchesSchema(resolved, value, pathName);
  }

  if (schema.enum) assert.ok(schema.enum.includes(value), `${pathName} is outside its enum`);
  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actualType = value === null ? "null"
    : Array.isArray(value) ? "array"
      : typeof value === "number" && Number.isInteger(value) ? "integer"
        : typeof value;
  assert.ok(allowedTypes.includes(actualType) || (actualType === "integer" && allowedTypes.includes("number")),
    `${pathName} has type ${actualType}, expected ${allowedTypes.join(" or ")}`);

  if (actualType === "object") {
    for (const required of schema.required || []) {
      assert.ok(Object.hasOwn(value, required), `${pathName}.${required} is required`);
    }
    const properties = schema.properties || {};
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(properties, key)) {
        assert.notEqual(schema.additionalProperties, false, `${pathName}.${key} is not allowed`);
      } else {
        assertMatchesSchema(properties[key], child, `${pathName}.${key}`);
      }
    }
  } else if (actualType === "array" && schema.items) {
    value.forEach((item, index) => assertMatchesSchema(schema.items, item, `${pathName}[${index}]`));
  }
}

test("shared ticket fixture conforms to the OpenAPI Task schema", () => {
  assertMatchesSchema(api.components.schemas.Task, fixture, "ticket");
});
