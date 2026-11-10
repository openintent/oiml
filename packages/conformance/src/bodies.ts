/**
 * Bodies the walks send: a valid body for a create or an update, built from the columns' types and validation,
 * and the invalid ones the fuzz walk probes with (wrong types, boundary lengths, extra keys, missing fields, bad
 * ids). Values come from a seeded generator so a failure replays.
 */
import {
  shapeValueProblem,
  withShapeDefaults,
  type ColumnIR,
  type EntityIR,
  type IR,
  type ShapeKeyIR
} from "@osl/core";

/** mulberry32: small, seeded, enough for the walks */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(max: number): number {
    return Math.floor(this.next() * max);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  uuid(): string {
    const hex = () => this.int(16).toString(16);
    const part = (n: number) => Array.from({ length: n }, hex).join("");
    return `${part(8)}-${part(4)}-4${part(3)}-${["8", "9", "a", "b"][this.int(4)]}${part(3)}-${part(12)}`;
  }
}

export interface BodyContext {
  ir: IR;
  rng: Rng;
  /** A number that never repeats within a run, for unique values */
  next: () => number;
  /** An existing row's id for a relation to this entity, when the walk has one */
  relatedId: (entity: string, column: ColumnIR) => unknown;
}

/** The enum values a column stores, from the IR's enums or the column's own list */
export function enumValues(ir: IR, column: ColumnIR): string[] {
  const type = column.type;
  if (type.kind === "enum") return ir.enums.find(e => e.name === type.name)?.values ?? [];
  return column.enumValues ?? [];
}

/** A value that satisfies the column's type and validation, or undefined when the walk cannot make one */
export function validValue(column: ColumnIR, ctx: BodyContext): unknown {
  const n = ctx.next();
  const v = column.validate ?? {};
  if (column.enumValues?.length) return column.enumValues[0];
  switch (column.type.kind) {
    case "enum":
      return enumValues(ctx.ir, column)[0];
    case "array":
      return [];
    case "file":
      return undefined;
    case "scalar":
      break;
  }
  switch (column.type.scalar) {
    case "string": {
      if (v.format === "email") return `walk${n}@example.com`;
      if (v.format === "url") return `https://example.com/walk/${n}`;
      if (v.format === "uuid") return ctx.rng.uuid();
      if (v.pattern) return undefined;
      const min = v.min_length ?? 1;
      const max = Math.min(column.maxLength ?? 255, v.max_length ?? 255);
      let text = `walk ${n}`;
      while (text.length < min) text += "x";
      return text.length > max ? text.slice(0, max) : text;
    }
    case "text":
      return `Walk row ${n}: a body the harness wrote.`;
    case "integer":
    case "bigint": {
      const min = v.min ?? 0;
      const max = v.max ?? min + 1000;
      return Math.min(max, Math.max(min, n));
    }
    case "float":
    case "decimal": {
      const min = v.min ?? 0;
      return Math.max(min, 1.5);
    }
    case "money":
      // A decimal string within the field's bounds; never a number
      return column.money?.min ?? column.money?.max ?? `${(n % 900) + 1}.5`;
    case "boolean":
      return false;
    case "datetime":
      return new Date(Date.UTC(2026, 0, 1 + (n % 28))).toISOString();
    case "date":
      return `2026-01-${String(1 + (n % 28)).padStart(2, "0")}`;
    case "time":
      return "12:00:00";
    case "uuid":
      return ctx.rng.uuid();
    case "json":
      // A value with a shape per enum value is filled in by validBody, which knows the row's value
      return column.shape ? validShape(column.shape, ctx) : {};
    case "bytes":
      return undefined;
  }
}

/** A value of a scalar or enum key of a shape that satisfies its validation */
function validKeyValue(key: ShapeKeyIR, kind: ShapeKeyIR["kind"], ctx: BodyContext): unknown {
  const n = ctx.next();
  const v = key.validate ?? {};
  switch (kind) {
    case "enum":
      return key.values![0];
    case "string":
    case "text": {
      if (v.format === "email") return `walk${n}@example.com`;
      if (v.format === "url") return `https://example.com/walk/${n}`;
      if (v.format === "uuid") return ctx.rng.uuid();
      const min = v.min_length ?? 1;
      const max = Math.min(key.maxLength ?? 255, v.max_length ?? 255);
      let text = `walk ${n}`;
      while (text.length < min) text += "x";
      return text.length > max ? text.slice(0, max) : text;
    }
    case "integer": {
      const min = v.min ?? 0;
      const max = v.max ?? min + 1000;
      return Math.min(max, Math.max(min, n));
    }
    case "float":
      return Math.max(v.min ?? 0, Math.min(v.max ?? 1.5, 1.5));
    case "boolean":
      return true;
    case "date":
      return `2026-01-${String(1 + (n % 28)).padStart(2, "0")}`;
    case "datetime":
      return new Date(Date.UTC(2026, 0, 1 + (n % 28))).toISOString();
    case "uuid":
      return ctx.rng.uuid();
    default:
      return undefined;
  }
}

/**
 * A value that fits a shape: every key filled, so each probe has a key to bend. Undefined when a required key
 * cannot be made up (a string held to a pattern), as for a column: the walk then has no body to send.
 */
export function validShape(keys: ShapeKeyIR[], ctx: BodyContext): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    let value: unknown;
    if (key.validate?.pattern) value = undefined;
    else if (key.kind === "object") value = validShape(key.keys ?? [], ctx);
    else if (key.kind === "array") value = [validKeyValue(key, key.of!, ctx)];
    else value = validKeyValue(key, key.kind, ctx);
    if (value === undefined) {
      if (key.required) return undefined;
      continue;
    }
    out[key.name] = value;
  }
  return out;
}

/** The keys of the shape a value must fit on a row whose enum column holds `by`; undefined for a column without one */
export function shapeFor(column: ColumnIR, by: unknown): ShapeKeyIR[] | undefined {
  if (column.shape) return column.shape;
  return column.shapeBy?.shapes.find(shape => shape.value === by)?.keys;
}

export interface Built {
  body: Record<string, unknown>;
  /** Required fields the walk could not fill */
  missing: string[];
}

/** A body for the named writable fields: every required one filled, optional ones left out, relations from the walk's rows */
export function validBody(entity: EntityIR, fields: string[], ctx: BodyContext, exclude: Set<string>): Built {
  const body: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const name of fields) {
    if (exclude.has(name)) continue;
    const column = entity.columns.find(c => c.name === name);
    if (!column) continue;
    const required = !column.nullable && column.default === undefined;
    const fk = entity.foreignKeys.find(f => f.column === name);
    let value: unknown;
    if (fk) value = ctx.relatedId(fk.targetEntity, column);
    // A sealed field is written even where it is optional, so the walks have sealed values to read back
    else if (column.shapeBy) continue;
    else if (required || column.sealed || (column.type.kind === "scalar" && column.unique))
      value = validValue(column, ctx);
    if (value === undefined) {
      if (required) missing.push(name);
      continue;
    }
    body[name] = value;
  }
  // A value whose shape follows an enum of the row: the body names the enum's value, and the value fits its shape
  for (const name of fields) {
    const column = entity.columns.find(c => c.name === name);
    if (!column?.shapeBy || exclude.has(name)) continue;
    const by = column.shapeBy.column;
    const holder = entity.columns.find(c => c.name === by);
    const value = fields.includes(by)
      ? (body[by] ?? column.shapeBy.shapes[0]?.value)
      : holder?.default?.kind === "literal"
        ? holder.default.value
        : undefined;
    const keys = shapeFor(column, value);
    const fits = keys ? validShape(keys, ctx) : undefined;
    if (fits === undefined) {
      if (!column.nullable) missing.push(name);
      continue;
    }
    if (fields.includes(by)) body[by] = value;
    body[name] = fits;
  }
  return { body, missing };
}

export interface Probe {
  name: string;
  body: Record<string, unknown>;
  /** The key the refusal must name, dotted from the body's root, when the probe bends one key of a shape */
  path?: string;
}

/**
 * The ways a value can miss its shape, each with the path the refusal must name: a wrong type at every key (nested
 * ones too), every required key left out, null at a key, a key the shape does not name at every depth, and an
 * array where an object belongs. Each is checked against the reference validator before it is sent, so a probe
 * the reference accepts is never claimed to be invalid.
 */
export function shapeProbes(
  field: string,
  keys: ShapeKeyIR[],
  valid: Record<string, unknown>
): { what: string; value: unknown; path: string }[] {
  const out: { what: string; value: unknown; path: string }[] = [];
  const wrong = (key: ShapeKeyIR): unknown => {
    switch (key.kind) {
      case "object":
        return ["osl-fuzz"];
      case "array":
        return "not-an-array";
      case "enum":
        return "osl-fuzz-not-a-value";
      case "string":
      case "text":
        return 12;
      case "boolean":
        return "maybe";
      case "integer":
      case "float":
        return "twelve";
      default:
        return 12;
    }
  };
  const walk = (
    shape: ShapeKeyIR[],
    value: Record<string, unknown>,
    at: string[],
    rebuild: (next: unknown) => unknown
  ) => {
    const path = (name: string) => [field, ...at, name].join(".");
    for (const key of shape) {
      out.push({
        what: `a wrong type at ${path(key.name)}`,
        value: rebuild({ ...value, [key.name]: wrong(key) }),
        path: path(key.name)
      });
      out.push({
        what: `null at ${path(key.name)}`,
        value: rebuild({ ...value, [key.name]: null }),
        path: path(key.name)
      });
      if (key.required) {
        const without = { ...value };
        delete without[key.name];
        out.push({ what: `${path(key.name)} left out`, value: rebuild(without), path: path(key.name) });
      }
      if (key.kind === "array")
        out.push({
          what: `a wrong element in ${path(key.name)}`,
          value: rebuild({
            ...value,
            [key.name]: [key.of === "string" || key.of === "text" || key.of === "uuid" ? 12 : "twelve"]
          }),
          path: `${path(key.name)}.0`
        });
      if (key.kind === "integer")
        out.push({
          what: `a fraction at ${path(key.name)}`,
          value: rebuild({ ...value, [key.name]: 1.5 }),
          path: path(key.name)
        });
      if (key.kind === "object" && typeof value[key.name] === "object" && value[key.name] !== null)
        walk(key.keys ?? [], value[key.name] as Record<string, unknown>, [...at, key.name], next =>
          rebuild({ ...value, [key.name]: next })
        );
    }
    out.push({
      what: `an unknown key at ${path("osl_fuzz_unknown_key")}`,
      value: rebuild({ ...value, osl_fuzz_unknown_key: 1 }),
      path: path("osl_fuzz_unknown_key")
    });
  };
  walk(keys, valid, [], next => next);
  out.push({ what: `an array where ${field} is an object`, value: [valid], path: field });
  out.push({ what: `a string where ${field} is an object`, value: JSON.stringify(valid), path: field });
  // Only what the reference refuses is a probe: the generated validators are held to it, not to this list
  return out.filter(probe => shapeValueProblem(keys, probe.value, field) !== undefined);
}

/** A value of the wrong type for the column, so validation must refuse it */
export function wrongValue(column: ColumnIR, ctx: BodyContext): unknown {
  if (column.enumValues?.length || column.type.kind === "enum") return "osl-fuzz-not-a-value";
  if (column.type.kind === "array") return "not-an-array";
  if (column.type.kind === "file") return 12;
  switch (column.type.scalar) {
    case "string":
    case "text":
      return 12;
    case "integer":
    case "bigint":
    case "float":
    case "decimal":
    case "money":
      return "twelve";
    case "boolean":
      return "maybe";
    case "datetime":
    case "date":
    case "time":
      return "yesterday";
    case "uuid":
      return "not-a-uuid";
    case "json":
      return "{not json";
    case "bytes":
      return 12;
  }
  void ctx;
}

/** An amount in ten-thousandths and back, exactly: the harness compares and steps amounts as integers, never as floats */
export function moneyUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(whole + fraction.padEnd(4, "0"));
  return negative ? -units : units;
}

export function moneyString(units: bigint): string {
  const digits = (units < 0n ? -units : units).toString().padStart(5, "0");
  return `${units < 0n ? "-" : ""}${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

/**
 * The shapes an amount must never be accepted in: a JSON number (a float has already lost what was written), more
 * fraction digits than the column holds (it could only round), more digits than numeric(19, 4) has, and strings
 * that are not plain decimals. Beside them, one step outside each bound the field declares.
 */
export function moneyProbes(column: ColumnIR): { what: string; value: unknown }[] {
  const probes: { what: string; value: unknown }[] = [
    { what: "as a JSON number", value: 12.3 },
    { what: "as a JSON integer", value: 12 },
    { what: "with five fraction digits", value: "1.23456" },
    { what: "with sixteen digits before the point", value: "1234567890123456" },
    { what: "with an exponent", value: "1e3" },
    { what: "with a thousands separator", value: "1,234.50" },
    { what: "with a currency sign", value: "$12.30" },
    { what: "without digits before the point", value: ".5" },
    { what: "as an empty string", value: "" }
  ];
  const { min, max } = column.money ?? {};
  if (min !== undefined) probes.push({ what: `below ${min}`, value: moneyString(moneyUnits(min) - 1n) });
  if (max !== undefined) probes.push({ what: `above ${max}`, value: moneyString(moneyUnits(max) + 1n) });
  return probes;
}

/** Invalid variants of a valid body for the fields: one probe per way the body can be wrong; `partial` for an update */
export function invalidProbes(
  columns: ColumnIR[],
  fields: string[],
  valid: Record<string, unknown>,
  ctx: BodyContext,
  partial = false,
  /** The stored row an update goes to: the enum value a shape follows is read from it when the body does not carry one */
  row?: Record<string, unknown>
): Probe[] {
  const probes: Probe[] = [];
  probes.push({ name: "extra key", body: { ...valid, osl_fuzz_unknown_key: 1 } });
  for (const name of fields) {
    const column = columns.find(c => c.name === name);
    if (!column) continue;
    probes.push({ name: `wrong type for ${name}`, body: { ...valid, [name]: wrongValue(column, ctx) } });
    if (column.money)
      for (const probe of moneyProbes(column))
        probes.push({ name: `${name} ${probe.what}`, body: { ...valid, [name]: probe.value } });
    if (column.shape || column.shapeBy) {
      const by = column.shapeBy ? (valid[column.shapeBy.column] ?? row?.[column.shapeBy.column]) : undefined;
      const keys = shapeFor(column, by);
      const made = keys ? validShape(keys, ctx) : undefined;
      if (keys && made) {
        const fits = withShapeDefaults(keys, made);
        for (const probe of shapeProbes(name, keys, fits))
          probes.push({
            name: `${name} with ${probe.what}`,
            body: { ...valid, [name]: probe.value },
            path: probe.path
          });
        // The shape of another value of the enum, where the row's own does not take it
        for (const other of column.shapeBy?.shapes ?? []) {
          if (other.value === by) continue;
          const foreign = validShape(other.keys, ctx);
          const misfit = foreign ? shapeValueProblem(keys, foreign, name) : undefined;
          if (foreign && misfit)
            probes.push({
              name: `${name} with the shape of ${column.shapeBy!.column} ${other.value} on a row that is ${String(by)}`,
              body: { ...valid, [name]: foreign },
              path: misfit.path
            });
        }
        // The enum changed without the value that fits it
        if (partial && column.shapeBy && fields.includes(column.shapeBy.column) && row && row[name] !== null) {
          const next = column.shapeBy.shapes.find(shape => shape.value !== row[column.shapeBy!.column]);
          const body = { ...valid, [column.shapeBy.column]: next?.value };
          delete (body as Record<string, unknown>)[name];
          if (next)
            probes.push({
              name: `${column.shapeBy.column} changed to ${next.value} without ${name}`,
              body,
              path: name
            });
        }
      }
    }
    if (column.type.kind === "scalar" && column.type.scalar === "string") {
      // The bound the validators hold a string to: validate.max_length, else the field's max_length, else 255
      const max = column.validate?.max_length ?? column.maxLength ?? 255;
      probes.push({ name: `${name} longer than ${max}`, body: { ...valid, [name]: "x".repeat(max + 1) } });
    }
    const required = !column.nullable && column.default === undefined;
    if (required && valid[name] !== undefined) {
      // A partial body (an update) may leave a field out; it may never set a required one to null
      if (!partial) {
        const without = { ...valid };
        delete without[name];
        probes.push({ name: `missing ${name}`, body: without });
      }
      probes.push({ name: `null ${name}`, body: { ...valid, [name]: null } });
    }
  }
  for (const column of columns)
    if ((column.readOnly || column.hidden) && !column.primary)
      probes.push({
        name: `server-owned ${column.name} sent`,
        body: { ...valid, [column.name]: validValue(column, ctx) ?? "x" }
      });
  return probes;
}

/** Ids no row has, and ids of the wrong shape, for the primary key column */
export function badIds(pk: ColumnIR, ctx: BodyContext): { name: string; id: string; shape: "wrong" | "missing" }[] {
  const scalar = pk.type.kind === "scalar" ? pk.type.scalar : "string";
  if (scalar === "uuid")
    return [
      { name: "a malformed id", id: "not-a-uuid", shape: "wrong" },
      { name: "an id no row has", id: ctx.rng.uuid(), shape: "missing" }
    ];
  if (scalar === "integer" || scalar === "bigint")
    return [
      { name: "a malformed id", id: "abc", shape: "wrong" },
      { name: "a negative id", id: "-1", shape: "wrong" },
      { name: "an id no row has", id: "2147483000", shape: "missing" }
    ];
  return [{ name: "an id no row has", id: `osl-fuzz-${ctx.next()}`, shape: "missing" }];
}
