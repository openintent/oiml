/**
 * The database side of `auth.tenancy.isolation: database`: every object the backstop is made of, as a pure
 * function of the IR. Migrations create and drop them, the drift check compares them with the live database.
 *
 * - a role the web process connects as, granted the tables and bound by every policy;
 * - on each tenant table, row-level security with one policy for all commands (the row's tenant is among the
 *   tenants the request bound) and, where the read rule has public alternatives, a second policy for SELECT only;
 * - a trigger that keeps a derived tenant column equal to the parent's;
 * - functions that see past the policies, each for one named thing: a user's memberships (read before any tenant is
 *   bound), whether a row exists (so another tenant's row answers as the rule says and not as a missing row), and
 *   the value a public alternative tests on a row of another table.
 *
 * Row security is enabled, not forced: the tables' owner (the role that migrates, and that the worker and the
 * functions above run as) is not bound, so it need not be a superuser.
 */
import {
  alternativeParts,
  sessionFreeAlternatives,
  type EntityIR,
  type IR,
  type IsolationIR,
  type RuleConditionIR
} from "./ir.js";
import { quoteIdent, quoteLiteral, sqlType } from "./migrations.js";

export interface IsolationObject {
  /** `constraint` is an ordered collection's (order.ts), which shares the planner and the drift check with this layer */
  kind: "role" | "grant" | "function" | "trigger" | "rls" | "policy" | "constraint";
  /** What the planner matches between two revisions and the drift check with the database */
  key: string;
  name: string;
  table?: string;
  create: string[];
  /** Empty for the role, which belongs to the cluster and is never dropped by a migration */
  drop: string[];
  /** Keys of the objects this one's definition calls, so that it is made again when one of them is */
  uses?: string[];
  /** A policy's command and expression, as the drift check compares them */
  policy?: { command: "ALL" | "SELECT"; using: string };
  /** A function's body and whether it runs with its owner's rights */
  body?: { source: string; definer: boolean };
}

const DEFINER = "SECURITY DEFINER SET search_path = public, pg_temp";

/** The comparison a condition makes, on an SQL expression: a null literal tests for null, `!=` also holds for null */
function comparison(expression: string, when: RuleConditionIR): string {
  if (when.value === null) return `${expression} IS ${when.op === "eq" ? "" : "NOT "}NULL`;
  return `${expression} ${when.op === "eq" ? "=" : "IS DISTINCT FROM"} ${quoteLiteral(when.value)}`;
}

/** The expression of a tenant table's public-read policy: its read rule's public alternatives, or null without one */
export function publicReadExpression(entity: EntityIR): string | null {
  const alternatives = sessionFreeAlternatives(entity.rules.read);
  if (!entity.tenant || alternatives.length === 0) return null;
  const sql = alternatives.map(alternative => {
    const parts = alternativeParts(alternative).flatMap(part => {
      if (part.kind !== "public" || !part.when) return [];
      const when = part.when;
      if (!when.via?.length) return [comparison(quoteIdent(when.column), when)];
      return [comparison(`${quoteIdent(when.reader!)}(${quoteIdent(when.via[0].column)})`, when)];
    });
    return parts.length === 0 ? "true" : parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
  });
  return sql.includes("true") ? "true" : sql.join(" OR ");
}

/** The expression every tenant policy tests: the row's tenant is one of those the request bound; unbound, no row */
export function tenantExpression(isolation: IsolationIR, column: string): string {
  return `${quoteIdent(column)} = ANY (NULLIF(current_setting(${quoteLiteral(isolation.setting)}, true), '')::${isolation.tenantType}[])`;
}

interface FunctionSpec {
  name: string;
  args: string[];
  returns: string;
  language: "sql" | "plpgsql";
  stable: boolean;
  body: string;
  /** Whether the app role calls it; a trigger function is called by the trigger alone */
  callable: boolean;
}

function functionObject(spec: FunctionSpec, role: string, uses: string[] = []): IsolationObject {
  const signature = `${quoteIdent(spec.name)}(${spec.args.join(", ")})`;
  const create = [
    `CREATE FUNCTION ${signature} RETURNS ${spec.returns}\nLANGUAGE ${spec.language}${spec.stable ? " STABLE" : ""} ${DEFINER}\nAS $$\n${spec.body}\n$$;`,
    `REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;`
  ];
  if (spec.callable) create.push(`GRANT EXECUTE ON FUNCTION ${signature} TO ${quoteIdent(role)};`);
  return {
    kind: "function",
    key: `function:${spec.name}`,
    name: spec.name,
    create,
    drop: [`DROP FUNCTION IF EXISTS ${signature};`],
    uses,
    body: { source: spec.body, definer: true }
  };
}

/** The readers a tenant table's public alternatives call: one per path, by the function's name */
function readers(ir: IR, entity: EntityIR): FunctionSpec[] {
  const out = new Map<string, FunctionSpec>();
  for (const alternative of sessionFreeAlternatives(entity.rules.read))
    for (const part of alternativeParts(alternative)) {
      if (part.kind !== "public" || !part.when?.via?.length || !part.when.reader) continue;
      const when = part.when;
      const reader = part.when.reader;
      const hops = when.via!;
      const first = entity.columns.find(c => c.name === hops[0].column)!;
      const last = ir.entities.find(e => e.name === hops[hops.length - 1].entity)!;
      const column = last.columns.find(c => c.name === when.column)!;
      // The value at the end of the path, for the key the row holds in its first relation
      let key = "$1";
      for (let i = 0; i + 1 < hops.length; i++)
        key = `(SELECT ${quoteIdent(hops[i + 1].column)} FROM ${quoteIdent(hops[i].table)} WHERE ${quoteIdent(hops[i].targetColumn)} = ${key})`;
      const final = hops[hops.length - 1];
      out.set(reader, {
        name: reader,
        args: [sqlType(first)],
        returns: sqlType(column),
        language: "sql",
        stable: true,
        body: `  SELECT ${quoteIdent(when.column)} FROM ${quoteIdent(final.table)} WHERE ${quoteIdent(final.targetColumn)} = ${key}`,
        callable: true
      });
    }
  return [...out.values()];
}

/**
 * Every object of the backstop in the order it is created; dropped in reverse. Empty without isolation.
 */
export function isolationObjects(ir: IR): IsolationObject[] {
  const tenancy = ir.auth?.tenancy;
  const isolation = tenancy?.isolation;
  if (!tenancy || !isolation) return [];
  const role = quoteIdent(isolation.appRole);
  const out: IsolationObject[] = [];

  out.push({
    kind: "role",
    key: `role:${isolation.appRole}`,
    name: isolation.appRole,
    create: [
      // Roles belong to the cluster, not the database: another database of this app may have made it already, or
      // be making it now (the exception), and an owner that may not create roles can be handed one made for it
      `DO $$ BEGIN\n  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${quoteLiteral(isolation.appRole)}) THEN\n    CREATE ROLE ${role} NOLOGIN;\n  END IF;\nEXCEPTION WHEN duplicate_object OR unique_violation THEN NULL;\nEND $$;`,
      `GRANT USAGE ON SCHEMA public TO ${role};`
    ],
    drop: []
  });
  for (const entity of ir.entities)
    out.push({
      kind: "grant",
      key: `grant:${entity.table}`,
      name: entity.table,
      table: entity.table,
      create: [`GRANT SELECT, INSERT, UPDATE, DELETE ON ${quoteIdent(entity.table)} TO ${role};`],
      drop: [`REVOKE ALL ON ${quoteIdent(entity.table)} FROM ${role};`]
    });

  const identity = ir.entities.find(e => e.name === ir.auth!.identity)!;
  const identityKey = identity.columns.find(c => c.name === identity.primaryKey[0])!;
  out.push(
    functionObject(
      {
        name: isolation.memberships,
        args: [sqlType(identityKey)],
        returns: `TABLE (tenant ${isolation.tenantType}, role text)`,
        language: "sql",
        stable: true,
        body: `  SELECT ${quoteIdent(tenancy.tenantColumn)}, ${quoteIdent(tenancy.roleColumn)}::text FROM ${quoteIdent(tenancy.membershipTable)} WHERE ${quoteIdent(tenancy.userColumn)} = $1`,
        callable: true
      },
      isolation.appRole
    )
  );

  const tenants = ir.entities.filter(e => e.tenant);
  for (const entity of tenants) {
    const tenant = entity.tenant!;
    if (tenant.exists) {
      const key = entity.columns.find(c => c.name === entity.primaryKey[0])!;
      out.push(
        functionObject(
          {
            name: tenant.exists,
            args: [sqlType(key)],
            returns: "boolean",
            language: "sql",
            stable: true,
            body: `  SELECT EXISTS (SELECT 1 FROM ${quoteIdent(entity.table)} WHERE ${quoteIdent(key.name)} = $1)`,
            callable: true
          },
          isolation.appRole
        )
      );
    }
    for (const reader of readers(ir, entity)) out.push(functionObject(reader, isolation.appRole));
    if (tenant.derived) {
      const d = tenant.derived;
      const through = quoteIdent(d.through);
      out.push(
        functionObject(
          {
            name: d.trigger,
            args: [],
            returns: "trigger",
            language: "plpgsql",
            stable: false,
            body: [
              "BEGIN",
              `  IF NEW.${through} IS NULL THEN RETURN NEW; END IF;`,
              `  SELECT ${quoteIdent(d.parentColumn)} INTO NEW.${quoteIdent(tenant.column)} FROM ${quoteIdent(d.parentTable)} WHERE ${quoteIdent(d.parentKey)} = NEW.${through};`,
              `  IF NOT FOUND THEN RAISE foreign_key_violation USING MESSAGE = ${quoteLiteral(`${entity.table}.${d.through} names a row of ${d.parentTable} that does not exist`)}; END IF;`,
              "  RETURN NEW;",
              "END"
            ].join("\n"),
            callable: false
          },
          isolation.appRole
        )
      );
    }
  }
  for (const entity of tenants) {
    const d = entity.tenant!.derived;
    if (!d) continue;
    const table = quoteIdent(entity.table);
    out.push({
      kind: "trigger",
      key: `trigger:${entity.table}`,
      name: "osl_tenant",
      table: entity.table,
      create: [
        `CREATE TRIGGER "osl_tenant" BEFORE INSERT OR UPDATE OF ${quoteIdent(d.through)} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${quoteIdent(d.trigger)}();`
      ],
      drop: [`DROP TRIGGER IF EXISTS "osl_tenant" ON ${table};`],
      uses: [`function:${d.trigger}`]
    });
  }
  for (const entity of tenants) {
    const table = quoteIdent(entity.table);
    out.push({
      kind: "rls",
      key: `rls:${entity.table}`,
      name: entity.table,
      table: entity.table,
      create: [`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`],
      drop: [`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`]
    });
    const using = tenantExpression(isolation, entity.tenant!.column);
    const name = `${entity.table}_tenant`;
    out.push({
      kind: "policy",
      key: `policy:${entity.table}:${name}`,
      name,
      table: entity.table,
      create: [`CREATE POLICY ${quoteIdent(name)} ON ${table} USING (${using});`],
      drop: [`DROP POLICY IF EXISTS ${quoteIdent(name)} ON ${table};`],
      policy: { command: "ALL", using }
    });
    const open = publicReadExpression(entity);
    if (open) {
      const readName = `${entity.table}_public_read`;
      out.push({
        kind: "policy",
        key: `policy:${entity.table}:${readName}`,
        name: readName,
        table: entity.table,
        create: [`CREATE POLICY ${quoteIdent(readName)} ON ${table} FOR SELECT USING (${open});`],
        drop: [`DROP POLICY IF EXISTS ${quoteIdent(readName)} ON ${table};`],
        uses: readers(ir, entity).map(r => `function:${r.name}`),
        policy: { command: "SELECT", using: open }
      });
    }
  }
  return out;
}

/** The tenant tables of an IR by table name, with what a probe of the unbound app role may still see on each */
export function tenantTables(ir: IR): { entity: EntityIR; publicRead: boolean }[] {
  return ir.entities
    .filter(e => e.tenant)
    .map(entity => ({ entity, publicRead: publicReadExpression(entity) !== null }));
}

/**
 * A policy expression reduced to what two spellings of it share: PostgreSQL stores an expression parsed and prints
 * it back with its own parentheses, casts and spacing, so the drift check compares these forms, not the text.
 */
export function canonicalExpression(sql: string): string {
  return sql
    .toLowerCase()
    .replace(
      /::(character varying|timestamp with(out)? time zone|time with(out)? time zone|double precision|"[^"]+"|[a-z_][a-z0-9_]*)(\(\d+(,\d+)?\))?(\[\])?/g,
      ""
    )
    .replace(/[\s()"]/g, "");
}
