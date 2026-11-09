/**
 * What the IR's rules predict for a caller and a row, computed by the harness without the generated code: the
 * same verdict the backends' access modules give, over values the harness resolves straight from the database
 * (owner and member paths, conditions through relations, the session's memberships). The rule walk compares
 * these predictions with what the running app answers.
 */
import type pg from "pg";
import {
  conditionKey,
  isRowDependent,
  rowRules,
  ruleAlternatives,
  ruleKey,
  rulePaths,
  type EntityIR,
  type IR,
  type RuleConditionIR,
  type RuleIR
} from "@osl/core";

export type Row = Record<string, unknown>;

export interface Session {
  id: unknown;
  user: Row;
  memberships: { tenant: unknown; role: string }[];
}

export type Verdict = { ok: true } | { ok: false; status: 401 | 403 };

const ALLOW: Verdict = { ok: true };

/** Ids compare as text: the database answers bigints as strings and the API as numbers */
export function same(a: unknown, b: unknown): boolean {
  return a == null || b == null ? a == null && b == null : String(a) === String(b);
}

function rank(roles: string[], role: string): number {
  const index = roles.indexOf(role);
  return index < 0 ? roles.length : index;
}

/** The tenants the session's user belongs to, with at least `role` when given */
export function memberTenantIds(session: Session | null, roles: string[], role?: string): unknown[] {
  return (session?.memberships ?? [])
    .filter(m => role === undefined || rank(roles, m.role) <= rank(roles, role))
    .map(m => m.tenant);
}

/** Whether a row (or create body) satisfies a condition; values compare as text, null only to null */
export function holds(when: RuleConditionIR, row: Row): boolean {
  const value = row[conditionKey(when)];
  const matches = same(value, when.value);
  return when.op === "eq" ? matches : !matches;
}

/**
 * The verdict the generated access module gives: alternatives allow when any does (401 when the caller has no
 * session and an alternative wanted one, else 403); a conjunction allows when every part does and answers what
 * the first refusing part answered; a condition is checked once the row is there.
 */
export function verdict(rule: RuleIR, session: Session | null, row: Row | null, roles: string[]): Verdict {
  const base = predicate(rule, session, row, roles);
  if (!base.ok || rule.kind === "any" || rule.kind === "all" || rule.kind === "none" || !rule.when || !row) return base;
  return holds(rule.when, row) ? ALLOW : { ok: false, status: 403 };
}

function predicate(rule: RuleIR, session: Session | null, row: Row | null, roles: string[]): Verdict {
  switch (rule.kind) {
    case "all": {
      for (const part of rule.rules) {
        const result = verdict(part, session, row, roles);
        if (!result.ok) return result;
      }
      return ALLOW;
    }
    case "any": {
      let status: 401 | 403 = 403;
      for (const alternative of rule.rules) {
        const result = verdict(alternative, session, row, roles);
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
      if (row && !same(row[ruleKey(rule)], session.id)) return { ok: false, status: 403 };
      return ALLOW;
    case "role":
      if (!session) return { ok: false, status: 401 };
      return session.user.role === rule.value ? ALLOW : { ok: false, status: 403 };
    case "member": {
      if (!session) return { ok: false, status: 401 };
      if (!row) return ALLOW;
      const tenant = row[ruleKey(rule)];
      return memberTenantIds(session, roles, rule.role).some(id => same(id, tenant))
        ? ALLOW
        : { ok: false, status: 403 };
    }
  }
}

/** Whether a create must check the rule against the body: a member or path predicate, or a condition */
export function createChecksBody(rule: RuleIR): boolean {
  return (
    rowRules(rule).some(r => r.kind === "member" || Boolean(r.via?.length)) ||
    ruleAlternatives(rule).some(alt =>
      alt.kind === "all" ? alt.rules.some(p => p.kind !== "none" && p.when) : alt.kind !== "none" && alt.when
    )
  );
}

/** Whether a rule can tell one row from another, so the read rule may hide a row */
export function rowDependent(rule: RuleIR): boolean {
  return ruleAlternatives(rule).some(alt =>
    alt.kind === "all" ? alt.rules.some(isRowDependent) : isRowDependent(alt)
  );
}

export type Expect = { allow: true } | { allow: false; status: 401 | 403 | 404 };

/** The check before any row is loaded: what the rule says of the session alone */
export function precheck(rule: RuleIR, session: Session | null, roles: string[]): Expect {
  const v = verdict(rule, session, null, roles);
  return v.ok ? { allow: true } : { allow: false, status: v.status };
}

/**
 * An operation that loads a row (get, update, delete, a row action): the operation's own check before the row,
 * then under `hidden: not_found` the read rule's row check answering 404, then the operation's own row check.
 */
export function rowOp(
  opRule: RuleIR,
  entity: EntityIR,
  session: Session | null,
  resolved: Row,
  roles: string[],
  isRead: boolean
): Expect {
  const before = verdict(opRule, session, null, roles);
  if (!before.ok) return { allow: false, status: before.status };
  const read = verdict(entity.rules.read, session, resolved, roles);
  if (!read.ok) {
    if (entity.hidden === "not_found") return { allow: false, status: 404 };
    if (isRead) return { allow: false, status: read.status };
  }
  if (isRead) return { allow: true };
  const own = verdict(opRule, session, resolved, roles);
  return own.ok ? { allow: true } : { allow: false, status: own.status };
}

/** A create: the check before the body, then the body (with the owner bound and defaults applied) when the rule reads it */
export function createOp(rule: RuleIR, session: Session | null, resolvedBody: Row, roles: string[]): Expect {
  const before = verdict(rule, session, null, roles);
  if (!before.ok) return { allow: false, status: before.status };
  if (!createChecksBody(rule)) return { allow: true };
  const body = verdict(rule, session, resolvedBody, roles);
  return body.ok ? { allow: true } : { allow: false, status: body.status };
}

/** Values the harness reads from the database: rows, the related values rules follow, memberships */
export class Resolver {
  constructor(
    private readonly db: pg.Client,
    private readonly ir: IR
  ) {}

  async fresh(entity: EntityIR, id: unknown): Promise<Row | null> {
    const pk = entity.primaryKey[0];
    const { rows } = await this.db.query(`select * from "${entity.table}" where "${pk}" = $1`, [id]);
    return (rows[0] as Row | undefined) ?? null;
  }

  /** The first row by its display column, so the same row is walked on every run whatever its uuid */
  async firstRow(entity: EntityIR): Promise<Row | null> {
    const pk = entity.primaryKey[0];
    const order = entity.display !== pk ? `"${entity.display}", "${pk}"` : `"${pk}"`;
    const { rows } = await this.db.query(`select * from "${entity.table}" order by ${order} limit 1`);
    return (rows[0] as Row | undefined) ?? null;
  }

  async count(entity: EntityIR): Promise<number> {
    const { rows } = await this.db.query(`select count(*)::int as n from "${entity.table}"`);
    return (rows[0] as { n: number }).n;
  }

  /** Writes the identity columns register refuses (an actor's role) straight into the database, as the generated clients do */
  async provision(actor: { email: string; provisioned: Record<string, unknown> }): Promise<void> {
    const entries = Object.entries(actor.provisioned);
    if (!entries.length || !this.ir.auth) return;
    const sets = entries.map(([column], i) => `"${column}" = $${i + 1}`).join(", ");
    await this.db.query(
      `update "${this.ir.auth.identityTable}" set ${sets} where "${this.ir.auth.emailColumn}" = $${entries.length + 1}`,
      [...entries.map(([, value]) => value), actor.email]
    );
  }

  async memberships(userId: unknown): Promise<{ tenant: unknown; role: string }[]> {
    const t = this.ir.auth?.tenancy;
    if (!t) return [];
    const { rows } = await this.db.query(
      `select "${t.tenantColumn}" as tenant, "${t.roleColumn}" as role from "${t.membershipTable}" where "${t.userColumn}" = $1`,
      [userId]
    );
    return rows as { tenant: unknown; role: string }[];
  }

  /** The row with every value the rules reach through relations under its dotted key, and the entity's defaults */
  async resolve(entity: EntityIR, row: Row, rules: RuleIR[]): Promise<Row> {
    const out: Row = { ...row };
    for (const column of entity.columns)
      if (out[column.name] === undefined && column.default?.kind === "literal") out[column.name] = column.default.value;
    const paths = new Map<string, { via: { column: string; table: string; targetColumn: string }[]; field: string }>();
    for (const rule of rules) for (const [key, p] of rulePaths(rule)) paths.set(key, p);
    for (const [key, p] of paths) {
      let current: Row | null = out;
      for (const hop of p.via) {
        const id: unknown = current === null ? null : current[hop.column];
        if (id == null) {
          current = null;
          break;
        }
        current = await this.lookup(hop.table, hop.targetColumn, id);
      }
      out[key] = current ? current[p.field] : null;
    }
    return out;
  }

  /** One row of a table by a column's value, or null */
  async lookup(table: string, column: string, value: unknown): Promise<Row | null> {
    const result: pg.QueryResult<Row> = await this.db.query(`select * from "${table}" where "${column}" = $1`, [value]);
    return result.rows[0] ?? null;
  }
}
