/**
 * Migrations are a pure function of two consecutive IRs plus the renames recorded
 * between them. The same history always renders the same SQL.
 */
import type { Renames } from "./diff.js";
import { slugify } from "./naming.js";
import type { ColumnIR, EntityIR, IR, TenantKeyIR, TypeIR } from "./ir.js";
import { isolationObjects } from "./isolation.js";

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
  | { kind: "drop_table"; table: string }
  /** Fill a derived tenant column of a table that has rows from the parent each row points at */
  | {
      kind: "backfill_tenant";
      table: string;
      column: string;
      through: string;
      parent: string;
      parentKey: string;
      parentColumn: string;
    }
  /** A composite key: (tenant, relation) to the parent's (tenant, key) */
  | { kind: "add_tenant_key"; table: string; key: TenantKeyIR }
  /** Statements of the isolation layer (roles and grants, functions, triggers, row security, policies), made or dropped whole */
  | { kind: "sql"; about: string; statements: string[] };

export interface MigrationPlan {
  steps: MigrationStep[];
  warnings: string[];
  /** Steps that rewrite every row of a table: a type change, or NOT NULL on a column without a default */
  rewrites: MigrationStep[];
}

/** Whether a step rewrites its table rather than adding to it */
export function isRewrite(step: MigrationStep, next: IR): boolean {
  if (step.kind === "alter_column_type" || step.kind === "backfill_tenant") return true;
  if (step.kind === "set_not_null" && step.notNull) {
    const entity = next.entities.find(e => e.table === step.table);
    // A derived tenant column is filled by the backfill step before it; that step is the rewrite
    if (entity?.tenant?.derived?.column.name === step.column) return false;
    const column = entity?.columns.find(c => c.name === step.column);
    return column?.default === undefined;
  }
  return false;
}

const EMPTY_RENAMES: Renames = { entities: {}, fields: {} };

/** The columns a table has: the entity's, and under isolation: database the tenant column the compiler derives */
export function physicalColumns(entity: EntityIR): ColumnIR[] {
  return entity.tenant?.derived ? [...entity.columns, entity.tenant.derived.column] : entity.columns;
}

function physicalUniques(entity: EntityIR): EntityIR["uniques"] {
  return entity.tenant?.unique ? [...entity.uniques, entity.tenant.unique] : entity.uniques;
}

function physicalIndexes(entity: EntityIR): EntityIR["indexes"] {
  return entity.tenant?.derived ? [...entity.indexes, entity.tenant.derived.index] : entity.indexes;
}

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
  const backfills: MigrationStep[] = []; // derived tenant columns of tables that have rows
  const dropsKeys: MigrationStep[] = []; // composite tenant keys, before the uniques they point at
  const addsKeys: MigrationStep[] = []; // composite tenant keys, after the uniques they point at

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
      for (const idx of physicalIndexes(entity)) adds.push({ kind: "create_index", table: entity.table, ...idx });
      for (const key of entity.tenant?.keys ?? []) addsKeys.push({ kind: "add_tenant_key", table: entity.table, key });
      continue;
    }
    matchedPrev.add(prevEntity.name);
    if (prevEntity.table !== entity.table)
      early.push({ kind: "rename_table", from: prevEntity.table, to: entity.table });
    const table = entity.table;

    const matchedPrevColumns = new Set<string>();
    const derived = entity.tenant?.derived;
    for (const column of physicalColumns(entity)) {
      const prevColumn = physicalColumns(prevEntity).find(c => c.name === oldFieldOf(entity.name, column.name));
      if (!prevColumn && derived && column === derived.column) {
        // The table has rows: the column arrives nullable, is filled from each row's parent, then becomes NOT NULL
        alters.push({ kind: "add_column", table, column: { ...column, nullable: true } });
        backfills.push({
          kind: "backfill_tenant",
          table,
          column: column.name,
          through: derived.through,
          parent: derived.parentTable,
          parentKey: derived.parentKey,
          parentColumn: derived.parentColumn
        });
        backfills.push({ kind: "set_not_null", table, column: column.name, notNull: true });
        continue;
      }
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
    for (const prevColumn of physicalColumns(prevEntity)) {
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

    // Composite tenant keys by name: a key whose definition changed is dropped and added again
    const prevKeys = prevEntity.tenant?.keys ?? [];
    for (const key of entity.tenant?.keys ?? []) {
      const prevKey = prevKeys.find(p => p.name === key.name);
      if (prevKey && JSON.stringify(prevKey) === JSON.stringify(key)) continue;
      if (prevKey) dropsKeys.push({ kind: "drop_constraint", table, name: prevKey.name });
      addsKeys.push({ kind: "add_tenant_key", table, key });
    }
    for (const prevKey of prevKeys)
      if (!(entity.tenant?.keys ?? []).some(k => k.name === prevKey.name))
        dropsKeys.push({ kind: "drop_constraint", table, name: prevKey.name });

    // Multi-column uniques and indexes by name
    for (const u of physicalUniques(entity)) {
      const prevU = physicalUniques(prevEntity).find(p => p.name === u.name);
      if (!prevU) adds.push({ kind: "add_unique", table, name: u.name, columns: u.columns });
    }
    for (const prevU of physicalUniques(prevEntity)) {
      if (!physicalUniques(entity).some(u => u.name === prevU.name))
        dropsConstraints.push({ kind: "drop_constraint", table, name: prevU.name });
    }
    for (const idx of physicalIndexes(entity)) {
      const prevIdx = physicalIndexes(prevEntity).find(p => p.name === idx.name);
      if (!prevIdx) adds.push({ kind: "create_index", table, ...idx });
      else if (prevIdx.unique !== idx.unique || prevIdx.columns.join(",") !== idx.columns.join(",")) {
        dropsConstraints.push({ kind: "drop_index", name: idx.name });
        adds.push({ kind: "create_index", table, ...idx });
      }
    }
    for (const prevIdx of physicalIndexes(prevEntity)) {
      const columnsDropped = prevIdx.columns.some(
        c => !physicalColumns(entity).some(n => oldFieldOf(entity.name, n.name) === c)
      );
      if (!physicalIndexes(entity).some(i => i.name === prevIdx.name) && !columnsDropped)
        dropsConstraints.push({ kind: "drop_index", name: prevIdx.name });
    }
  }

  for (const prevEntity of prevEntities) {
    if (!matchedPrev.has(prevEntity.name)) {
      for (const fk of prevEntity.foreignKeys)
        dropsConstraints.push({ kind: "drop_constraint", table: prevEntity.table, name: fk.name });
      for (const key of prevEntity.tenant?.keys ?? [])
        dropsKeys.push({ kind: "drop_constraint", table: prevEntity.table, name: key.name });
      late.push({ kind: "drop_table", table: prevEntity.table });
    }
  }
  for (const old of prevEnums) {
    if (!next.enums.some(e => e.name === old.name)) late.push({ kind: "drop_enum", name: old.name });
  }

  // A derived column copies its parent's, so a parent filled in this same plan is filled first
  const ordered: MigrationStep[] = [];
  const pendingFills = backfills.filter(
    (s): s is Extract<MigrationStep, { kind: "backfill_tenant" }> => s.kind === "backfill_tenant"
  );
  while (pendingFills.length) {
    const index = pendingFills.findIndex(s => !pendingFills.some(o => o !== s && o.table === s.parent));
    const [step] = pendingFills.splice(index < 0 ? 0 : index, 1);
    ordered.push(step, backfills.find(s => s.kind === "set_not_null" && s.table === step.table)!);
  }

  // The isolation layer: what is gone or defined differently is dropped before anything is renamed or removed,
  // and what is new or defined differently is made once the tables are in their final shape
  const before = prev ? isolationObjects(prev) : [];
  const after = isolationObjects(next);
  const beforeByKey = new Map(before.map(o => [o.key, o]));
  const afterByKey = new Map(after.map(o => [o.key, o]));
  const remade = new Set<string>();
  for (const object of after) {
    const old = beforeByKey.get(object.key);
    if (old && JSON.stringify(old.create) !== JSON.stringify(object.create)) remade.add(object.key);
  }
  // PostgreSQL refuses to change the type of a column a policy reads: the table's policies are made again around it
  for (const step of alters)
    if (step.kind === "alter_column_type")
      for (const object of after)
        if (object.kind === "policy" && object.table === step.table && beforeByKey.has(object.key))
          remade.add(object.key);
  for (let grew = true; grew; ) {
    grew = false;
    for (const object of after)
      if (!remade.has(object.key) && beforeByKey.has(object.key) && object.uses?.some(k => remade.has(k))) {
        remade.add(object.key);
        grew = true;
      }
  }
  const isolationDrops: MigrationStep[] = before
    .filter(o => o.drop.length && (!afterByKey.has(o.key) || remade.has(o.key)))
    .reverse()
    .map(o => ({ kind: "sql", about: `drop ${o.kind} ${o.name}`, statements: o.drop }));
  const isolationAdds: MigrationStep[] = after
    .filter(o => !beforeByKey.has(o.key) || remade.has(o.key))
    .map(o => ({ kind: "sql", about: `${o.kind} ${o.name}`, statements: o.create }));

  const steps = [
    ...isolationDrops,
    ...early,
    ...tables,
    ...alters,
    ...ordered,
    ...dropsKeys,
    ...dropsConstraints,
    ...dropsColumns,
    ...adds,
    ...addsKeys,
    ...late,
    ...isolationAdds
  ];
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
        const lines = physicalColumns(e).map(c => `  ${columnDefinition(c, true)}`);
        lines.push(`  PRIMARY KEY (${e.primaryKey.map(quoteIdent).join(", ")})`);
        for (const u of physicalUniques(e))
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
      case "backfill_tenant":
        out.push(
          `UPDATE ${quoteIdent(step.table)} AS child SET ${quoteIdent(step.column)} = parent.${quoteIdent(step.parentColumn)} FROM ${quoteIdent(step.parent)} AS parent WHERE parent.${quoteIdent(step.parentKey)} = child.${quoteIdent(step.through)};`
        );
        break;
      case "add_tenant_key": {
        const key = step.key;
        // A parent that changes tenant takes the rows derived from it along; set null clears the relation, never the tenant
        const onDelete =
          key.onDelete === "set_null" ? `SET NULL (${quoteIdent(key.columns[1])})` : key.onDelete.toUpperCase();
        out.push(
          `ALTER TABLE ${quoteIdent(step.table)} ADD CONSTRAINT ${quoteIdent(key.name)} FOREIGN KEY (${key.columns.map(quoteIdent).join(", ")}) REFERENCES ${quoteIdent(key.targetTable)} (${key.targetColumns.map(quoteIdent).join(", ")})${key.cascade ? " ON UPDATE CASCADE" : ""} ON DELETE ${onDelete};`
        );
        break;
      }
      case "sql":
        out.push(...step.statements);
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
