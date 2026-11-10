import type {
  AlternativeIR,
  EntityIR,
  IR,
  PredicateIR,
  RowRuleIR,
  RuleConditionIR,
  RuleHopIR,
  RuleIR
} from "@osl/core";
import {
  alternativeParts,
  hasFieldRules,
  conditionKey,
  conditionedRules,
  rowDependentRules,
  ruleAlternatives,
  ruleKey,
  rulePaths,
  rowRules,
  ruleMemberships,
  type MembershipIR
} from "@osl/core";
import { entityByName, q, tableExport, typeName } from "./conventions.js";
import { isolationOf } from "./isolation.js";

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
  const isolated = Boolean(isolationOf(ir));
  // Under isolation: database the rule checks can be switched off by a test hook, so a walk can prove the policies alone hold
  // With a field rule in the model, the verdict itself is `judge`, which the presenters call: the hook never switches a field rule off
  const split = isolated && hasFieldRules(ir);
  const off = isolated && !split ? "\n  if (rulesDisabled()) return ALLOW;" : "";
  const inner = split ? "judge" : "verdict";
  const judged = split
    ? `export function verdict(rule: Rule, session: Session | null, row?: Record<string, unknown> | null): Verdict {
  if (rulesDisabled()) return ALLOW;
  return judge(rule, session, row);
}

/**
 * The verdict itself, whatever the test hook says. A field's read rule is checked with this: no policy stands
 * behind a field, so switching the rule checks off must not show one.
 */
export function judge(rule: Rule, session: Session | null, row?: Record<string, unknown> | null): Verdict {`
    : `export function verdict(rule: Rule, session: Session | null, row?: Record<string, unknown> | null): Verdict {${off}`;
  const offSatisfied = isolated ? "\n  if (rulesDisabled()) return true;" : "";
  const isolation = isolated
    ? `

const globalForRules = globalThis as unknown as { oslRulesOff?: boolean };

/** Test hook (OSL_TEST_HOOKS=1 only): with the rule checks off, the database's policies alone stand between a caller and a row */
export function setRulesDisabled(off: boolean): void {
  globalForRules.oslRulesOff = off;
}

export function rulesDisabled(): boolean {
  return process.env.OSL_TEST_HOOKS === "1" && globalForRules.oslRulesOff === true;
}

function needsSession(rule: Rule): boolean {
  if (rule.kind === "any" || rule.kind === "all") return rule.rules.some(needsSession);
  return rule.kind !== "public" && rule.kind !== "none";
}

/**
 * What a rule answers for a row the caller's tenants do not reach, which the policy hides from the handler: the
 * rule's own refusal of someone who is not a member, 401 when the caller has no session and the rule wanted one,
 * else 403.
 */
export function unreachable(rule: Rule, session: Session | null): { ok: false; status: 401 | 403 } {
  return { ok: false, status: session === null && needsSession(rule) ? 401 : 403 };
}`
    : "";
  return `/** A row condition on a rule: it allows only rows whose \`field\` compares to \`value\` as \`op\` says */
export type Condition = { field: string; op: "eq" | "ne"; value: unknown };

/**
 * A rule from the model. \`field\` is a column, or the dotted path of a value reached through relations; a
 * condition's \`field\` may be such a path too. \`all\` is a conjunction (every part allows), \`any\` alternatives.
 */
export type Rule =
  | { kind: "public"; when?: Condition }
  | { kind: "authenticated"; when?: Condition }
  | { kind: "none" }
  | { kind: "owner"; field: string; when?: Condition }
  | { kind: "role"; value: string; when?: Condition }
  | { kind: "member"; field: string; role?: string; through?: true; roles?: string[]; when?: Condition }
  | { kind: "all"; rules: Rule[] }
  | { kind: "any"; rules: Rule[] };

export type Verdict = { ok: true } | { ok: false; status: 401 | 403 };

const ALLOW: Verdict = { ok: true };

/** Membership roles from most to least privileged */
const ROLES: string[] = [${roles.map(q).join(", ")}];

function rank(role: string): number {
  const index = ROLES.indexOf(role);
  return index < 0 ? ROLES.length : index;
}

/** The rank of a role within a junction's own list, from most to least privileged; an unknown role ranks last */
function rankIn(roles: string[], role: string): number {
  const index = roles.indexOf(role);
  return index < 0 ? roles.length : index;
}

/** The tenants the session's user belongs to, with at least \`role\` when given */
export function memberTenantIds(session: Session | null, role?: string): (string | number)[] {
  return (session?.memberships ?? [])
    .filter(m => role === undefined || rank(m.role) <= rank(role))
    .map(m => m.tenant);
}

/** Whether a row (or create body) satisfies a condition; values compare as text, null only to null */
export function holds(when: Condition, row: Record<string, unknown>): boolean {
  const value = row[when.field];
  const same =
    value == null || when.value == null ? value == null && when.value == null : String(value) === String(when.value);
  return when.op === "eq" ? same : !same;
}

/** Whether the rule allows this session whatever the row, so a list under it needs no row filter. */
export function satisfied(rule: Rule, session: Session | null): boolean {${offSatisfied}
  switch (rule.kind) {
    case "public":
      return !rule.when;
    case "authenticated":
      return session !== null && !rule.when;
    case "role":
      return session !== null && (session.user as Record<string, unknown>).role === rule.value && !rule.when;
    case "all":
      return rule.rules.every(part => satisfied(part, session));
    case "any":
      return rule.rules.some(alternative => satisfied(alternative, session));
    default:
      return false;
  }
}

/**
 * Check a rule for a session and, when the rule is about a row, that row (or the body of a create). A rule
 * with alternatives allows when any of them does; otherwise it answers 401 when the caller has no session and
 * an alternative wanted one, else 403. A conjunction allows when every part does, and answers what the first
 * refusing part answered.
 * A condition is checked once the row is there; before that, the rule allows what its predicate allows.
 */
${judged}
  const base = predicateVerdict(rule, session, row);
  if (!base.ok || rule.kind === "any" || rule.kind === "all" || rule.kind === "none" || !rule.when || !row) return base;
  return holds(rule.when, row) ? ALLOW : { ok: false, status: 403 };
}

function predicateVerdict(rule: Rule, session: Session | null, row?: Record<string, unknown> | null): Verdict {
  switch (rule.kind) {
    case "all": {
      for (const part of rule.rules) {
        const result = ${inner}(part, session, row);
        if (!result.ok) return result;
      }
      return ALLOW;
    }
    case "any": {
      let status: 401 | 403 = 403;
      for (const alternative of rule.rules) {
        const result = ${inner}(alternative, session, row);
        if (result.ok) return ALLOW;
        if (result.status === 401) status = 401;
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
      if (rule.through) {
        // The caller's membership row, resolved under the predicate's key: its ranked value, true, or null
        const held = row[rule.field];
        if (held == null || held === false) return { ok: false, status: 403 };
        if (rule.role !== undefined && rankIn(rule.roles ?? [], String(held)) > rankIn(rule.roles ?? [], rule.role))
          return { ok: false, status: 403 };
        return ALLOW;
      }
      const tenant = row[rule.field];
      return memberTenantIds(session, rule.role).some(id => id === tenant) ? ALLOW : { ok: false, status: 403 };
    }
  }
}${isolation}`;
}

/** Drizzle code loading a user's memberships for the session, as `{ tenant, role }[]` */
export function membershipsLoader(ir: IR, userExpr: string): string {
  const t = ir.auth?.tenancy;
  if (!t) return "[]";
  const table = `${tableExport(entityByName(ir, t.membership))}`;
  // Under isolation: database no tenant is bound yet, so the memberships come from the function that sees past the policy
  if (t.isolation)
    return `((await db.execute(sql\`select tenant, role from "${t.isolation.memberships}"(\${${userExpr}})\`)).rows as { tenant: string | number; role: string }[]).map(m => ({ tenant: m.tenant, role: m.role }))`;
  return `(await db.query.${table}.findMany({ where: eq(${table}Table.${t.userColumn}, ${userExpr}) })).map(m => ({ tenant: m.${t.tenantColumn}, role: m.${t.roleColumn} }))`;
}

/** The runtime shape of a rule for the generated code: alternatives and conjunctions kept, a path flattened to its dotted key */
export function runtimeRule(rule: RuleIR): unknown {
  const when =
    rule.kind !== "any" && rule.kind !== "all" && rule.kind !== "none" && rule.when
      ? { when: { field: conditionKey(rule.when), op: rule.when.op, value: rule.when.value } }
      : {};
  switch (rule.kind) {
    case "owner":
      return { kind: "owner", field: ruleKey(rule), ...when };
    case "member": {
      const base: Record<string, unknown> = { kind: "member", field: ruleKey(rule) };
      if (rule.role) base.role = rule.role;
      if (rule.through) {
        base.through = true;
        if (rule.through.roles) base.roles = rule.through.roles;
      }
      return { ...base, ...when };
    }
    case "all":
      return { kind: "all", rules: rule.rules.map(runtimeRule) };
    case "any":
      return { kind: "any", rules: rule.rules.map(runtimeRule) };
    case "role":
      return { kind: "role", value: rule.value, ...when };
    case "none":
      return rule;
    default:
      return { kind: rule.kind, ...when };
  }
}

/** The TypeScript literal of a rule as the generated access module reads it */
export function ruleLiteral(rule: RuleIR): string {
  return JSON.stringify(runtimeRule(rule));
}

/** Whether checking this rule against a row needs values reached through relations: a path on a predicate or on a condition */
export function hasVia(rule: RuleIR): boolean {
  return rulePaths(rule).size > 0 || ruleMemberships(rule).size > 0;
}

/** The entities a rule reaches through relations, whose tables the generated module must import */
export function ruleEntities(rule: RuleIR): string[] {
  return [
    ...new Set([
      ...[...rulePaths(rule).values()].flatMap(p => p.via.map(h => h.entity)),
      ...[...ruleMemberships(rule).values()].flatMap(m => [...m.via.map(h => h.entity), m.through.entity])
    ])
  ];
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
 * owner column, a member rule by the session's tenants, a path through a relation (on a predicate or on its
 * condition) becomes a subquery, a conjunction ANDs its parts, and alternatives are joined with OR unless one
 * of them allows the session without a row.
 */
export function listRuleFilter(ir: IR, entity: EntityIR, rule: RuleIR, o: ListFilterOptions): ListFilter {
  const out: ListFilter = { lines: [], drizzle: new Set(), access: new Set(), tables: new Set() };
  const rows = rowDependentRules(rule);
  if (rows.length === 0) return out;
  const table = o.tableVar(entity);
  const ind = o.indent;
  let memberCount = 0;
  const tenantsName = () => (memberCount++ === 0 ? "tenants" : `tenants${memberCount}`);
  const tenantsOf = (r: RowRuleIR) =>
    `memberTenantIds(${o.session}, ${r.kind === "member" && r.role ? q(r.role) : "undefined"})`;
  /** A condition on the listed table through `hops` with nested subqueries; `leaf` tests the table the hops reach */
  const through = (hops: RuleHopIR[], leaf: (t: string) => string): string => {
    if (hops.length === 0) return leaf(table);
    const inner = (i: number): string => {
      const hop = hops[i];
      const hopEntity = entityByName(ir, hop.entity);
      const t = o.tableVar(hopEntity);
      out.tables.add(hop.entity);
      out.drizzle.add("inArray");
      const where = i + 1 < hops.length ? `inArray(${t}.${hops[i + 1].column}, ${inner(i + 1)})` : leaf(t);
      return `db.select({ id: ${t}.${hop.targetColumn} }).from(${t}).where(${where})`;
    };
    return `inArray(${table}.${hops[0].column}, ${inner(0)})`;
  };
  /** The SQL of a condition's comparison on the table it names */
  const whenLeaf = (t: string, when: RuleConditionIR): string => {
    const col = `${t}.${when.column}`;
    if (when.value === null) {
      const fn = when.op === "eq" ? "isNull" : "isNotNull";
      out.drizzle.add(fn);
      return `${fn}(${col})`;
    }
    const fn = when.op === "eq" ? "eq" : "ne";
    out.drizzle.add(fn);
    return `${fn}(${col}, ${JSON.stringify(when.value)})`;
  };
  /** The SQL of a predicate's condition, following its path when it has one, or null without a condition */
  const whenSql = (r: PredicateIR): string | null => {
    if (r.kind === "none" || !r.when) return null;
    const when = r.when;
    if (when.reader && when.via?.length) {
      // A public alternative's path: the function reads the value whatever the caller's tenants, as the policy does
      out.drizzle.add("sql");
      const call = `"${when.reader}"(\${${table}.${when.via[0].column}})`;
      if (when.value === null) return `sql\`${call} is ${when.op === "eq" ? "" : "not "}null\``;
      return `sql\`${call} ${when.op === "eq" ? "=" : "is distinct from"} \${${JSON.stringify(when.value)}}\``;
    }
    return through(when.via ?? [], t => whenLeaf(t, when));
  };
  /** The runtime guard before an open predicate's condition applies: the session or the role it needs */
  const guard = (r: PredicateIR): string | null => {
    if (r.kind === "authenticated") return `${o.session} !== null`;
    if (r.kind === "role")
      return `${o.session} !== null && (${o.session}.user as Record<string, unknown>).role === ${q(r.value)}`;
    return null;
  };
  const last = (r: RowRuleIR, t: string, tenants: string) => {
    if (r.kind === "owner") {
      out.drizzle.add("eq");
      return `eq(${t}.${r.field}, ${o.me})`;
    }
    if (r.through) {
      // Rows whose junction holds the caller (at or above the role): one subquery, whatever the junction's size
      const j = o.tableVar(entityByName(ir, r.through.entity));
      out.tables.add(r.through.entity);
      out.drizzle.add("inArray");
      out.drizzle.add("eq");
      const member = `eq(${j}.${r.through.memberColumn}, ${o.me})`;
      let where = member;
      if (r.role && r.through.roleColumn && r.through.roles) {
        out.drizzle.add("and");
        const allowed = r.through.roles.slice(0, r.through.roles.indexOf(r.role) + 1);
        where = `and(${member}, inArray(${j}.${r.through.roleColumn}, ${JSON.stringify(allowed)}))!`;
      }
      return `inArray(${t}.${r.field}, db.select({ id: ${j}.${r.through.column} }).from(${j}).where(${where}))`;
    }
    out.drizzle.add("inArray");
    return `inArray(${t}.${r.field}, ${tenants} ${o.tenantCast})`;
  };
  /** What one alternative needs: the tenant lists it declares, the runtime guards, and the SQL pieces ANDed together */
  interface Plan {
    tenants: [string, string][];
    guards: string[];
    sql: string[];
  }
  /** Whether a caller without a session reaches the filter: an alternative made of public predicates lets them list */
  const anonymousMayList = ruleAlternatives(rule).some(alt => alternativeParts(alt).every(p => p.kind === "public"));
  const plan = (alt: AlternativeIR): Plan => {
    const p: Plan = { tenants: [], guards: [], sql: [] };
    for (const part of alternativeParts(alt)) {
      if (part.kind === "none") continue;
      if (part.kind === "owner" || part.kind === "member") {
        let tenants = "";
        if (part.kind === "member" && !part.through) {
          out.access.add("memberTenantIds");
          tenants = tenantsName();
          p.tenants.push([tenants, tenantsOf(part)]);
          p.guards.push(`${tenants}.length > 0`);
        } else if (anonymousMayList && !p.guards.includes(`${o.session} !== null`))
          p.guards.push(`${o.session} !== null`);
        p.sql.push(through(part.via ?? [], t => last(part, t, tenants)));
      } else {
        const g = guard(part);
        if (g) p.guards.push(g);
      }
      const when = whenSql(part);
      if (when) p.sql.push(when);
    }
    return p;
  };
  const sqlOf = (p: Plan): string => {
    if (p.sql.length === 1) return p.sql[0];
    out.drizzle.add("and");
    return `and(${p.sql.join(", ")})!`;
  };
  if (ruleAlternatives(rule).length === 1) {
    // The check before the list already refused a session the open parts refuse; only the tenants can still be empty
    const p = plan(rows[0]);
    // Under isolation: database the filter is skipped while a test hook has the rule checks off
    const guarded = Boolean(isolationOf(ir));
    const inner = guarded ? `${ind}  ` : ind;
    if (guarded) {
      out.access.add("rulesDisabled");
      out.lines.push(`${ind}if (!rulesDisabled()) {`);
    }
    for (const [name, expr] of p.tenants) out.lines.push(`${inner}const ${name} = ${expr};`);
    if (p.tenants.length)
      out.lines.push(`${inner}if (${p.tenants.map(([name]) => `${name}.length === 0`).join(" || ")}) ${o.empty}`);
    out.lines.push(`${inner}conditions.push(${sqlOf(p)});`);
    if (guarded) out.lines.push(`${ind}}`);
    return out;
  }
  out.access.add("satisfied");
  out.lines.push(`${ind}if (!satisfied(${o.ruleRef}, ${o.session})) {`);
  out.lines.push(`${ind}  const alternatives: SQL[] = [];`);
  for (const alt of rows) {
    const p = plan(alt);
    for (const [name, expr] of p.tenants) out.lines.push(`${ind}  const ${name} = ${expr};`);
    out.lines.push(
      p.guards.length
        ? `${ind}  if (${p.guards.join(" && ")}) alternatives.push(${sqlOf(p)});`
        : `${ind}  alternatives.push(${sqlOf(p)});`
    );
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
): { source: string; tables: Set<string>; drizzle: Set<string>; needsSession: boolean } | null {
  const paths = new Map<string, { via: RuleHopIR[]; field: string; reader?: string }>();
  for (const rule of rules)
    for (const [key, path] of rulePaths(rule))
      paths.set(key, path.reader ? path : { ...path, reader: paths.get(key)?.reader });
  const memberships = new Map<string, { via: RuleHopIR[]; field: string; through: MembershipIR }>();
  for (const rule of rules) for (const [key, m] of ruleMemberships(rule)) memberships.set(key, m);
  if (paths.size === 0 && memberships.size === 0) return null;
  const tables = new Set<string>();
  const drizzle = new Set<string>();
  const blocks: string[] = [];
  const identityPk = ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
  for (const [key, m] of memberships) {
    // Follow the hops to the row the path reaches (its id is the last hop's column on the row before it)
    const steps: string[] = [];
    for (let i = 0; i + 1 < m.via.length; i++) {
      const hop = m.via[i];
      const hopEntity = entityByName(ir, hop.entity);
      const t = tableVar(hopEntity);
      tables.add(hop.entity);
      const idType = `schema.${typeName(hopEntity)}["${hop.targetColumn}"]`;
      steps.push(
        `    if (value != null) value = (await db.select({ v: ${t}.${m.via[i + 1].column} }).from(${t}).where(eq(${t}.${hop.targetColumn}, value as ${idType})))[0]?.v ?? null;`
      );
    }
    const junction = entityByName(ir, m.through.entity);
    const j = tableVar(junction);
    tables.add(m.through.entity);
    drizzle.add("and");
    drizzle.add("eq");
    const start = m.via.length ? m.via[0].column : m.field;
    const selected = m.through.roleColumn ?? m.through.memberColumn;
    const jType = `schema.${typeName(junction)}`;
    blocks.push(`  {
    let value: unknown = row.${start};
${steps.join("\n")}
    const me = session?.user.${identityPk} ?? null;
    const held =
      value == null || me == null
        ? undefined
        : (
            await db
              .select({ v: ${j}.${selected} })
              .from(${j})
              .where(and(eq(${j}.${m.through.column}, value as ${jType}["${m.through.column}"]), eq(${j}.${m.through.memberColumn}, me as ${jType}["${m.through.memberColumn}"]))!)
          )[0];
    out[${q(key)}] = held ? ${m.through.roleColumn ? "held.v" : "true"} : null;
  }`);
  }
  for (const [key, r] of paths) {
    const hops = r.via;
    if (r.reader) {
      // The value a public alternative tests: read by the function the policy calls, so a caller outside the tenant gets it too
      drizzle.add("sql");
      blocks.push(`  {
    let value: unknown = row.${hops[0].column};
    if (value != null) value = ((await db.execute(sql\`select "${r.reader}"(\${value}) as v\`)).rows[0] as { v?: unknown } | undefined)?.v ?? null;
    out[${q(key)}] = value;
  }`);
      continue;
    }
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
  const needsSession = memberships.size > 0;
  const params = needsSession
    ? "row: Record<string, unknown>, session: { user: Record<string, unknown> } | null"
    : "row: Record<string, unknown>";
  return {
    source: `/** The row (or create body) with the values its rules reach through relations, under their dotted keys${needsSession ? ", and the caller's memberships" : ""} */
async function withRuleValues(${params}): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { ...row };
${blocks.join("\n")}
  return out;
}`,
    tables,
    drizzle,
    needsSession
  };
}

/** Whether a create must check the rule against the body: a member or a path predicate reads the related row, a condition the body */
export function needsBodyCheck(rule: RuleIR): boolean {
  return rowRules(rule).some(r => r.kind === "member" || Boolean(r.via?.length)) || conditionedRules(rule).length > 0;
}

/**
 * The literal defaults of the entity's own columns the rule's conditions test, as object-literal entries to spread
 * a create body over (`published: false, `), so a body that leaves the column out is checked with the value it
 * will get. A condition through a relation reads the related row instead.
 */
export function conditionDefaults(entity: EntityIR, rule: RuleIR): string {
  const parts: string[] = [];
  for (const r of conditionedRules(rule)) {
    if (r.when!.via?.length) continue;
    const col = entity.columns.find(c => c.name === r.when!.column);
    if (col?.default?.kind === "literal" && !parts.some(p => p.startsWith(`${col.name}:`)))
      parts.push(`${col.name}: ${JSON.stringify(col.default.value)}`);
  }
  return parts.length ? `${parts.join(", ")}, ` : "";
}

/** The expression the generated code hands to checkRule for a row (or body): resolved through relations when needed */
export function rowArg(rule: RuleIR, expr: string, sessionArg = ""): string {
  return hasVia(rule) ? `await withRuleValues(${expr}${sessionArg})` : expr;
}
