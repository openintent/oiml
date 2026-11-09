/**
 * Migrations are a pure function of two consecutive IRs plus the renames recorded
 * between them. The same history always renders the same SQL.
 */
import type { Renames } from "./diff.js";
import { slugify } from "./naming.js";
import type { ColumnIR, EntityIR, IR, TypeIR } from "./ir.js";

export type MigrationStep =
  | { kind: "create_enum"; name: string; values: string[] }
  | { kind: "add_enum_value"; name: string; value: string }
  | { kind: "drop_enum"; name: string }
  | { kind: "rename_table"; from: string; to: string }
  | { kind: "rename_column"; table: string; from: string; to: string }
  | { kind: "create_table"; entity: EntityIR }
  | { kind: "add_column"; table: string; column: ColumnIR }
  | { kind: "alter_column_type"; table: string; column: ColumnIR }
  | { kind: "set_not_null"; table: string; column: string; notNull: boolean }
  | { kind: "set_default"; table: string; column: ColumnIR }
  | { kind: "drop_column"; table: string; column: string }
  | { kind: "add_unique"; table: string; name: string; columns: string[] }
  | { kind: "drop_constraint"; table: string; name: string }
  | { kind: "add_foreign_key"; table: string; fk: EntityIR["foreignKeys"][number] }
  | { kind: "create_index"; table: string; name: string; columns: string[]; unique: boolean }
  | { kind: "drop_index"; name: string }
  | { kind: "drop_table"; table: string };

export interface MigrationPlan {
  steps: MigrationStep[];
  warnings: string[];
  /** Steps that rewrite every row of a table: a type change, or NOT NULL on a column without a default */
  rewrites: MigrationStep[];
}

/** Whether a step rewrites its table rather than adding to it */
export function isRewrite(step: MigrationStep, next: IR): boolean {
  if (step.kind === "alter_column_type") return true;
  if (step.kind === "set_not_null" && step.notNull) {
    const entity = next.entities.find(e => e.table === step.table);
    const column = entity?.columns.find(c => c.name === step.column);
    return column?.default === undefined;
  }
  return false;
}

const EMPTY_RENAMES: Renames = { entities: {}, fields: {} };

/** Plan the steps that take a database at `prev` to `next`. `prev` null means an empty database. */
export function planMigration(prev: IR | null, next: IR, renames: Renames = EMPTY_RENAMES): MigrationPlan {
  const warnings: string[] = [];
  const early: MigrationStep[] = []; // enums, renames
  const tables: MigrationStep[] = []; // create tables
  const alters: MigrationStep[] = []; // columns
  const dropsConstraints: MigrationStep[] = [];
  const dropsColumns: MigrationStep[] = [];
  const adds: MigrationStep[] = []; // uniques, fks, indexes
  const late: MigrationStep[] = []; // drop tables, drop enums

  const prevEntities = prev?.entities ?? [];
  const prevEnums = prev?.enums ?? [];
  const oldNameOf = (newName: string) =>
    Object.entries(renames.entities).find(([, to]) => to === newName)?.[0] ?? newName;
  const oldFieldOf = (entityName: string, newField: string) =>
    Object.entries(renames.fields[entityName] ?? {}).find(([, to]) => to === newField)?.[0] ?? newField;

  // Enums
  for (const e of next.enums) {
    const old = prevEnums.find(p => p.name === e.name);
    if (!old) early.push({ kind: "create_enum", name: e.name, values: e.values });
    else {
      for (const v of e.values)
        if (!old.values.includes(v)) early.push({ kind: "add_enum_value", name: e.name, value: v });
      for (const v of old.values)
        if (!e.values.includes(v))
          warnings.push(
            `enum ${e.name}: value ${v} was removed from the model; PostgreSQL cannot drop enum values, it stays in the type`
          );
    }
  }

  const matchedPrev = new Set<string>();

  for (const entity of next.entities) {
    const prevEntity = prevEntities.find(p => p.name === oldNameOf(entity.name));
    if (!prevEntity) {
      tables.push({ kind: "create_table", entity });
      for (const fk of entity.foreignKeys) adds.push({ kind: "add_foreign_key", table: entity.table, fk });
      for (const idx of entity.indexes) adds.push({ kind: "create_index", table: entity.table, ...idx });
      continue;
    }
    matchedPrev.add(prevEntity.name);
    if (prevEntity.table !== entity.table)
      early.push({ kind: "rename_table", from: prevEntity.table, to: entity.table });
    const table = entity.table;

    const matchedPrevColumns = new Set<string>();
    for (const column of entity.columns) {
      const prevColumn = prevEntity.columns.find(c => c.name === oldFieldOf(entity.name, column.name));
      if (!prevColumn) {
        alters.push({ kind: "add_column", table, column });
        if (!column.nullable && column.default === undefined && !column.generated && !column.primary)
          warnings.push(
            `${table}.${column.name} is added NOT NULL without a default; the migration fails if the table has rows`
          );
        continue;
      }
      matchedPrevColumns.add(prevColumn.name);
      if (prevColumn.name !== column.name)
        early.push({ kind: "rename_column", table, from: prevColumn.name, to: column.name });
      if (sqlType(prevColumn) !== sqlType(column)) alters.push({ kind: "alter_column_type", table, column });
      if (prevColumn.nullable !== column.nullable)
        alters.push({ kind: "set_not_null", table, column: column.name, notNull: !column.nullable });
      if (JSON.stringify(prevColumn.default ?? null) !== JSON.stringify(column.default ?? null))
        alters.push({ kind: "set_default", table, column });
      if (prevColumn.unique !== column.unique) {
        const name = `${table}_${column.name}_key`;
        if (column.unique) adds.push({ kind: "add_unique", table, name, columns: [column.name] });
        else dropsConstraints.push({ kind: "drop_constraint", table, name });
      }
    }
    for (const prevColumn of prevEntity.columns) {
      if (!matchedPrevColumns.has(prevColumn.name))
        dropsColumns.push({ kind: "drop_column", table, column: prevColumn.name });
    }

    // Foreign keys by column: drop changed or removed, add new or changed
    for (const fk of entity.foreignKeys) {
      const prevFk = prevEntity.foreignKeys.find(p => p.column === oldFieldOf(entity.name, fk.column));
      if (!prevFk) adds.push({ kind: "add_foreign_key", table, fk });
      else if (
        prevFk.targetTable !== fk.targetTable ||
        prevFk.targetColumn !== fk.targetColumn ||
        prevFk.onDelete !== fk.onDelete ||
        prevFk.name !== fk.name
      ) {
        dropsConstraints.push({ kind: "drop_constraint", table, name: prevFk.name });
        adds.push({ kind: "add_foreign_key", table, fk });
      }
    }
    for (const prevFk of prevEntity.foreignKeys) {
      const stillThere = entity.foreignKeys.some(fk => oldFieldOf(entity.name, fk.column) === prevFk.column);
      const columnDropped = !entity.columns.some(c => oldFieldOf(entity.name, c.name) === prevFk.column);
      if (!stillThere && !columnDropped) dropsConstraints.push({ kind: "drop_constraint", table, name: prevFk.name });
    }

    // Multi-column uniques and indexes by name
    for (const u of entity.uniques) {
      const prevU = prevEntity.uniques.find(p => p.name === u.name);
      if (!prevU) adds.push({ kind: "add_unique", table, name: u.name, columns: u.columns });
    }
    for (const prevU of prevEntity.uniques) {
      if (!entity.uniques.some(u => u.name === prevU.name))
        dropsConstraints.push({ kind: "drop_constraint", table, name: prevU.name });
    }
    for (const idx of entity.indexes) {
      const prevIdx = prevEntity.indexes.find(p => p.name === idx.name);
      if (!prevIdx) adds.push({ kind: "create_index", table, ...idx });
      else if (prevIdx.unique !== idx.unique || prevIdx.columns.join(",") !== idx.columns.join(",")) {
        dropsConstraints.push({ kind: "drop_index", name: idx.name });
        adds.push({ kind: "create_index", table, ...idx });
      }
    }
    for (const prevIdx of prevEntity.indexes) {
      const columnsDropped = prevIdx.columns.some(
        c => !entity.columns.some(n => oldFieldOf(entity.name, n.name) === c)
      );
      if (!entity.indexes.some(i => i.name === prevIdx.name) && !columnsDropped)
        dropsConstraints.push({ kind: "drop_index", name: prevIdx.name });
    }
  }

  for (const prevEntity of prevEntities) {
    if (!matchedPrev.has(prevEntity.name)) {
      for (const fk of prevEntity.foreignKeys)
        dropsConstraints.push({ kind: "drop_constraint", table: prevEntity.table, name: fk.name });
      late.push({ kind: "drop_table", table: prevEntity.table });
    }
  }
  for (const old of prevEnums) {
    if (!next.enums.some(e => e.name === old.name)) late.push({ kind: "drop_enum", name: old.name });
  }

  const steps = [...early, ...tables, ...alters, ...dropsConstraints, ...dropsColumns, ...adds, ...late];
  return { steps, warnings, rewrites: steps.filter(step => isRewrite(step, next)) };
}

export function sqlType(column: ColumnIR): string {
  return typeSql(column.type, column.maxLength);
}

function typeSql(type: TypeIR, maxLength?: number): string {
  switch (type.kind) {
    case "enum":
      return quoteIdent(type.name);
    case "array":
      return `${scalarSql(type.of)}[]`;
    case "file":
      return "jsonb";
    case "scalar":
      return scalarSql(type.scalar, maxLength);
  }
}

function scalarSql(scalar: string, maxLength?: number): string {
  switch (scalar) {
    case "string":
      return `varchar(${maxLength ?? 255})`;
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
      return "time";
    case "uuid":
      return "uuid";
    case "json":
      return "jsonb";
    case "bytes":
      return "bytea";
    default:
      throw new Error(`no SQL type for ${scalar}`);
  }
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string | number | boolean): string {
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return `'${value.replace(/'/g, "''")}'`;
}

function defaultSql(column: ColumnIR): string | undefined {
  const d = column.default;
  if (!d) return undefined;
  if (d.kind === "now") return "now()";
  if (d.kind === "uuid") return "gen_random_uuid()";
  if (column.type.kind === "scalar" && column.type.scalar === "json") return `${quoteLiteral(String(d.value))}::jsonb`;
  return quoteLiteral(d.value);
}

function columnDefinition(column: ColumnIR, inCreate: boolean): string {
  const parts = [quoteIdent(column.name), sqlType(column)];
  if (column.generated === "identity") parts.push("GENERATED ALWAYS AS IDENTITY");
  if (!column.nullable) parts.push("NOT NULL");
  const def = defaultSql(column);
  if (def) parts.push(`DEFAULT ${def}`);
  if (inCreate && column.unique) parts.push("UNIQUE");
  return parts.join(" ");
}

/** Render a plan as PostgreSQL. Statements are separated by a blank line; each ends with a semicolon. */
export function renderPostgres(plan: MigrationPlan): string {
  const out: string[] = [];
  for (const step of plan.steps) {
    switch (step.kind) {
      case "create_enum":
        out.push(`CREATE TYPE ${quoteIdent(step.name)} AS ENUM (${step.values.map(quoteLiteral).join(", ")});`);
        break;
      case "add_enum_value":
        out.push(`ALTER TYPE ${quoteIdent(step.name)} ADD VALUE IF NOT EXISTS ${quoteLiteral(step.value)};`);
        break;
      case "drop_enum":
        out.push(`DROP TYPE ${quoteIdent(step.name)};`);
        break;
      case "rename_table":
        out.push(`ALTER TABLE ${quoteIdent(step.from)} RENAME TO ${quoteIdent(step.to)};`);
        break;
      case "rename_column":
        out.push(
          `ALTER TABLE ${quoteIdent(step.table)} RENAME COLUMN ${quoteIdent(step.from)} TO ${quoteIdent(step.to)};`
        );
        break;
      case "create_table": {
        const e = step.entity;
        const lines = e.columns.map(c => `  ${columnDefinition(c, true)}`);
        lines.push(`  PRIMARY KEY (${e.primaryKey.map(quoteIdent).join(", ")})`);
        for (const u of e.uniques)
          lines.push(`  CONSTRAINT ${quoteIdent(u.name)} UNIQUE (${u.columns.map(quoteIdent).join(", ")})`);
        out.push(`CREATE TABLE ${quoteIdent(e.table)} (\n${lines.join(",\n")}\n);`);
        break;
      }
      case "add_column":
        out.push(`ALTER TABLE ${quoteIdent(step.table)} ADD COLUMN ${columnDefinition(step.column, false)};`);
        if (step.column.unique)
          out.push(
            `ALTER TABLE ${quoteIdent(step.table)} ADD CONSTRAINT ${quoteIdent(`${step.table}_${step.column.name}_key`)} UNIQUE (${quoteIdent(step.column.name)});`
          );
        break;
      case "alter_column_type":
        out.push(
          `ALTER TABLE ${quoteIdent(step.table)} ALTER COLUMN ${quoteIdent(step.column.name)} TYPE ${sqlType(step.column)} USING ${quoteIdent(step.column.name)}::${sqlType(step.column)};`
        );
        break;
      case "set_not_null":
        out.push(
          `ALTER TABLE ${quoteIdent(step.table)} ALTER COLUMN ${quoteIdent(step.column)} ${step.notNull ? "SET" : "DROP"} NOT NULL;`
        );
        break;
      case "set_default": {
        const def = defaultSql(step.column);
        out.push(
          `ALTER TABLE ${quoteIdent(step.table)} ALTER COLUMN ${quoteIdent(step.column.name)} ${def ? `SET DEFAULT ${def}` : "DROP DEFAULT"};`
        );
        break;
      }
      case "drop_column":
        out.push(`ALTER TABLE ${quoteIdent(step.table)} DROP COLUMN ${quoteIdent(step.column)};`);
        break;
      case "add_unique":
        out.push(
          `ALTER TABLE ${quoteIdent(step.table)} ADD CONSTRAINT ${quoteIdent(step.name)} UNIQUE (${step.columns.map(quoteIdent).join(", ")});`
        );
        break;
      case "drop_constraint":
        out.push(`ALTER TABLE ${quoteIdent(step.table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(step.name)};`);
        break;
      case "add_foreign_key": {
        const fk = step.fk;
        const action = fk.onDelete === "set_null" ? "SET NULL" : fk.onDelete.toUpperCase();
        out.push(
          `ALTER TABLE ${quoteIdent(step.table)} ADD CONSTRAINT ${quoteIdent(fk.name)} FOREIGN KEY (${quoteIdent(fk.column)}) REFERENCES ${quoteIdent(fk.targetTable)} (${quoteIdent(fk.targetColumn)}) ON DELETE ${action};`
        );
        break;
      }
      case "create_index":
        out.push(
          `CREATE ${step.unique ? "UNIQUE " : ""}INDEX ${quoteIdent(step.name)} ON ${quoteIdent(step.table)} (${step.columns.map(quoteIdent).join(", ")});`
        );
        break;
      case "drop_index":
        out.push(`DROP INDEX IF EXISTS ${quoteIdent(step.name)};`);
        break;
      case "drop_table":
        out.push(`DROP TABLE ${quoteIdent(step.table)};`);
        break;
    }
  }
  return out.join("\n\n") + "\n";
}

/** One SQL file per applied revision; a pure function of the revision history. Shared by every backend. */
export function migrationFiles(
  revisions: { rev: number; intent: string; summary?: string; renames: Renames; ir: IR }[],
  dir: string
): { files: { path: string; content: string }[]; warnings: string[] } {
  const files: { path: string; content: string }[] = [];
  const warnings: string[] = [];
  let prev: IR | null = null;
  for (const revision of revisions) {
    const plan = planMigration(prev, revision.ir, revision.renames);
    for (const w of plan.warnings) warnings.push(`${revision.intent}: ${w}`);
    if (plan.steps.length > 0) {
      const name = `${String(revision.rev).padStart(4, "0")}_${slugify(revision.intent)}.sql`;
      const header = `-- OSL migration ${revision.rev}: ${revision.intent}${revision.summary ? ` (${revision.summary})` : ""}\n-- Generated from the model history. Do not edit after it has been applied.\n\n`;
      files.push({ path: `${dir}/${name}`, content: header + renderPostgres(plan) });
    }
    prev = revision.ir;
  }
  return { files, warnings };
}
