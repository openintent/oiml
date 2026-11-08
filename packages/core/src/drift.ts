/**
 * Drift check: compares the live database with the IR and reports every difference.
 * Tables, columns, nullability and type families are compared. Constraints are not yet.
 */
import type { ColumnIR, IR } from "./ir.js";
import { withClient } from "./migrator.js";

export interface DriftItem {
  kind: "missing_table" | "extra_table" | "missing_column" | "extra_column" | "type" | "nullable";
  table: string;
  column?: string;
  expected?: string;
  actual?: string;
}

interface LiveColumn {
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: "YES" | "NO";
}

const IGNORED_TABLES = new Set(["osl_migrations"]);

export interface DriftOptions {
  /** Tables to leave alone besides OSL's own, as SQL LIKE patterns (river_%, say) */
  ignoreTables?: string[];
}

function matchesPattern(table: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`).test(table);
}

export async function checkDrift(databaseUrl: string, ir: IR, options: DriftOptions = {}): Promise<DriftItem[]> {
  const live = await withClient(databaseUrl, async client => {
    const { rows } = await client.query<LiveColumn>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`
    );
    return rows;
  });

  const items: DriftItem[] = [];
  const liveTables = new Map<string, LiveColumn[]>();
  for (const row of live) {
    if (IGNORED_TABLES.has(row.table_name)) continue;
    (liveTables.get(row.table_name) ?? liveTables.set(row.table_name, []).get(row.table_name)!).push(row);
  }

  for (const entity of ir.entities) {
    const columns = liveTables.get(entity.table);
    if (!columns) {
      items.push({ kind: "missing_table", table: entity.table });
      continue;
    }
    for (const column of entity.columns) {
      const liveColumn = columns.find(c => c.column_name === column.name);
      if (!liveColumn) {
        items.push({ kind: "missing_column", table: entity.table, column: column.name });
        continue;
      }
      const expectedType = expectedDataType(column);
      if (liveColumn.data_type !== expectedType)
        items.push({
          kind: "type",
          table: entity.table,
          column: column.name,
          expected: expectedType,
          actual: liveColumn.data_type
        });
      const expectedNullable = column.nullable ? "YES" : "NO";
      if (liveColumn.is_nullable !== expectedNullable)
        items.push({
          kind: "nullable",
          table: entity.table,
          column: column.name,
          expected: expectedNullable,
          actual: liveColumn.is_nullable
        });
    }
    for (const liveColumn of columns) {
      if (!entity.columns.some(c => c.name === liveColumn.column_name))
        items.push({ kind: "extra_column", table: entity.table, column: liveColumn.column_name });
    }
  }
  for (const table of liveTables.keys()) {
    if (ir.entities.some(e => e.table === table)) continue;
    if ((options.ignoreTables ?? []).some(p => matchesPattern(table, p))) continue;
    items.push({ kind: "extra_table", table });
  }
  return items;
}

function expectedDataType(column: ColumnIR): string {
  if (column.type.kind === "enum") return "USER-DEFINED";
  if (column.type.kind === "array") return "ARRAY";
  if (column.type.kind === "file") return "jsonb";
  switch (column.type.scalar) {
    case "string":
      return "character varying";
    case "text":
      return "text";
    case "integer":
      return "integer";
    case "bigint":
      return "bigint";
    case "float":
      return "double precision";
    case "decimal":
      return "numeric";
    case "boolean":
      return "boolean";
    case "datetime":
      return "timestamp with time zone";
    case "date":
      return "date";
    case "time":
      return "time without time zone";
    case "uuid":
      return "uuid";
    case "json":
      return "jsonb";
    case "bytes":
      return "bytea";
  }
}

export function formatDrift(items: DriftItem[]): string {
  if (items.length === 0) return "no drift";
  return items
    .map(i => {
      const where = i.column ? `${i.table}.${i.column}` : i.table;
      switch (i.kind) {
        case "missing_table":
          return `missing table ${where}`;
        case "extra_table":
          return `extra table ${where} (not in the model)`;
        case "missing_column":
          return `missing column ${where}`;
        case "extra_column":
          return `extra column ${where} (not in the model)`;
        case "type":
          return `${where}: type is ${i.actual}, model says ${i.expected}`;
        case "nullable":
          return `${where}: nullable is ${i.actual}, model says ${i.expected}`;
      }
    })
    .join("\n");
}
