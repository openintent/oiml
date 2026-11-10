import type { Field, Shape, ShapeKey, Validate } from "./model.js";

/** What a key of a shape may be: a value JSON holds as it is written, nothing a column would store another way */
export const SHAPE_KEY_TYPES = [
  "string",
  "text",
  "integer",
  "float",
  "boolean",
  "date",
  "datetime",
  "uuid",
  "enum",
  "array",
  "json"
] as const;

/** What an array inside a shape may hold */
export const SHAPE_ARRAY_TYPES = ["string", "text", "integer", "float", "boolean", "uuid"] as const;

export type ShapeScalar = "string" | "text" | "integer" | "float" | "boolean" | "date" | "datetime" | "uuid";

/** A key's validation: what a column's carries, with numeric bounds */
export type ShapeValidate = Omit<Validate, "min" | "max"> & { min?: number; max?: number };

/**
 * One key of a typed JSON value, resolved. A key is there with a value of its kind or it is not there: null is
 * no value of a key. A key with a default is written with it when the writer leaves the key out.
 */
export interface ShapeKeyIR {
  name: string;
  kind: ShapeScalar | "enum" | "array" | "object";
  required: boolean;
  default?: string | number | boolean;
  /** The values of an enum key */
  values?: string[];
  /** What an array key holds */
  of?: ShapeScalar;
  /** A string key's longest value: 255 unless the key says otherwise, as for a column */
  maxLength?: number;
  validate?: ShapeValidate;
  /** The keys of an object key: one nested level */
  keys?: ShapeKeyIR[];
  description?: string;
}

/** A shape per value of an enum column of the same entity, in the enum's declared order */
export interface ShapeByIR {
  column: string;
  shapes: { value: string; keys: ShapeKeyIR[] }[];
}

/** The options of a field a key of a shape cannot carry, each with the reason the refusal gives */
const REFUSED_OPTIONS: [keyof ShapeKey, string][] = [
  ["primary", "a key is not a column: it has no primary key"],
  ["unique", "a key is not a column: the database holds no constraint on it"],
  ["hidden", "the value is returned whole or not at all: hide the field"],
  ["read_only", "the value is written whole: mark the field read_only"],
  [
    "read",
    "a rule per key is not offered: read: on the field decides who reads the whole value, and a key that needs its own readers is a field of its own"
  ],
  ["relation", "a key cannot point at a row: no foreign key holds it; keep the relation in a field of its own"],
  ["file", "a file is a field of its own"],
  ["sealed", "a sealed value is a field of its own: the whole column is ciphertext or none of it is"],
  ["ranked", "ranked belongs to a membership's role field"],
  ["position", "a position is a field the database numbers"],
  ["count_of", "a count is a field the database keeps"],
  ["where", "where belongs to a count_of field"],
  ["currency", "an amount is a field of its own (type: money), where numeric(19, 4) keeps it exact"],
  ["currency_field", "an amount is a field of its own (type: money), where numeric(19, 4) keeps it exact"],
  ["prefix", "a sequence is a field the database numbers"],
  ["scope", "a sequence is a field the database numbers"],
  ["width", "a sequence is a field the database numbers"],
  ["shape_by", "a shape per enum value is declared on the field, beside the enum it follows"]
];

/** Why a type cannot be a key of a shape */
function typeProblem(type: string): string | undefined {
  if ((SHAPE_KEY_TYPES as readonly string[]).includes(type)) return undefined;
  switch (type) {
    case "money":
      return "an amount is a field of its own (type: money), where numeric(19, 4) keeps it exact; a JSON value would hold it as a string nothing types";
    case "sequence":
      return "a sequence is a field the database numbers";
    case "file":
      return "a file is a field of its own";
    case "bytes":
      return "JSON holds no bytes";
    case "bigint":
    case "decimal":
      return `a JSON number is a float, which cannot hold every ${type}; use integer, float or a string`;
    default:
      return `use one of ${SHAPE_KEY_TYPES.join(", ")}`;
  }
}

export interface ShapeProblem {
  /** The key, dotted from the shape's root (`quiet_hours.from`) */
  path: string;
  message: string;
}

/** What is wrong with a shape as declared: each key it cannot have as written. Empty when the shape stands. */
export function shapeProblems(shape: Shape, nested = false): ShapeProblem[] {
  const out: ShapeProblem[] = [];
  for (const [name, key] of Object.entries(shape)) {
    const say = (message: string) => out.push({ path: name, message });
    const wrongType = typeProblem(key.type);
    if (wrongType) {
      say(`cannot be a ${key.type}: ${wrongType}`);
      continue;
    }
    for (const [option, reason] of REFUSED_OPTIONS)
      if (key[option] !== undefined) say(`cannot carry ${option}: ${reason}`);
    if (key.type === "enum" && !key.enum_values) say("is an enum and needs enum_values");
    if (key.type !== "enum" && key.enum_values) say("carries enum_values and is not an enum");
    if (key.type === "array") {
      if (!key.array_type) say("is an array and needs array_type");
      else if (!(SHAPE_ARRAY_TYPES as readonly string[]).includes(key.array_type))
        say(`cannot be an array of ${key.array_type}; an array inside a shape holds ${SHAPE_ARRAY_TYPES.join(", ")}`);
      if (key.shape !== undefined)
        say(
          "cannot be an array of shapes: a list of objects is the rows of an entity of its own, with a relation and a position"
        );
    } else if (key.array_type) say("carries array_type and is not an array");
    if (key.type === "json") {
      if (nested) say("is a shape inside a nested shape; a shape nests one level");
      else if (key.shape === undefined || typeof key.shape !== "object" || key.shape === null)
        say("is a json key and needs a shape of its own; a key that may hold anything is a json field without a shape");
      else
        for (const inner of shapeProblems(key.shape as Shape, true))
          out.push({ path: `${name}.${inner.path}`, message: inner.message });
      if (key.default !== undefined) say("is a nested shape and takes no default: give its keys theirs");
    } else if (key.shape !== undefined) say("carries a shape and is not a json key");
    if (key.max_length !== undefined && key.type !== "string" && key.type !== "text")
      say("carries max_length and is not a string or text");
    const v = key.validate;
    if (v) {
      const text = key.type === "string" || key.type === "text";
      const stringArray = key.type === "array" && (key.array_type === "string" || key.array_type === "text");
      const number = key.type === "integer" || key.type === "float";
      const numberArray = key.type === "array" && (key.array_type === "integer" || key.array_type === "float");
      if (
        (v.format !== undefined ||
          v.min_length !== undefined ||
          v.max_length !== undefined ||
          v.pattern !== undefined) &&
        !text &&
        !stringArray
      )
        say("validates format, min_length, max_length or pattern, which hold for strings");
      if ((v.min !== undefined || v.max !== undefined) && !number && !numberArray)
        say("validates min or max, which hold for integers and floats");
      if (typeof v.min === "string" || typeof v.max === "string")
        say("validates min or max with a decimal string, which is for a money field");
    }
    if (key.default !== undefined && key.type !== "json") {
      if (key.type === "array") say("is an array and takes no default");
      else if (key.required) say("is required and has a default; a key with a default is never missing: drop required");
      else {
        const wrong = scalarProblem(compileKey(name, key), key.default);
        if (wrong) say(`has a default that does not fit: ${wrong}`);
      }
    }
  }
  return out;
}

function compileKey(name: string, key: ShapeKey): ShapeKeyIR {
  const out: ShapeKeyIR = {
    name,
    kind:
      key.type === "json"
        ? "object"
        : key.type === "enum" || key.type === "array"
          ? key.type
          : (key.type as ShapeScalar),
    required: Boolean(key.required)
  };
  if (key.default !== undefined) out.default = key.default;
  if (key.type === "enum") out.values = key.enum_values ?? [];
  if (key.type === "array") out.of = key.array_type as ShapeScalar;
  if (key.max_length !== undefined) out.maxLength = key.max_length;
  else if (key.type === "string" || (key.type === "array" && key.array_type === "string")) out.maxLength = 255;
  if (key.validate) out.validate = key.validate as ShapeValidate;
  if (key.type === "json") out.keys = compileShape((key.shape ?? {}) as Shape);
  if (key.description) out.description = key.description;
  return out;
}

/** A declared shape as the backends read it: its keys in declared order */
export function compileShape(shape: Shape): ShapeKeyIR[] {
  return Object.entries(shape).map(([name, key]) => compileKey(name, key));
}

/** The shapes of a field with `shape_by`, by enum value, with the enum field's name */
export function shapeByOf(field: Field): { by: string; shapes: Record<string, Shape> } | undefined {
  const entry = Object.entries(field.shape_by ?? {})[0];
  return entry ? { by: entry[0], shapes: entry[1] } : undefined;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function length(value: string): number {
  return [...value].length;
}

/** Why a value is not one of a scalar or enum key's, or undefined when it is */
function scalarProblem(key: ShapeKeyIR, value: unknown, kind: ShapeKeyIR["kind"] = key.kind): string | undefined {
  const v = key.validate ?? {};
  switch (kind) {
    case "string":
    case "text": {
      if (typeof value !== "string") return "must be a string";
      const max = v.max_length ?? key.maxLength;
      if (v.min_length !== undefined && length(value) < v.min_length) return `must be at least ${v.min_length} long`;
      if (max !== undefined && length(value) > max) return `must be at most ${max} long`;
      if (v.pattern !== undefined && !new RegExp(v.pattern).test(value)) return `must match ${v.pattern}`;
      return undefined;
    }
    case "integer":
    case "float": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "must be a number";
      if (kind === "integer" && !Number.isInteger(value)) return "must be an integer";
      if (v.min !== undefined && value < v.min) return `must be at least ${v.min}`;
      if (v.max !== undefined && value > v.max) return `must be at most ${v.max}`;
      return undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? undefined : "must be true or false";
    case "date":
      return typeof value === "string" && DATE.test(value) ? undefined : "must be a date (2026-01-31)";
    case "datetime":
      return typeof value === "string" && DATETIME.test(value)
        ? undefined
        : "must be a date and time with an offset (2026-01-31T09:00:00Z)";
    case "uuid":
      return typeof value === "string" && UUID.test(value) ? undefined : "must be a uuid";
    case "enum":
      return typeof value === "string" && key.values!.includes(value)
        ? undefined
        : `must be one of ${key.values!.join(", ")}`;
    default:
      return undefined;
  }
}

/**
 * Why a value does not fit a shape, with the path of the first key that does not: a wrong type, a required key
 * left out, a key the shape does not name, null where a value belongs. Undefined when it fits. This is the
 * reference the generated validators are held to; they answer 400 where this finds a problem.
 */
export function shapeValueProblem(keys: ShapeKeyIR[], value: unknown, path = ""): ShapeProblem | undefined {
  const at = (name: string) => (path ? `${path}.${name}` : name);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return { path, message: "must be an object" };
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const held = object[key.name];
    if (!(key.name in object) || held === undefined) {
      if (key.required) return { path: at(key.name), message: "is required" };
      continue;
    }
    if (held === null) return { path: at(key.name), message: "must be a value, not null: leave the key out" };
    if (key.kind === "object") {
      const inner = shapeValueProblem(key.keys ?? [], held, at(key.name));
      if (inner) return inner;
    } else if (key.kind === "array") {
      if (!Array.isArray(held)) return { path: at(key.name), message: "must be an array" };
      for (const [i, item] of held.entries()) {
        const wrong = scalarProblem(key, item, key.of);
        if (wrong) return { path: `${at(key.name)}.${i}`, message: wrong };
      }
    } else {
      const wrong = scalarProblem(key, held);
      if (wrong) return { path: at(key.name), message: wrong };
    }
  }
  const unknown = Object.keys(object).find(name => !keys.some(key => key.name === name));
  return unknown === undefined ? undefined : { path: at(unknown), message: "is not a key of the shape" };
}

/** A value as a write stores it: every key with a default that the writer left out, filled in; nested shapes too */
export function withShapeDefaults(keys: ShapeKeyIR[], value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...value };
  for (const key of keys) {
    if (key.kind === "object" && typeof out[key.name] === "object" && out[key.name] !== null)
      out[key.name] = withShapeDefaults(key.keys ?? [], out[key.name] as Record<string, unknown>);
    else if (out[key.name] === undefined && key.default !== undefined) out[key.name] = key.default;
  }
  return out;
}
