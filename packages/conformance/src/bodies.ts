/**
 * Bodies the walks send: a valid body for a create or an update, built from the columns' types and validation,
 * and the invalid ones the fuzz walk probes with (wrong types, boundary lengths, extra keys, missing fields, bad
 * ids). Values come from a seeded generator so a failure replays.
 */
import type { ColumnIR, EntityIR, IR } from "@osl/core";

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
      return {};
    case "bytes":
      return undefined;
  }
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
    else if (required || (column.type.kind === "scalar" && column.unique)) value = validValue(column, ctx);
    if (value === undefined) {
      if (required) missing.push(name);
      continue;
    }
    body[name] = value;
  }
  return { body, missing };
}

export interface Probe {
  name: string;
  body: Record<string, unknown>;
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

/** Invalid variants of a valid body for the fields: one probe per way the body can be wrong; `partial` for an update */
export function invalidProbes(
  columns: ColumnIR[],
  fields: string[],
  valid: Record<string, unknown>,
  ctx: BodyContext,
  partial = false
): Probe[] {
  const probes: Probe[] = [];
  probes.push({ name: "extra key", body: { ...valid, osl_fuzz_unknown_key: 1 } });
  for (const name of fields) {
    const column = columns.find(c => c.name === name);
    if (!column) continue;
    probes.push({ name: `wrong type for ${name}`, body: { ...valid, [name]: wrongValue(column, ctx) } });
    if (column.type.kind === "scalar" && column.type.scalar === "string") {
      const max = Math.min(column.maxLength ?? 255, column.validate?.max_length ?? 255);
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
