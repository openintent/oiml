import type { ColumnIR, EntityIR, IR } from "@osl/core";
import {
  enumExport,
  entityByName,
  q,
  relationsExport,
  tableExport,
  typeName,
  type TsConventions
} from "./conventions.js";

/** generated/db/schema.ts: Drizzle pg-core tables, enums, relations and row types. */
export function schemaFile(ir: IR, conv: TsConventions): string {
  const builders = new Set<string>(["pgTable"]);
  const out: string[] = [];

  for (const e of ir.enums) {
    builders.add("pgEnum");
    out.push(`export const ${enumExport(e.name)} = pgEnum(${q(e.name)}, [${e.values.map(q).join(", ")}]);`);
  }
  if (ir.enums.length) out.push("");

  if (ir.files) {
    out.push(
      "/** What a file field stores: a snapshot of the uploaded file's osl_files row */",
      "export type FileRef = { id: string; key: string; name: string; size: number; type: string };",
      ""
    );
  }
  const needsBytea = ir.entities.some(e => e.columns.some(c => c.type.kind === "scalar" && c.type.scalar === "bytes"));
  if (needsBytea) {
    builders.add("customType");
    out.push(
      `const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({ dataType: () => "bytea" });`,
      ""
    );
  }

  for (const entity of ir.entities) {
    const lines: string[] = [];
    for (const col of entity.columns) lines.push(`  ${col.name}: ${columnBuilder(ir, entity, col, builders)}`);
    const extras: string[] = [];
    if (entity.primaryKey.length > 1) {
      builders.add("primaryKey");
      extras.push(`primaryKey({ columns: [${entity.primaryKey.map(c => `t.${c}`).join(", ")}] })`);
    }
    for (const u of entity.uniques) {
      builders.add("unique");
      extras.push(`unique(${q(u.name)}).on(${u.columns.map(c => `t.${c}`).join(", ")})`);
    }
    for (const idx of entity.indexes) {
      builders.add(idx.unique ? "uniqueIndex" : "index");
      extras.push(
        `${idx.unique ? "uniqueIndex" : "index"}(${q(idx.name)}).on(${idx.columns.map(c => `t.${c}`).join(", ")})`
      );
    }
    const body = `{\n${lines.join(",\n")}\n}`;
    if (extras.length) {
      out.push(
        `export const ${tableExport(entity)} = pgTable(\n  ${q(entity.table)},\n  ${body.replace(/\n/g, "\n  ")},\n  t => [${extras.join(", ")}]\n);`
      );
    } else {
      out.push(`export const ${tableExport(entity)} = pgTable(${q(entity.table)}, ${body});`);
    }
    out.push("");
  }

  const relationLines: string[] = [];
  for (const entity of ir.entities) {
    if (entity.relations.length === 0) continue;
    const parts: string[] = [];
    for (const rel of entity.relations) {
      const target = entityByName(ir, rel.target);
      // The forward side and a reverse many carry the forward relation's name, so two relations between the
      // same tables (or a table and itself) stay apart for Drizzle; a reverse one takes no config, since
      // Drizzle then requires fields, and resolves by the single relation pointing back
      const forwardName =
        rel.direction === "forward"
          ? rel.name
          : target.relations.find(r => r.direction === "forward" && r.column === rel.column && r.target === entity.name)
              ?.name;
      if (rel.direction === "forward") {
        parts.push(
          `  ${rel.name}: one(${tableExport(target)}, { fields: [${tableExport(entity)}.${rel.column}], references: [${tableExport(target)}.${rel.targetColumn}], relationName: ${q(rel.name)} })`
        );
      } else if (rel.kind === "many") {
        parts.push(
          `  ${rel.name}: many(${tableExport(target)}${forwardName ? `, { relationName: ${q(forwardName)} }` : ""})`
        );
      } else {
        parts.push(`  ${rel.name}: one(${tableExport(target)})`);
      }
    }
    const uses = entity.relations.some(r => r.direction === "forward" || r.kind === "one")
      ? entity.relations.some(r => r.direction === "reverse" && r.kind === "many")
        ? "{ one, many }"
        : "{ one }"
      : "{ many }";
    relationLines.push(
      `export const ${relationsExport(entity)} = relations(${tableExport(entity)}, (${uses}) => ({\n${parts.join(",\n")}\n}));`,
      ""
    );
  }

  const typeLines: string[] = [];
  for (const entity of ir.entities) {
    typeLines.push(`export type ${typeName(entity)} = typeof ${tableExport(entity)}.$inferSelect;`);
    typeLines.push(`export type New${typeName(entity)} = typeof ${tableExport(entity)}.$inferInsert;`);
  }

  const imports = [`import { ${[...builders].sort().join(", ")} } from "drizzle-orm/pg-core";`];
  if (relationLines.length) imports.unshift(`import { relations } from "drizzle-orm";`);

  return [
    conv.header("Drizzle schema for the model."),
    ...imports,
    "",
    ...out,
    ...relationLines,
    ...typeLines,
    ""
  ].join("\n");
}

function columnBuilder(ir: IR, entity: EntityIR, col: ColumnIR, builders: Set<string>): string {
  let expr: string;
  const t = col.type;
  if (t.kind === "enum") expr = `${enumExport(t.name)}()`;
  else if (t.kind === "array") expr = `${scalarBuilder(t.of, col.maxLength, builders)}.array()`;
  else if (t.kind === "file") {
    builders.add("jsonb");
    expr = "jsonb().$type<FileRef>()";
  } else expr = scalarBuilder(t.scalar, col.maxLength, builders);

  if (col.primary && entity.primaryKey.length === 1) expr += ".primaryKey()";
  if (col.generated === "identity") expr += ".generatedAlwaysAsIdentity()";
  if (!col.nullable && !(col.primary && entity.primaryKey.length === 1)) expr += ".notNull()";
  if (col.unique) expr += ".unique()";
  if (col.default) {
    if (col.default.kind === "now") expr += ".defaultNow()";
    else if (col.default.kind === "uuid") expr += ".defaultRandom()";
    else if (t.kind !== "array") expr += `.default(${JSON.stringify(col.default.value)})`;
  }
  const fk = entity.foreignKeys.find(f => f.column === col.name);
  if (fk) {
    const target = entityByName(ir, fk.targetEntity);
    const onDelete = fk.onDelete === "set_null" ? "set null" : fk.onDelete;
    // A table that references itself needs the column type spelled out, or TypeScript sees a circular initializer
    const selfReference = target.name === entity.name;
    if (selfReference) builders.add("type AnyPgColumn");
    expr += `.references(()${selfReference ? ": AnyPgColumn" : ""} => ${tableExport(target)}.${fk.targetColumn}, { onDelete: ${q(onDelete)} })`;
  }
  return expr;
}

function scalarBuilder(scalar: string, maxLength: number | undefined, builders: Set<string>): string {
  const use = (name: string, call: string) => {
    builders.add(name);
    return call;
  };
  switch (scalar) {
    case "string":
      return use("varchar", `varchar({ length: ${maxLength ?? 255} })`);
    case "text":
      return use("text", "text()");
    case "integer":
      return use("integer", "integer()");
    case "bigint":
      return use("bigint", `bigint({ mode: "number" })`);
    case "float":
      return use("doublePrecision", "doublePrecision()");
    case "decimal":
      return use("numeric", "numeric()");
    case "boolean":
      return use("boolean", "boolean()");
    case "datetime":
      return use("timestamp", "timestamp({ withTimezone: true })");
    case "date":
      return use("date", "date()");
    case "time":
      return use("time", "time()");
    case "uuid":
      return use("uuid", "uuid()");
    case "json":
      return use("jsonb", "jsonb()");
    case "bytes":
      return "bytea()";
    default:
      throw new Error(`no Drizzle builder for ${scalar}`);
  }
}

/** generated/db/client.ts */
export function clientFile(conv: TsConventions): string {
  return `${conv.header("Database client.")}
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { oslPool?: Pool };

const pool = globalForDb.oslPool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== "production") globalForDb.oslPool = pool;

export const db = drizzle({ client: pool, schema });
export type Db = typeof db;
`;
}
