export function validateJsonSchema(schema, value, root = schema, at = "$", errors = []) {
  if (schema.$ref) {
    if (!schema.$ref.startsWith("#/")) return errors.concat(`${at}: unsupported external $ref ${schema.$ref}`);
    const target = schema.$ref.slice(2).split("/").reduce((v, key) => v?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], root);
    return target ? validateJsonSchema(target, value, root, at, errors) : errors.concat(`${at}: unresolved ${schema.$ref}`);
  }
  if (schema.allOf) for (const child of schema.allOf) validateJsonSchema(child, value, root, at, errors);
  if (schema.oneOf) {
    const matches = schema.oneOf.filter(child => validateJsonSchema(child, value, root, at, []).length === 0).length;
    if (matches !== 1) errors.push(`${at}: expected exactly one oneOf match, got ${matches}`);
  }
  if (schema.anyOf) {
    const matches = schema.anyOf.filter(child => validateJsonSchema(child, value, root, at, []).length === 0).length;
    if (matches === 0) errors.push(`${at}: expected an anyOf match`);
  }
  if (schema.not && validateJsonSchema(schema.not, value, root, at, []).length === 0) errors.push(`${at}: matched forbidden schema`);
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: not in enum`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    if (!types.includes(actual) && !(actual === "integer" && types.includes("number"))) {
      errors.push(`${at}: expected ${types.join("|")}, got ${actual}`);
      return errors;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: shorter than ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${at}: longer than ${schema.maxLength}`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${at}: pattern mismatch`);
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${at}: invalid date-time`);
  }
  if (typeof value === "number" && schema.minimum != null && value < schema.minimum) errors.push(`${at}: below minimum`);
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => validateJsonSchema(schema.items, item, root, `${at}[${i}]`, errors));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}: missing ${key}`);
    for (const [key, child] of Object.entries(schema.properties || {})) if (key in value) validateJsonSchema(child, value[key], root, `${at}.${key}`, errors);
    if (schema.additionalProperties === false) {
      const known = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) if (!known.has(key)) errors.push(`${at}: unexpected ${key}`);
    }
  }
  return errors;
}
