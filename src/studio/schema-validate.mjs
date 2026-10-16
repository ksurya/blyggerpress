// Minimal JSON Schema 2020-12 validator covering the keyword subset used by
// contracts/schemas/*.json. Zero dependencies. Supports local and cross-file
// $ref (resolved by $id), boolean schemas, and the keywords exercised below.
// Not a general-purpose validator; do not use it outside this repository.

const KNOWN_IGNORED = new Set([
  "$schema", "$id", "title", "description", "default", "examples", "$comment",
  "deprecated", "readOnly", "writeOnly", "format", "contentMediaType",
]);

export function createRegistry(schemas) {
  const byId = new Map();
  for (const { id, schema } of schemas) byId.set(id, schema);
  return byId;
}

function resolveRef(ref, registry, root) {
  if (ref.startsWith("#")) return { schema: pointer(root, ref.slice(1)), root };
  const hash = ref.indexOf("#");
  const base = hash === -1 ? ref : ref.slice(0, hash);
  const frag = hash === -1 ? "" : ref.slice(hash + 1);
  const target = registry.get(base);
  if (target === undefined) throw new Error(`unresolved $ref base: ${base}`);
  return { schema: frag ? pointer(target, frag) : target, root: target };
}

function pointer(obj, ptr) {
  if (!ptr || ptr === "/") return obj;
  const parts = ptr.replace(/^\//, "").split("/").map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur = obj;
  for (const part of parts) {
    if (cur === undefined || cur === null) throw new Error(`bad JSON pointer: ${ptr}`);
    cur = cur[part];
  }
  return cur;
}

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function typeMatches(v, t) {
  switch (t) {
    case "object": return v !== null && typeof v === "object" && !Array.isArray(v);
    case "array": return Array.isArray(v);
    case "integer": return Number.isInteger(v);
    case "number": return typeof v === "number";
    case "string": return typeof v === "string";
    case "boolean": return typeof v === "boolean";
    case "null": return v === null;
    default: return false;
  }
}

export function validate(instance, schema, { registry = new Map(), root = schema, path = "$" } = {}) {
  const errors = [];
  check(instance, schema, { registry, root, path }, errors);
  return { valid: errors.length === 0, errors };
}

function fail(errors, path, message) {
  errors.push({ path, message });
}

function check(instance, schema, ctx, errors) {
  const { path } = ctx;
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    fail(errors, path, "no value is allowed here");
    return;
  }
  if (typeof schema !== "object") return;

  if (schema.$ref) {
    const { schema: target, root } = resolveRef(schema.$ref, ctx.registry, ctx.root);
    check(instance, target, { registry: ctx.registry, root, path }, errors);
    return;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatches(instance, t))) {
      fail(errors, path, `expected type ${types.join("|")}, got ${typeOf(instance)}`);
      return;
    }
  }

  if (schema.enum !== undefined && !schema.enum.some((e) => deepEq(e, instance))) {
    fail(errors, path, `value ${JSON.stringify(instance)} not in enum`);
  }
  if (schema.const !== undefined && !deepEq(schema.const, instance)) {
    fail(errors, path, `value ${JSON.stringify(instance)} !== const ${JSON.stringify(schema.const)}`);
  }

  if (typeof instance === "string") {
    if (schema.minLength !== undefined && instance.length < schema.minLength) fail(errors, path, `shorter than minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && instance.length > schema.maxLength) fail(errors, path, `longer than maxLength ${schema.maxLength}`);
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(instance)) fail(errors, path, `does not match pattern ${schema.pattern}`);
  }

  if (typeof instance === "number") {
    if (schema.minimum !== undefined && instance < schema.minimum) fail(errors, path, `below minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && instance > schema.maximum) fail(errors, path, `above maximum ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && instance <= schema.exclusiveMinimum) fail(errors, path, `not above exclusiveMinimum ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && instance >= schema.exclusiveMaximum) fail(errors, path, `not below exclusiveMaximum ${schema.exclusiveMaximum}`);
    if (schema.multipleOf !== undefined && instance % schema.multipleOf !== 0) fail(errors, path, `not a multiple of ${schema.multipleOf}`);
  }

  if (Array.isArray(instance)) {
    if (schema.minItems !== undefined && instance.length < schema.minItems) fail(errors, path, `fewer than minItems ${schema.minItems}`);
    if (schema.maxItems !== undefined && instance.length > schema.maxItems) fail(errors, path, `more than maxItems ${schema.maxItems}`);
    if (schema.uniqueItems) {
      const seen = instance.map((v) => JSON.stringify(v));
      if (new Set(seen).size !== seen.length) fail(errors, path, "array items are not unique");
    }
    if (schema.items !== undefined) {
      instance.forEach((v, i) => check(v, schema.items, { ...ctx, path: `${path}[${i}]` }, errors));
    }
  }

  if (instance !== null && typeof instance === "object" && !Array.isArray(instance)) {
    if (schema.required !== undefined) {
      for (const key of schema.required) {
        if (!(key in instance)) fail(errors, path, `missing required property "${key}"`);
      }
    }
    const props = schema.properties ?? {};
    for (const [key, subschema] of Object.entries(props)) {
      if (key in instance) check(instance[key], subschema, { ...ctx, path: `${path}.${key}` }, errors);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(instance)) {
        if (!(key in props)) fail(errors, path, `unexpected property "${key}"`);
      }
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const key of Object.keys(instance)) {
        if (!(key in props)) check(instance[key], schema.additionalProperties, { ...ctx, path: `${path}.${key}` }, errors);
      }
    }
  }

  if (schema.allOf) for (const s of schema.allOf) check(instance, s, ctx, errors);
  if (schema.anyOf) {
    const ok = schema.anyOf.some((s) => validate(instance, s, { registry: ctx.registry, root: ctx.root, path }).valid);
    if (!ok) fail(errors, path, "does not match anyOf");
  }
  if (schema.oneOf) {
    const count = schema.oneOf.filter((s) => validate(instance, s, { registry: ctx.registry, root: ctx.root, path }).valid).length;
    if (count !== 1) fail(errors, path, `matches ${count} of oneOf (expected exactly 1)`);
  }
  if (schema.not) {
    if (validate(instance, schema.not, { registry: ctx.registry, root: ctx.root, path }).valid) {
      fail(errors, path, "matches 'not' schema");
    }
  }
  if (schema.if) {
    const cond = validate(instance, schema.if, { registry: ctx.registry, root: ctx.root, path }).valid;
    const branch = cond ? schema.then : schema.else;
    if (branch) check(instance, branch, ctx, errors);
  }
}

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEq(a[k], b[k]));
  }
  return false;
}
