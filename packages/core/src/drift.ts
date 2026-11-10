/**
 * Drift check: compares the live database with the IR and reports every difference.
 * Tables, columns, nullability and type families are compared, and under `isolation: database` the backstop:
 * row security on each table, the policies with their expressions, the functions that see past them and the
 * triggers that keep a derived tenant column. Constraints are not yet.
 */
import type { ColumnIR, IR } from "./ir.js";
import { databaseObjects } from "./counts.js";
import { canonicalExpression } from "./isolation.js";
import { physicalColumns } from "./migrations.js";
import { withClient } from "./migrator.js";

export interface DriftItem {
  kind:
    | "missing_table"
    | "extra_table"
    | "missing_column"
    | "extra_column"
    | "type"
    | "nullable"
    | "row_security"
    | "missing_policy"
    | "extra_policy"
    | "policy"
    | "missing_function"
    | "function"
    | "missing_trigger";
  table: string;
  column?: string;
  /** The policy, function or trigger the item is about */
  name?: string;
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

/** What the database says of the isolation layer: tables under row security, their policies, OSL's functions and triggers */
export interface LiveIsolation {
  secured: string[];
  /** Tables whose row security also binds their owner (FORCE), which the backstop never asks for */
  forced?: string[];
  policies: { table: string; name: string; command: string; using: string | null; check: string | null }[];
  functions: { name: string; definer: boolean; source: string }[];
  triggers: { table: string; name: string }[];
}

/**
 * The isolation layer compared: a tenant table without row security, a policy that is missing, extra or whose
 * expression differs, a function whose body differs or that lost its definer rights, a missing trigger. Pure, so
 * it is tested without a database.
 */
export function isolationDrift(ir: IR, live: LiveIsolation): DriftItem[] {
  const items: DriftItem[] = [];
  // The functions and triggers of the ordered collections and of the counts are compared with the isolation layer's
  const objects = databaseObjects(ir);
  const modelTables = new Set(ir.entities.map(e => e.table));
  const expectedSecured = new Set(objects.filter(o => o.kind === "rls").map(o => o.table!));
  for (const table of expectedSecured)
    if (!live.secured.includes(table))
      items.push({ kind: "row_security", table, expected: "enabled", actual: "disabled" });
  for (const table of live.secured)
    if (modelTables.has(table) && !expectedSecured.has(table))
      items.push({ kind: "row_security", table, expected: "disabled", actual: "enabled" });
  // Forced row security binds the owner too: the worker and the functions that see past the policies would read nothing
  for (const table of live.forced ?? [])
    if (modelTables.has(table))
      items.push({ kind: "row_security", table, expected: "not forced on the owner", actual: "forced" });
  const policies = objects.filter(o => o.kind === "policy");
  for (const policy of policies) {
    const found = live.policies.find(p => p.table === policy.table && p.name === policy.name);
    if (!found) {
      items.push({ kind: "missing_policy", table: policy.table!, name: policy.name });
      continue;
    }
    const expected = policy.policy!;
    const sameCommand = found.command.toUpperCase() === expected.command;
    const sameUsing = canonicalExpression(found.using ?? "") === canonicalExpression(expected.using);
    // A policy for all commands checks new rows with its USING expression unless WITH CHECK says otherwise
    const sameCheck = found.check === null || canonicalExpression(found.check) === canonicalExpression(expected.using);
    if (!sameCommand || !sameUsing || !sameCheck)
      items.push({
        kind: "policy",
        table: policy.table!,
        name: policy.name,
        expected: `${expected.command} USING (${expected.using})`,
        actual: `${found.command} USING (${found.using ?? ""})${found.check ? ` WITH CHECK (${found.check})` : ""}`
      });
  }
  for (const found of live.policies)
    if (modelTables.has(found.table) && !policies.some(p => p.table === found.table && p.name === found.name))
      items.push({ kind: "extra_policy", table: found.table, name: found.name });
  for (const fn of objects.filter(o => o.kind === "function")) {
    const found = live.functions.find(f => f.name === fn.name);
    if (!found) items.push({ kind: "missing_function", table: "", name: fn.name });
    else if (found.source.trim() !== fn.body!.source.trim() || found.definer !== fn.body!.definer)
      items.push({
        kind: "function",
        table: "",
        name: fn.name,
        expected: fn.body!.source.trim(),
        actual: `${found.definer ? "" : "(not SECURITY DEFINER) "}${found.source.trim()}`
      });
  }
  for (const trigger of objects.filter(o => o.kind === "trigger"))
    if (!live.triggers.some(t => t.table === trigger.table && t.name === trigger.name))
      items.push({ kind: "missing_trigger", table: trigger.table!, name: trigger.name });
  return items;
}

export async function checkDrift(databaseUrl: string, ir: IR, options: DriftOptions = {}): Promise<DriftItem[]> {
  const { live, isolation } = await withClient(databaseUrl, async client => {
    const { rows } = await client.query<LiveColumn>(
      `SELECT table_name, column_name, data_type, udt_name, is_nullable
       FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`
    );
    const secured = await client.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND (c.relrowsecurity OR c.relforcerowsecurity) ORDER BY c.relname`
    );
    const policies = await client.query<LiveIsolation["policies"][number]>(
      `SELECT tablename AS "table", policyname AS "name", cmd AS "command", qual AS "using", with_check AS "check"
       FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname`
    );
    const functions = await client.query<LiveIsolation["functions"][number]>(
      `SELECT p.proname AS "name", p.prosecdef AS "definer", p.prosrc AS "source"
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname LIKE 'osl\\_%' ORDER BY p.proname`
    );
    const triggers = await client.query<LiveIsolation["triggers"][number]>(
      `SELECT c.relname AS "table", t.tgname AS "name" FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY c.relname, t.tgname`
    );
    const liveIsolation: LiveIsolation = {
      secured: secured.rows.filter(r => r.enabled).map(r => r.relname),
      forced: secured.rows.filter(r => r.forced).map(r => r.relname),
      policies: policies.rows,
      functions: functions.rows,
      triggers: triggers.rows
    };
    return { live: rows, isolation: liveIsolation };
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
    for (const column of physicalColumns(entity)) {
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
      if (!physicalColumns(entity).some(c => c.name === liveColumn.column_name))
        items.push({ kind: "extra_column", table: entity.table, column: liveColumn.column_name });
    }
  }
  // Tables the model implies beyond its entities (the sequences' counters): expected, and nothing of theirs is compared
  const ownTables = databaseObjects(ir)
    .filter(o => o.kind === "table")
    .map(o => o.name);
  for (const table of ownTables) if (!liveTables.has(table)) items.push({ kind: "missing_table", table });
  for (const table of liveTables.keys()) {
    if (ir.entities.some(e => e.table === table) || ownTables.includes(table)) continue;
    if ((options.ignoreTables ?? []).some(p => matchesPattern(table, p))) continue;
    items.push({ kind: "extra_table", table });
  }
  items.push(...isolationDrift(ir, isolation));
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
    case "money":
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
        case "row_security":
          return `${where}: row security is ${i.actual}, model says ${i.expected}`;
        case "missing_policy":
          return `missing policy ${i.name} on ${where}`;
        case "extra_policy":
          return `extra policy ${i.name} on ${where} (not in the model)`;
        case "policy":
          return `policy ${i.name} on ${where} is ${i.actual}, model says ${i.expected}`;
        case "missing_function":
          return `missing function ${i.name}`;
        case "function":
          return `function ${i.name} is ${i.actual}, model says ${i.expected}`;
        case "missing_trigger":
          return `missing trigger ${i.name} on ${where}`;
      }
    })
    .join("\n");
}
