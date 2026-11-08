import type { EntityIR, IR, RowRuleIR, RuleHopIR, RuleIR } from "@osl/core";
import { ruleAlternatives, ruleKey, rowRules } from "@osl/core";
import { entityByName, q, tableExport, typeName } from "./conventions.js";

/** `memberships` on the session, when the model has tenancy */
export function membershipType(ir: IR): string {
  void ir;
  return "{ tenant: string | number; role: string }[]";
}

/**
 * The rule evaluation both backends share: a verdict function and the tenant ids a session may act in.
 * The backend wraps `verdict` in its own way of denying (a Response or a thrown error).
 */
export function verdictSource(ir: IR): string {
  const pk = ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
  const roles = ir.auth?.tenancy?.roles ?? [];
  return `/** A rule from the model. \`field\` is a column, or the dotted path of a value reached through relations. */
export type Rule =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "none" }
  | { kind: "owner"; field: string }
  | { kind: "role"; value: string }
  | { kind: "member"; field: string; role?: string }
  | { kind: "any"; rules: Rule[] };

export type Verdict = { ok: true } | { ok: false; status: 401 | 403 };

const ALLOW: Verdict = { ok: true };

/** Membership roles from most to least privileged */
const ROLES: string[] = [${roles.map(q).join(", ")}];

function rank(role: string): number {
  const index = ROLES.indexOf(role);
  return index < 0 ? ROLES.length : index;
}

/** The tenants the session's user belongs to, with at least \`role\` when given */
export function memberTenantIds(session: Session | null, role?: string): (string | number)[] {
  return (session?.memberships ?? [])
    .filter(m => role === undefined || rank(m.role) <= rank(role))
    .map(m => m.tenant);
}

/** Whether the rule allows this session whatever the row, so a list under it needs no row filter. */
export function satisfied(rule: Rule, session: Session | null): boolean {
  switch (rule.kind) {
    case "public":
      return true;
    case "authenticated":
      return session !== null;
    case "role":
      return session !== null && (session.user as Record<string, unknown>).role === rule.value;
    case "any":
      return rule.rules.some(alternative => satisfied(alternative, session));
    default:
      return false;
  }
}

/**
 * Check a rule for a session and, when the rule is about a row, that row (or the body of a create). A rule
 * with alternatives allows when any of them does; otherwise it answers 401 when every alternative did.
 */
export function verdict(rule: Rule, session: Session | null, row?: Record<string, unknown> | null): Verdict {
  switch (rule.kind) {
    case "any": {
      let status: 401 | 403 = 401;
      for (const alternative of rule.rules) {
        const result = verdict(alternative, session, row);
        if (result.ok) return ALLOW;
        if (result.status !== 401) status = 403;
      }
      return { ok: false, status };
    }
    case "public":
      return ALLOW;
    case "none":
      return { ok: false, status: 403 };
    case "authenticated":
      return session ? ALLOW : { ok: false, status: 401 };
    case "owner":
      if (!session) return { ok: false, status: 401 };
      if (row && row[rule.field] !== session.user.${pk}) return { ok: false, status: 403 };
      return ALLOW;
    case "role":
      if (!session) return { ok: false, status: 401 };
      return (session.user as Record<string, unknown>).role === rule.value ? ALLOW : { ok: false, status: 403 };
    case "member": {
      if (!session) return { ok: false, status: 401 };
      if (!row) return ALLOW;
      const tenant = row[rule.field];
      return memberTenantIds(session, rule.role).some(id => id === tenant) ? ALLOW : { ok: false, status: 403 };
    }
  }
}`;
}

/** Drizzle code loading a user's memberships for the session, as `{ tenant, role }[]` */
export function membershipsLoader(ir: IR, userExpr: string): string {
  const t = ir.auth?.tenancy;
  if (!t) return "[]";
  const table = `${tableExport(entityByName(ir, t.membership))}`;
  return `(await db.query.${table}.findMany({ where: eq(${table}Table.${t.userColumn}, ${userExpr}) })).map(m => ({ tenant: m.${t.tenantColumn}, role: m.${t.roleColumn} }))`;
}

/** The runtime shape of a rule for the generated code: alternatives kept, a path flattened to its dotted key */
export function runtimeRule(rule: RuleIR): unknown {
  switch (rule.kind) {
    case "owner":
      return { kind: "owner", field: ruleKey(rule) };
    case "member":
      return rule.role
        ? { kind: "member", field: ruleKey(rule), role: rule.role }
        : { kind: "member", field: ruleKey(rule) };
    case "any":
      return { kind: "any", rules: rule.rules.map(runtimeRule) };
    default:
      return rule;
  }
}

/** The TypeScript literal of a rule as the generated access module reads it */
export function ruleLiteral(rule: RuleIR): string {
  return JSON.stringify(runtimeRule(rule));
}

/** Whether checking this rule against a row needs values reached through relations */
export function hasVia(rule: RuleIR): boolean {
  return rowRules(rule).some(r => Boolean(r.via?.length));
}

/** The entities a rule reaches through relations, whose tables the generated module must import */
export function ruleEntities(rule: RuleIR): string[] {
  return [...new Set(rowRules(rule).flatMap(r => (r.via ?? []).map(h => h.entity)))];
}

/** How a generated module names things when it filters a list by its rule */
export interface ListFilterOptions {
  /** The rule's variable, e.g. RULES.read */
  ruleRef: string;
  /** Expression of the session */
  session: string;
  /** Expression of the signed-in user's id */
  me: string;
  /** Statement answering the empty page (with return) */
  empty: string;
  /** The Drizzle table variable of an entity */
  tableVar: (entity: EntityIR) => string;
  /** The cast of tenant ids for inArray, e.g. "as string[]" */
  tenantCast: string;
  /** Indentation of the emitted lines */
  indent: string;
}

export interface ListFilter {
  lines: string[];
  /** drizzle-orm imports the lines use */
  drizzle: Set<string>;
  /** access module imports the lines use */
  access: Set<string>;
  /** Entities whose tables the lines use, beyond the listed one */
  tables: Set<string>;
}

/**
 * The lines that narrow a list to the rows its rule allows the session to see: an owner rule filters by the
 * owner column, a member rule by the session's tenants, a path through a relation becomes a subquery, and
 * alternatives are joined with OR unless one of them allows the session without a row.
 */
export function listRuleFilter(ir: IR, entity: EntityIR, rule: RuleIR, o: ListFilterOptions): ListFilter {
  const out: ListFilter = { lines: [], drizzle: new Set(), access: new Set(), tables: new Set() };
  const rows = rowRules(rule);
  if (rows.length === 0) return out;
  const table = o.tableVar(entity);
  const tenantsOf = (r: RowRuleIR) =>
    `memberTenantIds(${o.session}, ${r.kind === "member" && r.role ? q(r.role) : "undefined"})`;
  const last = (r: RowRuleIR, t: string, tenants: string) => {
    if (r.kind === "owner") {
      out.drizzle.add("eq");
      return `eq(${t}.${r.field}, ${o.me})`;
    }
    out.drizzle.add("inArray");
    return `inArray(${t}.${r.field}, ${tenants} ${o.tenantCast})`;
  };
  /** The condition on the listed table, following the hops with nested subqueries */
  const condition = (r: RowRuleIR, tenants: string): string => {
    const hops = r.via ?? [];
    if (hops.length === 0) return last(r, table, tenants);
    const inner = (i: number): string => {
      const hop = hops[i];
      const hopEntity = entityByName(ir, hop.entity);
      const t = o.tableVar(hopEntity);
      out.tables.add(hop.entity);
      out.drizzle.add("inArray");
      const where = i + 1 < hops.length ? `inArray(${t}.${hops[i + 1].column}, ${inner(i + 1)})` : last(r, t, tenants);
      return `db.select({ id: ${t}.${hop.targetColumn} }).from(${t}).where(${where})`;
    };
    return `inArray(${table}.${hops[0].column}, ${inner(0)})`;
  };
  const single = ruleAlternatives(rule).length === 1;
  const ind = o.indent;
  if (single) {
    const r = rows[0];
    if (r.kind === "member") {
      out.access.add("memberTenantIds");
      out.lines.push(`${ind}const tenants = ${tenantsOf(r)};`, `${ind}if (tenants.length === 0) ${o.empty}`);
      out.lines.push(`${ind}conditions.push(${condition(r, "tenants")});`);
    } else out.lines.push(`${ind}conditions.push(${condition(r, "tenants")});`);
    return out;
  }
  out.access.add("satisfied");
  out.lines.push(`${ind}if (!satisfied(${o.ruleRef}, ${o.session})) {`);
  out.lines.push(`${ind}  const alternatives: SQL[] = [];`);
  let memberCount = 0;
  for (const r of rows) {
    if (r.kind === "owner") out.lines.push(`${ind}  alternatives.push(${condition(r, "")});`);
    else {
      out.access.add("memberTenantIds");
      const name = memberCount === 0 ? "tenants" : `tenants${memberCount + 1}`;
      memberCount++;
      out.lines.push(`${ind}  const ${name} = ${tenantsOf(r)};`);
      out.lines.push(`${ind}  if (${name}.length > 0) alternatives.push(${condition(r, name)});`);
    }
  }
  out.lines.push(`${ind}  if (alternatives.length === 0) ${o.empty}`);
  out.drizzle.add("or");
  out.lines.push(`${ind}  conditions.push(alternatives.length === 1 ? alternatives[0] : or(...alternatives)!);`);
  out.lines.push(`${ind}}`);
  return out;
}

/**
 * The source of \`withRuleValues\`, which adds to a row (or a create body) the values its rules reach through
 * relations, under their dotted keys, so the access module can check them; null when no rule has a path.
 */
export function ruleValuesSource(
  ir: IR,
  rules: RuleIR[],
  tableVar: (entity: EntityIR) => string
): { source: string; tables: Set<string> } | null {
  const paths = new Map<string, RowRuleIR>();
  for (const rule of rules) for (const r of rowRules(rule)) if (r.via?.length) paths.set(ruleKey(r), r);
  if (paths.size === 0) return null;
  const tables = new Set<string>();
  const blocks: string[] = [];
  for (const [key, r] of paths) {
    const hops = r.via as RuleHopIR[];
    const steps = hops.map((hop, i) => {
      const hopEntity = entityByName(ir, hop.entity);
      const t = tableVar(hopEntity);
      tables.add(hop.entity);
      const next = i + 1 < hops.length ? hops[i + 1].column : r.field;
      const idType = `schema.${typeName(hopEntity)}["${hop.targetColumn}"]`;
      return `    if (value != null) value = (await db.select({ v: ${t}.${next} }).from(${t}).where(eq(${t}.${hop.targetColumn}, value as ${idType})))[0]?.v ?? null;`;
    });
    blocks.push(`  {
    let value: unknown = row.${hops[0].column};
${steps.join("\n")}
    out[${q(key)}] = value;
  }`);
  }
  return {
    source: `/** The row (or create body) with the values its rules reach through relations, under their dotted keys */
async function withRuleValues(row: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...row };
${blocks.join("\n")}
  return out;
}`,
    tables
  };
}

/** Whether a create must check the rule against the body: a member or a path alternative reads the related row */
export function needsBodyCheck(rule: RuleIR): boolean {
  return rowRules(rule).some(r => r.kind === "member" || Boolean(r.via?.length));
}

/** The expression the generated code hands to checkRule for a row (or body): resolved through relations when needed */
export function rowArg(rule: RuleIR, expr: string): string {
  return hasVia(rule) ? `await withRuleValues(${expr})` : expr;
}
