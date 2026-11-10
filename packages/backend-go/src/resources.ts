import type {
  ActionIR,
  EntityIR,
  EventIR,
  GeneratedFile,
  IR,
  OperationIR,
  RelationIR,
  ResourceIR,
  RuleIR,
  ThroughIR
} from "@osl/core";
import {
  actionsOf,
  alternativeParts,
  conditionedRules,
  globalActions,
  rowDependentRules,
  rowRules,
  ruleAlternatives,
  rulePaths,
  ruleMemberships,
  type MembershipIR
} from "@osl/core";
import type { AlternativeIR, PredicateIR, RowRuleIR, RuleConditionIR, RuleHopIR } from "@osl/core";
import { actionParseFunc } from "./actions.js";
import { fileSpecsLiteral } from "./auth.js";
import { eventFunc } from "./events.js";
import {
  columnsConst,
  presentFunc,
  presentManyFunc,
  presentPtrFunc,
  publicType,
  scanFunc,
  tableConst
} from "./models.js";
import {
  HEADER,
  SCAFFOLD_HEADER,
  column,
  dbType,
  dbTypeImport,
  entityByName,
  exported,
  fileColumns,
  goFile,
  goStruct,
  local,
  packageName,
  q,
  quoteIdent,
  relation,
  rowGoType,
  conditionValue,
  ruleLiteral,
  singlePrimaryKey,
  typeName
} from "./util.js";
import { actionInputVar, idFunc, inputVar, queryVar } from "./validation.js";

/** Whether checking the rule against a row needs values reached through relations: a path on a predicate or on a condition */
function hasVia(rule: RuleIR): boolean {
  return rulePaths(rule).size > 0 || ruleMemberships(rule).size > 0;
}

/** The columns a rule reads from the row itself: its plain fields, the first column of each path, and the ones its conditions test */
function baseColumns(rule: RuleIR): string[] {
  const out = new Set(rowRules(rule).map(r => (r.via?.length ? r.via[0].column : r.field)));
  for (const r of conditionedRules(rule)) out.add(r.when!.via?.length ? r.when!.via[0].column : r.when!.column);
  return [...out];
}

/**
 * The columns the access.Row handed to a check must carry: the rule's own, plus the first column of every path
 * the entity's rules follow when this rule has a path (ruleRow resolves all of them at once).
 */
function rowColumns(rule: RuleIR, allRules: RuleIR[]): string[] {
  const out = new Set(baseColumns(rule));
  if (hasVia(rule))
    for (const other of allRules) {
      for (const path of rulePaths(other).values()) out.add(path.via[0].column);
      for (const m of ruleMemberships(other).values()) out.add(m.via.length ? m.via[0].column : m.field);
    }
  return [...out];
}

/** The argument ruleRow takes before the row when a rule ends in a membership relation: the session, for the caller's id */
function ruleRowSessionArg(rules: RuleIR[]): string {
  return rules.some(r => ruleMemberships(r).size > 0) ? "session, " : "";
}

/** access.Row literal of the columns a check reads, from a loaded row struct */
function rowFromStruct(columns: string[], rowVar: string): string {
  if (columns.length === 0) return "nil";
  return `access.Row{${columns.map(c => `${q(c)}: ${rowVar}.${exported(c)}`).join(", ")}}`;
}

/**
 * access.Row literal of the columns a check reads, from a create body; a plain owner field comes from the session,
 * and a column with a literal default is read with that default, the value the row would get
 */
function rowFromValues(
  columns: string[],
  ownerField: string | undefined,
  identityPk: string,
  entity: EntityIR
): string {
  return `access.Row{${columns
    .map(c => {
      if (c === ownerField) return `${q(c)}: session.User.${identityPk}`;
      const col = entity.columns.find(x => x.name === c);
      if (col?.default?.kind === "literal")
        return `${q(c)}: access.Default(values[${q(c)}], ${conditionValue(col.default.value)})`;
      return `${q(c)}: values[${q(c)}]`;
    })
    .join(", ")}}`;
}

/**
 * A Go string expression concatenating raw literals and code. gofmt spaces a `+` chain that is the only argument
 * of a call and packs one among several arguments, so the caller says which (`sep`).
 */
function goConcat(parts: Part[], sep = "+"): string {
  const out: string[] = [];
  let literal = "";
  for (const part of parts) {
    if (typeof part === "string") literal += part;
    else {
      if (literal) out.push(goRaw(literal));
      literal = "";
      out.push(part.code);
    }
  }
  if (literal) out.push(goRaw(literal));
  return out.join(sep);
}

type Part = string | { code: string };

/**
 * The lines that narrow a list to the rows its rule lets the session see: owner by column, member by the session's
 * tenants, a path (on a predicate or on its condition) as a subquery through the relations, a conjunction as the
 * AND of its parts, alternatives joined with OR unless one allows without a row.
 */
function listFilterLines(
  ir: IR,
  rule: RuleIR,
  ruleVar: string,
  identityPk: string,
  empty: string,
  pageExpr: (total: number) => string
): string[] {
  const rows = rowDependentRules(rule);
  if (rows.length === 0) return [];
  const me = { code: `session.User.${identityPk}` };
  let memberCount = 0;
  const tenantsName = () => (memberCount++ === 0 ? "tenants" : `tenants${memberCount}`);
  const tenantsOf = (r: RowRuleIR) =>
    `access.MemberTenantIDs(session, ${q(r.kind === "member" ? (r.role ?? "") : "")})`;
  const last = (r: RowRuleIR, tenants: string): Part[] => {
    if (r.kind === "owner") return [`${quoteIdent(r.field)} = `, { code: `where.Param(${me.code})` }];
    if (r.through) {
      // Rows whose junction holds the caller (at or above the role): one subquery, whatever the junction's size
      const j = { code: `models.${tableConst(entityByName(ir, r.through.entity))}` };
      const parts: Part[] = [
        `${quoteIdent(r.field)} IN (SELECT ${quoteIdent(r.through.column)} FROM `,
        j,
        ` WHERE ${quoteIdent(r.through.memberColumn)} = `,
        { code: `where.Param(${me.code})` }
      ];
      if (r.role && r.through.roleColumn && r.through.roles) {
        const allowed = r.through.roles.slice(0, r.through.roles.indexOf(r.role) + 1);
        parts.push(
          ` AND ${quoteIdent(r.through.roleColumn)}::text = ANY(`,
          { code: `where.Param([]string{${allowed.map(q).join(", ")}})` },
          `)`
        );
      }
      parts.push(`)`);
      return parts;
    }
    return [`${quoteIdent(r.field)} = ANY(`, { code: `where.Param(${tenants})` }, `)`];
  };
  /** The SQL of a condition's comparison on the table it names */
  const whenLeaf = (when: RuleConditionIR): Part[] => {
    const col = quoteIdent(when.column);
    if (when.value === null) return [`${col} IS ${when.op === "eq" ? "" : "NOT "}NULL`];
    return [`${col} ${when.op === "eq" ? "=" : "<>"} `, { code: `where.Param(${conditionValue(when.value)})` }];
  };
  /** A test on the listed table through `hops`: nested IN (SELECT ...) down to `leaf` on the table the hops reach */
  const through = (hops: RuleHopIR[], leaf: Part[]): Part[] => {
    if (hops.length === 0) return leaf;
    const inner = (i: number): Part[] => {
      const hop = hops[i];
      const table = { code: `models.${tableConst(entityByName(ir, hop.entity))}` };
      const where = i + 1 < hops.length ? [`${quoteIdent(hops[i + 1].column)} IN (`, ...inner(i + 1), `)`] : leaf;
      return [`SELECT ${quoteIdent(hop.targetColumn)} FROM `, table, ` WHERE `, ...where];
    };
    return [`${quoteIdent(hops[0].column)} IN (`, ...inner(0), `)`];
  };
  /** The parts of a predicate's condition, following its path, or null without one */
  const whenSql = (r: PredicateIR): Part[] | null => {
    if (r.kind === "none" || !r.when) return null;
    const when = r.when;
    if (when.reader && when.via?.length) {
      // A public alternative's path: the function reads the value whatever the caller's tenants, as the policy does
      const call = `${quoteIdent(when.reader)}(${quoteIdent(when.via[0].column)})`;
      if (when.value === null) return [`${call} IS ${when.op === "eq" ? "" : "NOT "}NULL`];
      return [
        `${call} ${when.op === "eq" ? "=" : "IS DISTINCT FROM"} `,
        { code: `where.Param(${conditionValue(when.value)})` }
      ];
    }
    return through(when.via ?? [], whenLeaf(when));
  };
  /** The runtime guard before an open predicate's condition applies */
  const guard = (r: PredicateIR): string | null =>
    r.kind === "authenticated"
      ? "session != nil"
      : r.kind === "role"
        ? `session != nil && session.Role() == ${q(r.value)}`
        : null;
  /** What one alternative needs: the tenant lists it declares, the runtime guards, and the SQL pieces ANDed together */
  interface Plan {
    tenants: [string, string][];
    guards: string[];
    /** The SQL pieces, each as parts, ANDed together */
    sql: Part[][];
    /** A single owner or member column without path or condition: the builder has a method for it */
    simple?: RowRuleIR;
  }
  /** Whether a caller without a session reaches the filter: an alternative made of public predicates lets them list */
  const anonymousMayList = ruleAlternatives(rule).some(alt => alternativeParts(alt).every(p => p.kind === "public"));
  const plan = (alt: AlternativeIR): Plan => {
    const p: Plan = { tenants: [], guards: [], sql: [] };
    const parts = alternativeParts(alt);
    for (const part of parts) {
      if (part.kind === "none") continue;
      if (part.kind === "owner" || part.kind === "member") {
        let tenants = "";
        if (part.kind === "member" && !part.through) {
          tenants = tenantsName();
          p.tenants.push([tenants, tenantsOf(part)]);
          p.guards.push(`len(${tenants}) > 0`);
        } else if (anonymousMayList && !p.guards.includes("session != nil")) p.guards.push("session != nil");
        p.sql.push(through(part.via ?? [], last(part, tenants)));
        if (parts.length === 1 && !part.via?.length && !part.when && !(part.kind === "member" && part.through))
          p.simple = part;
      } else {
        const g = guard(part);
        if (g) p.guards.push(g);
      }
      const when = whenSql(part);
      if (when) p.sql.push(when);
    }
    return p;
  };
  /** The alternative's SQL as one Go expression; `sep` follows gofmt's spacing for where the expression lands */
  const sqlOf = (p: Plan, sep: string): string => {
    if (p.sql.length === 1) return goConcat(p.sql[0], sep);
    const parts: Part[] = ["("];
    p.sql.forEach((piece, i) => parts.push(...(i ? [" AND ", ...piece] : piece)));
    parts.push(")");
    return goConcat(parts, sep);
  };
  if (ruleAlternatives(rule).length === 1) {
    // The check before the list already refused a session the open parts refuse; only the tenants can still be empty
    const p = plan(rows[0]);
    const lines: string[] = [];
    for (const [name, expr] of p.tenants) lines.push(`\t${name} := ${expr}`);
    if (p.tenants.length)
      lines.push(
        `\tif ${p.tenants.map(([name]) => `len(${name}) == 0`).join(" || ")} {\n\t\thttpx.List(c, ${empty}, ${pageExpr(0)})\n\t\treturn\n\t}`
      );
    if (p.simple?.kind === "owner") lines.push(`\twhere.Eq(${goRaw(quoteIdent(p.simple.field))}, ${me.code})`);
    else if (p.simple?.kind === "member") lines.push(`\twhere.In(${goRaw(quoteIdent(p.simple.field))}, tenants)`);
    else lines.push(`\twhere.Raw(${sqlOf(p, " + ")})`);
    // Under isolation: database the filter is skipped while a test hook has the rule checks off
    if (ir.auth?.tenancy?.isolation)
      return [
        `\tif !access.RulesDisabled() {`,
        ...lines.map(line =>
          line
            .split("\n")
            .map(l => `\t${l}`)
            .join("\n")
        ),
        `\t}`
      ];
    return lines;
  }
  const lines: string[] = [`\tif !access.Satisfied(${ruleVar}, session) {`, `\t\talternatives := []string{}`];
  for (const alt of rows) {
    const p = plan(alt);
    if (p.tenants.length === 1 && p.guards.length === 1) {
      const [name, expr] = p.tenants[0];
      lines.push(
        `\t\tif ${name} := ${expr}; len(${name}) > 0 {\n\t\t\talternatives = append(alternatives, ${sqlOf(p, "+")})\n\t\t}`
      );
      continue;
    }
    for (const [name, expr] of p.tenants) lines.push(`\t\t${name} := ${expr}`);
    lines.push(
      p.guards.length
        ? `\t\tif ${p.guards.join(" && ")} {\n\t\t\talternatives = append(alternatives, ${sqlOf(p, "+")})\n\t\t}`
        : `\t\talternatives = append(alternatives, ${sqlOf(p, "+")})`
    );
  }
  lines.push(`\t\tif len(alternatives) == 0 {\n\t\t\thttpx.List(c, ${empty}, ${pageExpr(0)})\n\t\t\treturn\n\t\t}`);
  lines.push(`\t\twhere.AnyOf(alternatives)`, `\t}`);
  return lines;
}

/** The ruleRow method: adds to a Row the values the entity's rules reach through relations, under their dotted keys */
function ruleRowMethod(ir: IR, handler: string, rules: RuleIR[]): string | null {
  const paths = new Map<string, { via: RuleHopIR[]; field: string; reader?: string }>();
  for (const rule of rules)
    for (const [key, path] of rulePaths(rule))
      paths.set(key, path.reader ? path : { ...path, reader: paths.get(key)?.reader });
  const memberships = new Map<string, { via: RuleHopIR[]; field: string; through: MembershipIR }>();
  for (const rule of rules) for (const [key, m] of ruleMemberships(rule)) memberships.set(key, m);
  if (paths.size === 0 && memberships.size === 0) return null;
  const blocks: string[] = [];
  let n = 0;
  for (const [key, m] of memberships) {
    // Follow the hops to the row the path reaches, then look the caller's membership row up in the junction
    const lines: string[] = [];
    let source = `row[${q(m.via.length ? m.via[0].column : m.field)}]`;
    for (let i = 0; i + 1 < m.via.length; i++) {
      const hop = m.via[i];
      const hopEntity = entityByName(ir, hop.entity);
      const next = m.via[i + 1].column;
      const type = rowGoType({ ...column(hopEntity, next), nullable: false });
      const v = `v${n++}`;
      lines.push(`\t\tvar ${v} *${type}`);
      lines.push(
        `\t\tif err := h.db.QueryRow(ctx, \`SELECT ${quoteIdent(next)} FROM \`+models.${tableConst(hopEntity)}+\` WHERE ${quoteIdent(hop.targetColumn)} = $1\`, ${source}).Scan(&${v}); err != nil && !errors.Is(err, pgx.ErrNoRows) {\n\t\t\treturn nil, err\n\t\t}`
      );
      source = v;
    }
    const junction = entityByName(ir, m.through.entity);
    const held = `held${n++}`;
    const selected = m.through.roleColumn ? quoteIdent(m.through.roleColumn) : "1";
    lines.push(`\t\tvar ${held} *${m.through.roleColumn ? "string" : "int"}`);
    lines.push(
      `\t\tif ${source} != nil && session != nil {\n\t\t\tif err := h.db.QueryRow(ctx, \`SELECT ${selected} FROM \`+models.${tableConst(junction)}+\` WHERE ${quoteIdent(m.through.column)} = $1 AND ${quoteIdent(m.through.memberColumn)} = $2\`, ${source}, session.UserID()).Scan(&${held}); err != nil && !errors.Is(err, pgx.ErrNoRows) {\n\t\t\t\treturn nil, err\n\t\t\t}\n\t\t}`
    );
    lines.push(
      m.through.roleColumn
        ? `\t\tif ${held} != nil {\n\t\t\trow[${q(key)}] = *${held}\n\t\t} else {\n\t\t\trow[${q(key)}] = nil\n\t\t}`
        : `\t\trow[${q(key)}] = ${held} != nil`
    );
    blocks.push(`\t{\n${lines.join("\n")}\n\t}`);
  }
  for (const [key, r] of paths) {
    const hops = r.via;
    const lines: string[] = [];
    let source = `row[${q(hops[0].column)}]`;
    if (r.reader) {
      // The value a public alternative tests: read by the function the policy calls, so a caller outside the tenant gets it too
      const last = entityByName(ir, hops[hops.length - 1].entity);
      const type = rowGoType({ ...column(last, r.field), nullable: false });
      const v = `v${n++}`;
      lines.push(`\t\tvar ${v} *${type}`);
      lines.push(
        `\t\tif err := h.db.QueryRow(ctx, \`SELECT ${quoteIdent(r.reader)}($1)\`, ${source}).Scan(&${v}); err != nil && !errors.Is(err, pgx.ErrNoRows) {\n\t\t\treturn nil, err\n\t\t}`
      );
      lines.push(`\t\trow[${q(key)}] = ${v}`);
      blocks.push(`\t{\n${lines.join("\n")}\n\t}`);
      continue;
    }
    hops.forEach((hop, i) => {
      const hopEntity = entityByName(ir, hop.entity);
      const next = i + 1 < hops.length ? hops[i + 1].column : r.field;
      const type = rowGoType({ ...column(hopEntity, next), nullable: false });
      const v = `v${n++}`;
      lines.push(`\t\tvar ${v} *${type}`);
      lines.push(
        `\t\tif err := h.db.QueryRow(ctx, \`SELECT ${quoteIdent(next)} FROM \`+models.${tableConst(hopEntity)}+\` WHERE ${quoteIdent(hop.targetColumn)} = $1\`, ${source}).Scan(&${v}); err != nil && !errors.Is(err, pgx.ErrNoRows) {\n\t\t\treturn nil, err\n\t\t}`
      );
      source = v;
    });
    lines.push(`\t\trow[${q(key)}] = ${source}`);
    blocks.push(`\t{\n${lines.join("\n")}\n\t}`);
  }
  const sessionParam = memberships.size ? "session *auth.Session, " : "";
  return `// ruleRow adds to row the values the rules reach through relations, under their dotted keys${memberships.size ? ", and the caller's memberships" : ""}.
func (h *${handler}) ruleRow(ctx context.Context, ${sessionParam}row access.Row) (access.Row, error) {
${blocks.join("\n")}
	return row, nil
}`;
}

function routePath(pathTemplate: string): string {
  return pathTemplate.replace(/\{([a-z_]+)\}/g, ":$1");
}

function fail(op: "read" | "write" | "delete"): string {
  return `\tif err != nil {\n\t\thttpx.HandleError(c, err, ${q(op)})\n\t\treturn\n\t}`;
}

/**
 * What a row load that failed answers. Under isolation: database, on an entity with an existence probe, a row that
 * did not come back may be another tenant's, which the handler's missing method answers as the rule would.
 */
function failLoad(entity: EntityIR, op: "read" | "write" | "delete", ruleVar: string): string {
  if (!entity.tenant?.exists) return fail(op);
  return `\tif err != nil {\n\t\th.missing(c, err, id, ${ruleVar}, session, ${q(op)})\n\t\treturn\n\t}`;
}

/** The missing method of a handler over an entity with an existence probe */
function missingMethod(entity: EntityIR, handler: string): string | null {
  if (!entity.tenant?.exists) return null;
  return `// missing answers a row that did not come back: another tenant's as the rule answers a caller it refuses, a
// missing one 404, and any other failure as it is.
func (h *${handler}) missing(c *gin.Context, err error, id any, rule access.Rule, session *auth.Session, operation string) {
	if errors.Is(err, pgx.ErrNoRows) {
		if found, perr := h.db.Exists(c.Request.Context(), ${q(entity.tenant.exists)}, id); perr == nil && found {
			access.Deny(c, access.Unreachable(rule, session))
			return
		}
	}
	httpx.HandleError(c, err, operation)
}`;
}

const DENY = (ruleVar: string) =>
  `\tif verdict := access.Check(${ruleVar}, session); verdict != nil {\n\t\taccess.Deny(c, verdict)\n\t\treturn\n\t}`;

/** Check a rule against a row literal; a rule with a path first resolves the related values through ruleRow */
const DENY_ROW = (
  ruleVar: string,
  rule: RuleIR,
  rowLiteral: string,
  op: "read" | "write" | "delete",
  sessionArg = ""
) =>
  hasVia(rule)
    ? `\truleRow, err := h.ruleRow(ctx, ${sessionArg}${rowLiteral})\n${fail(op)}\n\tif verdict := access.CheckRow(${ruleVar}, session, ruleRow); verdict != nil {\n\t\taccess.Deny(c, verdict)\n\t\treturn\n\t}`
    : `\tif verdict := access.CheckRow(${ruleVar}, session, ${rowLiteral}); verdict != nil {\n\t\taccess.Deny(c, verdict)\n\t\treturn\n\t}`;

/** Answer not found when the read rule hides the row from the caller, so a hidden row looks like a missing one (Get) */
const HIDE_ROW = (
  ruleVar: string,
  rule: RuleIR,
  rowLiteral: string,
  op: "read" | "write" | "delete",
  sessionArg = ""
) =>
  hasVia(rule)
    ? `\truleRow, err := h.ruleRow(ctx, ${sessionArg}${rowLiteral})\n${fail(op)}\n\tif access.CheckRow(${ruleVar}, session, ruleRow) != nil {\n\t\thttpx.Fail(c, httpx.NotFound())\n\t\treturn\n\t}`
    : `\tif access.CheckRow(${ruleVar}, session, ${rowLiteral}) != nil {\n\t\thttpx.Fail(c, httpx.NotFound())\n\t\treturn\n\t}`;

/**
 * The checks of an operation that loaded a row: with hidden rows answered as not found, the read rule first (a
 * hidden row answers 404), then the operation's own rule; one ruleRow resolution serves both when paths are involved.
 */
function rowChecks(
  entity: EntityIR,
  readVar: string,
  ownVar: string,
  own: RuleIR,
  rowVar: string,
  op: "read" | "write" | "delete",
  allRules: RuleIR[],
  sessionArg = ""
): string {
  const hidden = entity.hidden === "not_found";
  const read = entity.rules.read;
  const readVia = hidden && hasVia(read);
  const ownVia = hasVia(own);
  const lines: string[] = [];
  if (readVia || ownVia) {
    const columns = [
      ...new Set([...(readVia ? rowColumns(read, allRules) : []), ...(ownVia ? rowColumns(own, allRules) : [])])
    ];
    lines.push(`\truleRow, err := h.ruleRow(ctx, ${sessionArg}${rowFromStruct(columns, rowVar)})`, fail(op));
  }
  if (hidden)
    lines.push(
      `\tif access.CheckRow(${readVar}, session, ${readVia ? "ruleRow" : rowFromStruct(rowColumns(read, allRules), rowVar)}) != nil {\n\t\thttpx.Fail(c, httpx.NotFound())\n\t\treturn\n\t}`
    );
  lines.push(
    `\tif verdict := access.CheckRow(${ownVar}, session, ${ownVia ? "ruleRow" : rowFromStruct(rowColumns(own, allRules), rowVar)}); verdict != nil {\n\t\taccess.Deny(c, verdict)\n\t\treturn\n\t}`
  );
  return lines.join("\n");
}

const PARSE_ID = (idFn: string) =>
  `\tid, ok := validation.${idFn}(c.Param("id"))\n\tif !ok {\n\t\thttpx.Fail(c, httpx.NotFound())\n\t\treturn\n\t}`;

const PARSE_BODY = (inputExpr: string, target: string) => `\tbody, perr := httpx.ParseBody(c)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	${target}, perr := ${inputExpr}.Parse(body)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}`;

interface Include {
  rel: RelationIR;
  /** Set for a relation through a junction: `rel` then describes it as the many side it is to the row shape */
  through?: ThroughIR;
  target: EntityIR;
  /** Go type of the map key: the key column's Go type */
  keyType: string;
  loader: string;
  mapVar: string;
  mapType: string;
}

function includeOf(ir: IR, entity: EntityIR, name: string): Include {
  const rel = relation(entity, name);
  const target = entityByName(ir, rel.target);
  const keyType =
    rel.direction === "forward"
      ? rowGoType(column(target, rel.targetColumn))
      : rowGoType(column(entity, rel.targetColumn));
  const mapType =
    rel.direction === "reverse" && rel.kind === "many"
      ? `map[${keyType}][]*models.${typeName(target)}`
      : `map[${keyType}]*models.${typeName(target)}`;
  return { rel, target, keyType, loader: `load${exported(rel.name)}`, mapVar: `${local(rel.name)}Rows`, mapType };
}

/** A relation through a junction as an include: to the row shape it is a reverse relation with many rows, keyed by the entity's own key */
function throughIncludeOf(ir: IR, entity: EntityIR, name: string): Include {
  const through = entity.through!.find(t => t.name === name)!;
  const target = entityByName(ir, through.target);
  const keyType = rowGoType(column(entity, through.sourceColumn));
  return {
    rel: {
      name,
      kind: "many",
      direction: "reverse",
      target: through.target,
      column: through.from,
      targetColumn: through.sourceColumn
    },
    through,
    target,
    keyType,
    loader: `load${exported(name)}`,
    mapVar: `${local(name)}Rows`,
    mapType: `map[${keyType}][]*models.${typeName(target)}`
  };
}

/** The loader of a relation through a junction: the links in order, then the far rows they name */
function throughLoaderMethod(ir: IR, inc: Include, entity: EntityIR, handler: string): string {
  const through = inc.through!;
  const { target } = inc;
  const T = typeName(entity);
  const junction = entityByName(ir, through.junction);
  const farKey = rowGoType(column(target, through.targetColumn));
  const order = through.orderBy
    ? `j.${quoteIdent(through.orderBy)}, j.${quoteIdent(junction.primaryKey[0])}`
    : [...new Set([target.display, through.targetColumn])].map(c => `f.${quoteIdent(c)}`).join(", ");
  return `// ${inc.loader} fetches the ${through.name} of each ${T}: the ${target.name} rows ${through.junction} links it to, ${through.orderBy ? `in the order of ${through.junction}.${through.orderBy}` : `by ${target.display}`}.
func (h *${handler}) ${inc.loader}(ctx context.Context, items []*models.${T}) (${inc.mapType}, error) {
	keys := make([]${inc.keyType}, 0, len(items))
	for _, item := range items {
		keys = append(keys, item.${exported(through.sourceColumn)})
	}
	out := make(${inc.mapType}, len(keys))
	if len(keys) == 0 {
		return out, nil
	}
	links, err := h.db.Query(ctx, \`SELECT j.${quoteIdent(through.from)}, j.${quoteIdent(through.to)} FROM ${quoteIdent(through.junctionTable)} AS j JOIN ${quoteIdent(target.table)} AS f ON f.${quoteIdent(through.targetColumn)} = j.${quoteIdent(through.to)} WHERE j.${quoteIdent(through.from)} = ANY($1) ORDER BY ${order}\`, keys)
	if err != nil {
		return nil, err
	}
	type link struct {
		from ${inc.keyType}
		to   ${farKey}
	}
	var pairs []link
	farKeys := make([]${farKey}, 0)
	for links.Next() {
		var l link
		if err := links.Scan(&l.from, &l.to); err != nil {
			links.Close()
			return nil, err
		}
		pairs = append(pairs, l)
		farKeys = append(farKeys, l.to)
	}
	links.Close()
	if err := links.Err(); err != nil {
		return nil, err
	}
	if len(pairs) == 0 {
		return out, nil
	}
	rows, err := h.db.Query(ctx, \`SELECT \`+models.${columnsConst(target)}+\` FROM \`+models.${tableConst(target)}+\` WHERE ${quoteIdent(through.targetColumn)} = ANY($1)\`, farKeys)
	if err != nil {
		return nil, err
	}
	related, err := models.Collect(rows, models.${scanFunc(target)})
	if err != nil {
		return nil, err
	}
	far := make(map[${farKey}]*models.${typeName(target)}, len(related))
	for _, row := range related {
		far[row.${exported(through.targetColumn)}] = row
	}
	for _, l := range pairs {
		if row, ok := far[l.to]; ok {
			out[l.from] = append(out[l.from], row)
		}
	}
	return out, nil
}`;
}

/** The struct field for an included relation in a row shape */
function includeField(inc: Include): { name: string; type: string; tag: string } {
  const pub = `models.${publicType(inc.target)}`;
  const type = inc.rel.direction === "reverse" && inc.rel.kind === "many" ? `[]${pub}` : `*${pub}`;
  return { name: exported(inc.rel.name), type, tag: `\`json:${q(inc.rel.name)}\`` };
}

/** Expression presenting an included relation of `item` from the loaded map */
function includeValue(inc: Include, entity: EntityIR, item: string): string {
  const { rel, target } = inc;
  if (rel.direction === "forward") {
    const fk = column(entity, rel.column);
    const key = fk.nullable
      ? `models.Lookup(${inc.mapVar}, ${item}.${exported(rel.column)})`
      : `${inc.mapVar}[${item}.${exported(rel.column)}]`;
    return `models.${presentPtrFunc(target)}(${key})`;
  }
  const key = `${inc.mapVar}[${item}.${exported(rel.targetColumn)}]`;
  return rel.kind === "many" ? `models.${presentManyFunc(target)}(${key})` : `models.${presentPtrFunc(target)}(${key})`;
}

/** The loader method for an included relation */
function loaderMethod(inc: Include, entity: EntityIR, handler: string): string {
  const { rel, target } = inc;
  const T = typeName(entity);
  const lines: string[] = [];
  if (rel.direction === "forward") {
    const fk = column(entity, rel.column);
    const field = `item.${exported(rel.column)}`;
    lines.push(`// ${inc.loader} fetches the ${rel.name} of each ${T}, keyed by ${rel.targetColumn}.`);
    lines.push(
      `func (h *${handler}) ${inc.loader}(ctx context.Context, items []*models.${T}) (${inc.mapType}, error) {`
    );
    lines.push(`\tkeys := make([]${inc.keyType}, 0, len(items))`);
    lines.push(`\tfor _, item := range items {`);
    if (fk.nullable) lines.push(`\t\tif ${field} != nil {\n\t\t\tkeys = append(keys, *${field})\n\t\t}`);
    else lines.push(`\t\tkeys = append(keys, ${field})`);
    lines.push(`\t}`);
    lines.push(`\tout := make(${inc.mapType}, len(keys))`);
    lines.push(`\tif len(keys) == 0 {\n\t\treturn out, nil\n\t}`);
    lines.push(
      `\trows, err := h.db.Query(ctx, \`SELECT \`+models.${columnsConst(target)}+\` FROM \`+models.${tableConst(target)}+\` WHERE ${quoteIdent(rel.targetColumn)} = ANY($1)\`, keys)`
    );
    lines.push(`\tif err != nil {\n\t\treturn nil, err\n\t}`);
    lines.push(`\trelated, err := models.Collect(rows, models.${scanFunc(target)})`);
    lines.push(`\tif err != nil {\n\t\treturn nil, err\n\t}`);
    lines.push(`\tfor _, row := range related {\n\t\tout[row.${exported(rel.targetColumn)}] = row\n\t}`);
    lines.push(`\treturn out, nil`);
    lines.push(`}`);
    return lines.join("\n");
  }
  const fk = column(target, rel.column);
  const keyField = `item.${exported(rel.targetColumn)}`;
  const groupKey = fk.nullable ? `*row.${exported(rel.column)}` : `row.${exported(rel.column)}`;
  // The children of the parent they are ordered within come in their order
  const order = [...(rel.orderBy ? [rel.orderBy] : []), ...target.primaryKey].map(quoteIdent).join(", ");
  lines.push(`// ${inc.loader} fetches the ${rel.name} of each ${T}, grouped by ${rel.column}.`);
  lines.push(`func (h *${handler}) ${inc.loader}(ctx context.Context, items []*models.${T}) (${inc.mapType}, error) {`);
  lines.push(`\tkeys := make([]${inc.keyType}, 0, len(items))`);
  lines.push(`\tfor _, item := range items {\n\t\tkeys = append(keys, ${keyField})\n\t}`);
  lines.push(`\tout := make(${inc.mapType}, len(keys))`);
  lines.push(`\tif len(keys) == 0 {\n\t\treturn out, nil\n\t}`);
  lines.push(
    `\trows, err := h.db.Query(ctx, \`SELECT \`+models.${columnsConst(target)}+\` FROM \`+models.${tableConst(target)}+\` WHERE ${quoteIdent(rel.column)} = ANY($1) ORDER BY ${order}\`, keys)`
  );
  lines.push(`\tif err != nil {\n\t\treturn nil, err\n\t}`);
  lines.push(`\trelated, err := models.Collect(rows, models.${scanFunc(target)})`);
  lines.push(`\tif err != nil {\n\t\treturn nil, err\n\t}`);
  if (rel.kind === "many")
    lines.push(`\tfor _, row := range related {\n\t\tout[${groupKey}] = append(out[${groupKey}], row)\n\t}`);
  else lines.push(`\tfor _, row := range related {\n\t\tout[${groupKey}] = row\n\t}`);
  lines.push(`\treturn out, nil`);
  lines.push(`}`);
  return lines.join("\n");
}

/** Lines emitting the events of an action after its handler ran; payload is the presented result expression */
function emitLines(events: EventIR[], payload: string, op: "write" | "delete"): string[] {
  return events.map(
    e =>
      `\tif err := events.${eventFunc(e)}(ctx, ${payload}); err != nil {\n\t\thttpx.HandleError(c, err, ${q(op)})\n\t\treturn\n\t}`
  );
}

/** The method name of an action on its handler struct: ActionPublish, ActionUnpublishAll */
export function actionMethod(action: ActionIR): string {
  return `Action${exported(action.name)}`;
}

/** The handler method of an action, inside a resource handler (row and collection) or the global one */
function actionHandlerMethod(
  ir: IR,
  action: ActionIR,
  handler: string,
  ruleVar: string,
  imports: Set<string>,
  modulePath: string,
  row: { entity: EntityIR; resource: ResourceIR } | null
): string {
  const events = ir.events.filter(
    e =>
      e.kind === "action" &&
      e.actionName === action.name &&
      (e.resource ?? undefined) === (action.resource ?? undefined)
  );
  if (events.length) imports.add(`${modulePath}/generated/events`);
  const entity = action.entity ? entityByName(ir, action.entity) : null;
  const present = entity ? `models.${presentFunc(entity)}` : "";
  const lines: string[] = [];
  lines.push(`// ${actionMethod(action)} handles ${action.method} ${action.path}: the ${action.name} action.`);
  lines.push(`func (h *${handler}) ${actionMethod(action)}(c *gin.Context) {`);
  if (action.scope === "row" || events.length) lines.push(`\tctx := c.Request.Context()`);
  lines.push(`\tsession, err := h.auth.Session(c)`);
  lines.push(fail("write"));
  lines.push(DENY(ruleVar));
  const args = [`actx`, `actions.${actionParseFunc(action)}(values)`];
  if (action.scope === "row" && row) {
    const pk = singlePrimaryKey(row.entity);
    lines.push(PARSE_ID(idFunc(row.resource)));
    lines.push(
      `\trow, err := models.${scanFunc(row.entity)}(h.db.QueryRow(ctx, \`SELECT \`+models.${columnsConst(row.entity)}+\` FROM \`+models.${tableConst(row.entity)}+\` WHERE ${quoteIdent(pk.name)} = $1\`, id))`
    );
    lines.push(failLoad(row.entity, "write", ruleVar));
    const allRules = [...Object.values(row.entity.rules), ...actionsOf(ir, row.resource.name).map(a => a.rule)];
    lines.push(
      rowChecks(
        row.entity,
        `${local(row.resource.name)}ReadRule`,
        ruleVar,
        action.rule,
        "row",
        "write",
        allRules,
        ruleRowSessionArg(allRules)
      )
    );
    args.push("row");
  }
  lines.push(PARSE_BODY(`validation.${actionInputVar(action)}`, "values"));
  if (action.builtin === "move" && row) {
    // The compiler's own action: the database puts the row at its new place and renumbers its parent in one
    // statement; the row is read again as it now is, and a row that went meanwhile answers 404
    const pk = singlePrimaryKey(row.entity);
    lines.push(`\tto, _ := values["to"].(int)
	var place *int
	if err := h.db.QueryRow(ctx, \`SELECT ${quoteIdent(row.entity.order!.move)}($1, $2)\`, id, to).Scan(&place); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	if place == nil {
		httpx.Fail(c, httpx.NotFound())
		return
	}
	result, err := models.${scanFunc(row.entity)}(h.db.QueryRow(ctx, \`SELECT \`+models.${columnsConst(row.entity)}+\` FROM \`+models.${tableConst(row.entity)}+\` WHERE ${quoteIdent(pk.name)} = $1\`, id))
${fail("write")}
	_ = row`);
    lines.push(...emitLines(events, `${present}(result)`, "write"));
    lines.push(`\thttpx.OK(c, ${present}(result))`);
    lines.push(`}`);
    return lines.join("\n");
  }
  lines.push(
    `\tactx := &actions.Context{Gin: c, Ctx: c.Request.Context(), Session: session, DB: h.db, Now: time.Now().UTC()}`
  );
  const call = `handlers.${exported(action.handler)}(${args.join(", ")})`;
  if (action.returns.kind === "none") {
    lines.push(`\tif err := ${call}; err != nil {\n\t\thttpx.HandleError(c, err, "write")\n\t\treturn\n\t}`);
    lines.push(...emitLines(events, "struct{}{}", "write"));
    lines.push(`\thttpx.NoContent(c)`);
  } else if (action.returns.kind === "entity") {
    lines.push(`\tresult, err := ${call}`);
    lines.push(fail("write"));
    lines.push(...emitLines(events, `${present}(result)`, "write"));
    lines.push(`\thttpx.OK(c, ${present}(result))`);
  } else {
    lines.push(`\tresult, err := ${call}`);
    lines.push(fail("write"));
    lines.push(...emitLines(events, "result", "write"));
    lines.push(`\thttpx.OK(c, result)`);
  }
  lines.push(`}`);
  return lines.join("\n");
}

/** generated/resources/<name>.go */
export function resourceFile(ir: IR, resource: ResourceIR, modulePath: string): string {
  const entity = entityByName(ir, resource.entity);
  const T = typeName(entity);
  const handler = exported(resource.name);
  const prefix = local(resource.name);
  const pk = singlePrimaryKey(entity);
  const pkIdent = quoteIdent(pk.name);
  const ops = resource.operations.filter(o => o.rule.kind !== "none");
  const list = ops.find(o => o.kind === "list") as Extract<OperationIR, { kind: "list" }> | undefined;
  const get = ops.find(o => o.kind === "get") as Extract<OperationIR, { kind: "get" }> | undefined;
  const create = ops.find(o => o.kind === "create") as Extract<OperationIR, { kind: "create" }> | undefined;
  const update = ops.find(o => o.kind === "update") as Extract<OperationIR, { kind: "update" }> | undefined;
  const remove = ops.find(o => o.kind === "delete") as Extract<OperationIR, { kind: "delete" }> | undefined;
  const actions = actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none");
  const eventsFor = (action: "created" | "updated" | "deleted") =>
    ir.events.filter(e => e.kind === "entity" && e.entity === entity.name && e.action === action);
  const identityPk = ir.auth ? exported(entityByName(ir, ir.auth.identity).primaryKey[0]) : "ID";
  const hooksPkg = `${packageName(resource.name)}hooks`;
  const tableC = `models.${tableConst(entity)}`;
  const columnsC = `models.${columnsConst(entity)}`;
  const scan = `models.${scanFunc(entity)}`;
  const present = `models.${presentFunc(entity)}`;
  const files = fileColumns(entity);
  const tenancy = ir.auth?.tenancy;
  const isTenant = tenancy?.entity === entity.name;
  const membership = tenancy ? entityByName(ir, tenancy.membership) : null;

  const imports = new Set<string>([
    "github.com/gin-gonic/gin",
    dbTypeImport(ir, modulePath),
    `${modulePath}/generated/access`,
    `${modulePath}/generated/auth`,
    `${modulePath}/generated/httpx`,
    `${modulePath}/generated/models`,
    `${modulePath}/generated/validation`
  ]);
  if (list || create || update) imports.add(`${modulePath}/generated/db`);
  const missing =
    get || update || remove || actions.some(a => a.scope === "row") ? missingMethod(entity, handler) : null;
  if (missing) {
    imports.add("errors");
    imports.add("github.com/jackc/pgx/v5");
  }
  if (create || update || remove) {
    imports.add(`${modulePath}/generated/hooks`);
    imports.add(`${hooksPkg} ${modulePath}/src/extensions/${resource.name}`);
  }
  if (files.length && (create || update)) imports.add(`${modulePath}/generated/files`);
  if (actions.some(a => !a.builtin)) {
    imports.add(`${modulePath}/generated/actions`);
    imports.add("time");
    imports.add(`${modulePath}/generated/actions/handlers`);
  }
  const allRules = [...Object.values(entity.rules), ...actions.map(a => a.rule)];
  const ruleRow = ruleRowMethod(ir, handler, allRules);
  if (ruleRow) {
    imports.add("context");
    imports.add("errors");
    imports.add("github.com/jackc/pgx/v5");
    if (ruleRowSessionArg(allRules)) imports.add(`${modulePath}/generated/auth`);
  }

  const includes = new Map<string, Include>();
  const listIncludes = [
    ...(list?.include ?? []).map(name => includeOf(ir, entity, name)),
    ...(list?.through ?? []).map(name => throughIncludeOf(ir, entity, name))
  ];
  const getIncludes = [
    ...(get?.include ?? []).map(name => includeOf(ir, entity, name)),
    ...(get?.through ?? []).map(name => throughIncludeOf(ir, entity, name))
  ];
  for (const inc of [...listIncludes, ...getIncludes]) includes.set(inc.rel.name, inc);
  if (includes.size) imports.add("context");

  const sections: string[] = [];
  const routes = [
    ...ops.map(op => `\tr.${op.method}(${q(routePath(op.path))}, h.${opMethod(op.kind)})`),
    ...actions.map(a => `\tr.${a.method}(${q(routePath(a.path))}, h.${actionMethod(a)})`)
  ];
  sections.push(`// ${handler} serves the ${resource.name} resource (${entity.name}).
type ${handler} struct {
	db   ${dbType(ir)}
	auth *auth.Auth
}

// New${handler} builds the handlers.
func New${handler}(db ${dbType(ir)}, a *auth.Auth) *${handler} {
	return &${handler}{db: db, auth: a}
}

// Routes registers every operation of the resource${actions.length ? " and its actions" : ""}.
func (h *${handler}) Routes(r gin.IRouter) {
${routes.join("\n")}
}`);

  const ruleVar = (kind: "read" | "create" | "update" | "delete") => `${prefix}${exported(kind)}Rule`;
  const actionRuleVar = (action: ActionIR) => `${prefix}${exported(action.name)}ActionRule`;
  sections.push(
    [
      ...(["read", "create", "update", "delete"] as const).map(
        kind => `var ${ruleVar(kind)} = ${ruleLiteral(entity.rules[kind])}`
      ),
      ...actions.map(a => `var ${actionRuleVar(a)} = ${ruleLiteral(a.rule)}`)
    ].join("\n\n")
  );
  if (files.length && (create || update))
    sections.push(`// ${prefix}FileFields lists the file fields of ${entity.name} and what they accept.
var ${prefix}FileFields = ${fileSpecsLiteral(files)}`);

  const rowShape = (name: string, incs: Include[], doc: string) =>
    goStruct(name, [{ name: "", type: `models.${publicType(entity)}` }, ...incs.map(includeField)], doc);
  const rowLiteral = (name: string, incs: Include[], item: string) =>
    `${name}{${[`${publicType(entity)}: ${present}(${item})`, ...incs.map(inc => `${includeField(inc).name}: ${includeValue(inc, entity, item)}`)].join(", ")}}`;
  const loadIncludes = (incs: Include[], op: "read") =>
    incs.map(inc => `\t${inc.mapVar}, err := h.${inc.loader}(ctx, items)\n${fail(op)}`).join("\n");
  const resolveFiles = (target: string) =>
    files.length
      ? `\tif err := files.ResolveRefs(ctx, h.db, ${target}, ${prefix}FileFields); err != nil {\n\t\thttpx.HandleError(c, err, "write")\n\t\treturn\n\t}\n`
      : "";

  if (listIncludes.length)
    sections.push(rowShape(`${prefix}ListRow`, listIncludes, `${prefix}ListRow is a list item with its includes.`));
  if (getIncludes.length)
    sections.push(rowShape(`${prefix}GetRow`, getIncludes, `${prefix}GetRow is a single row with its includes.`));

  if (list) {
    const filterLines = list.filters.map(
      f => `\tif v, ok := query.Filters[${q(f)}]; ok {\n\t\twhere.Eq(${goRaw(quoteIdent(f))}, v)\n\t}`
    );
    filterLines.push(
      ...listFilterLines(
        ir,
        list.rule,
        ruleVar("read"),
        identityPk,
        listIncludes.length ? `[]${prefix}ListRow{}` : `models.${presentManyFunc(entity)}(nil)`,
        (total: number) => `httpx.Page{Page: query.Page, PageSize: query.PageSize, Total: ${total}}`
      )
    );
    if (list.search.length)
      filterLines.push(
        `\tif query.Q != "" {\n\t\twhere.Search([]string{${list.search.map(f => goRaw(quoteIdent(f))).join(", ")}}, query.Q)\n\t}`
      );
    const defaultOrder = list.order.map(([col, dir]) => `${quoteIdent(col)} ${dir.toUpperCase()}`).join(", ");
    const orderLines = list.sortable.length
      ? `\torderBy := ${goRaw(defaultOrder)}
	if query.Sort != "" {
		field, direction := validation.SortColumn(query.Sort)
		orderBy = db.Quote(field) + " " + direction
	}
`
      : `\torderBy := ${goRaw(defaultOrder)}\n`;
    const body = listIncludes.length
      ? `${loadIncludes(listIncludes, "read")}
	data := make([]${prefix}ListRow, 0, len(items))
	for _, item := range items {
		data = append(data, ${rowLiteral(`${prefix}ListRow`, listIncludes, "item")})
	}
	httpx.List(c, data, httpx.Page{Page: query.Page, PageSize: query.PageSize, Total: total})`
      : `\thttpx.List(c, models.${presentManyFunc(entity)}(items), httpx.Page{Page: query.Page, PageSize: query.PageSize, Total: total})`;
    sections.push(`// List handles ${list.method} ${list.path}.
func (h *${handler}) List(c *gin.Context) {
	ctx := c.Request.Context()
	session, err := h.auth.Session(c)
${fail("read")}
${DENY(ruleVar("read"))}
	query, perr := validation.${queryVar(resource)}.Parse(c.Request.URL.Query())
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	where := db.NewWhere()
${filterLines.length ? filterLines.join("\n") + "\n" : ""}	var total int
	if err := h.db.QueryRow(ctx, \`SELECT count(*) FROM \`+${tableC}+where.SQL(), where.Args()...).Scan(&total); err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
${orderLines}	listSQL := \`SELECT \` + ${columnsC} + \` FROM \` + ${tableC} + where.SQL() + \` ORDER BY \` + orderBy + \` LIMIT \` + where.Param(query.PageSize) + \` OFFSET \` + where.Param(query.Offset())
	rows, err := h.db.Query(ctx, listSQL, where.Args()...)
${fail("read")}
	items, err := models.Collect(rows, ${scan})
${fail("read")}
${body}
}`);
  }

  if (get) {
    const body = getIncludes.length
      ? `\titems := []*models.${T}{row}
${loadIncludes(getIncludes, "read")}
	httpx.OK(c, ${rowLiteral(`${prefix}GetRow`, getIncludes, "row")})`
      : `\thttpx.OK(c, ${present}(row))`;
    sections.push(`// Get handles ${get.method} ${get.path}.
func (h *${handler}) Get(c *gin.Context) {
	ctx := c.Request.Context()
	session, err := h.auth.Session(c)
${fail("read")}
${DENY(ruleVar("read"))}
${PARSE_ID(idFunc(resource))}
	row, err := ${scan}(h.db.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE ${pkIdent} = $1\`, id))
${failLoad(entity, "read", ruleVar("read"))}
${(entity.hidden === "not_found" ? HIDE_ROW : DENY_ROW)(ruleVar("read"), entity.rules.read, rowFromStruct(rowColumns(entity.rules.read, allRules), "row"), "read", ruleRowSessionArg(allRules))}
${body}
}`);
  }

  // A row written with a timed field set schedules the entity's timers
  const hasTimers = ir.timers.some(t => t.entity === entity.name);
  if (hasTimers) imports.add(`${modulePath}/generated/scheduling`);
  const timerLines = hasTimers
    ? `\tif err := scheduling.Schedule${typeName(entity)}(ctx, row); err != nil {\n\t\thttpx.HandleError(c, err, "write")\n\t\treturn\n\t}\n`
    : "";
  if (create) {
    const emits = emitLines(eventsFor("created"), `${present}(row)`, "write");
    if (emits.length) imports.add(`${modulePath}/generated/events`);
    const bodyCheck =
      rowRules(create.rule).some(r => r.kind === "member" || r.via?.length) || conditionedRules(create.rule).length > 0
        ? `${DENY_ROW(ruleVar("create"), create.rule, rowFromValues(rowColumns(create.rule, allRules), create.ownerField, identityPk, entity), "write", ruleRowSessionArg(allRules))}\n`
        : "";
    // Under isolation: database a new tenant is bound to the request before the insert, or its own policy would refuse the row
    const bind =
      isTenant && tenancy?.isolation
        ? `	tenantID, err := db.NewID()
${fail("write")}
	values[${q(pk.name)}] = tenantID
	db.BindTenant(ctx, tenantID)
`
        : "";
    const insert =
      isTenant && tenancy && membership
        ? `${bind}	tx, err := h.db.Begin(ctx)
${fail("write")}
	defer tx.Rollback(ctx)
	sql, args := db.Insert(${tableC}, values, ${columnsC})
	row, err := ${scan}(tx.QueryRow(ctx, sql, args...))
${fail("write")}
	if _, err := tx.Exec(ctx, \`INSERT INTO \`+models.${tableConst(membership)}+\` (${quoteIdent(tenancy.userColumn)}, ${quoteIdent(tenancy.tenantColumn)}, ${quoteIdent(tenancy.roleColumn)}) VALUES ($1, $2, $3)\`, session.User.${identityPk}, row.${exported(pk.name)}, ${q(tenancy.creatorRole)}); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}`
        : `	sql, args := db.Insert(${tableC}, values, ${columnsC})
	row, err := ${scan}(h.db.QueryRow(ctx, sql, args...))
${fail("write")}`;
    sections.push(`// Create handles ${create.method} ${create.path}.
func (h *${handler}) Create(c *gin.Context) {
	ctx := c.Request.Context()
	session, err := h.auth.Session(c)
${fail("write")}
${DENY(ruleVar("create"))}
${PARSE_BODY(`validation.${inputVar(resource, "create")}`, "values")}
${bodyCheck}${resolveFiles("values")}${create.ownerField ? `\tvalues[${q(create.ownerField)}] = session.User.${identityPk}\n` : ""}	hookCtx := &hooks.Context{Gin: c, Session: session}
	values, err = ${hooksPkg}.BeforeCreate(hookCtx, values)
${fail("write")}
${insert}
${emits.length ? emits.join("\n") + "\n" : ""}${timerLines}	if err := ${hooksPkg}.AfterCreate(hookCtx, row); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	httpx.Created(c, ${present}(row))
}`);
  }

  if (update) {
    const emits = emitLines(eventsFor("updated"), `${present}(row)`, "write");
    if (emits.length) imports.add(`${modulePath}/generated/events`);
    sections.push(`// Update handles ${update.method} ${update.path}.
func (h *${handler}) Update(c *gin.Context) {
	ctx := c.Request.Context()
	session, err := h.auth.Session(c)
${fail("write")}
${DENY(ruleVar("update"))}
${PARSE_ID(idFunc(resource))}
	existing, err := ${scan}(h.db.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE ${pkIdent} = $1\`, id))
${failLoad(entity, "write", ruleVar("update"))}
${rowChecks(entity, ruleVar("read"), ruleVar("update"), entity.rules.update, "existing", "write", allRules, ruleRowSessionArg(allRules))}
${PARSE_BODY(`validation.${inputVar(resource, "update")}`, "patch")}
${resolveFiles("patch")}	hookCtx := &hooks.Context{Gin: c, Session: session}
	patch, err = ${hooksPkg}.BeforeUpdate(hookCtx, existing, patch)
${fail("write")}
	if len(patch) == 0 {
		httpx.OK(c, ${present}(existing))
		return
	}
	sql, args := db.Update(${tableC}, patch, ${goRaw(pkIdent)}, id, ${columnsC})
	row, err := ${scan}(h.db.QueryRow(ctx, sql, args...))
${fail("write")}
${emits.length ? emits.join("\n") + "\n" : ""}${timerLines}	if err := ${hooksPkg}.AfterUpdate(hookCtx, row); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	httpx.OK(c, ${present}(row))
}`);
  }

  if (remove) {
    const emits = emitLines(eventsFor("deleted"), `${present}(existing)`, "delete");
    if (emits.length) imports.add(`${modulePath}/generated/events`);
    sections.push(`// Delete handles ${remove.method} ${remove.path}.
func (h *${handler}) Delete(c *gin.Context) {
	ctx := c.Request.Context()
	session, err := h.auth.Session(c)
${fail("delete")}
${DENY(ruleVar("delete"))}
${PARSE_ID(idFunc(resource))}
	existing, err := ${scan}(h.db.QueryRow(ctx, \`SELECT \`+${columnsC}+\` FROM \`+${tableC}+\` WHERE ${pkIdent} = $1\`, id))
${failLoad(entity, "delete", ruleVar("delete"))}
${rowChecks(entity, ruleVar("read"), ruleVar("delete"), entity.rules.delete, "existing", "delete", allRules, ruleRowSessionArg(allRules))}
	hookCtx := &hooks.Context{Gin: c, Session: session}
	if err := ${hooksPkg}.BeforeDelete(hookCtx, existing); err != nil {
		httpx.HandleError(c, err, "delete")
		return
	}
	if _, err := h.db.Exec(ctx, ${
    entity.order
      ? `\`SELECT ${quoteIdent(entity.order.remove)}($1)\``
      : `\`DELETE FROM \`+${tableC}+\` WHERE ${pkIdent} = $1\``
  }, id); err != nil {
		httpx.HandleError(c, err, "delete")
		return
	}
${emits.length ? emits.join("\n") + "\n" : ""}	if err := ${hooksPkg}.AfterDelete(hookCtx, existing); err != nil {
		httpx.HandleError(c, err, "delete")
		return
	}
	httpx.NoContent(c)
}`);
  }

  for (const action of actions)
    sections.push(
      actionHandlerMethod(ir, action, handler, actionRuleVar(action), imports, modulePath, { entity, resource })
    );

  if (missing) sections.push(missing);
  if (ruleRow) sections.push(ruleRow);
  for (const inc of [...includes.values()].sort((a, b) => a.rel.name.localeCompare(b.rel.name)))
    sections.push(inc.through ? throughLoaderMethod(ir, inc, entity, handler) : loaderMethod(inc, entity, handler));

  return goFile(
    modulePath,
    HEADER(`Handlers for the ${resource.name} resource (${entity.name}).`),
    "resources",
    imports,
    sections.join("\n\n")
  );
}

/** generated/resources/global_actions.go: the actions not tied to a resource (POST /api/actions/<name>). */
export function globalActionsFile(ir: IR, modulePath: string): string {
  const actions = globalActions(ir).filter(a => a.rule.kind !== "none");
  const imports = new Set<string>([
    "github.com/gin-gonic/gin",
    dbTypeImport(ir, modulePath),
    `${modulePath}/generated/access`,
    `${modulePath}/generated/actions`,
    `${modulePath}/generated/actions/handlers`,
    `${modulePath}/generated/auth`,
    `${modulePath}/generated/httpx`,
    `${modulePath}/generated/validation`
  ]);
  if (actions.some(a => a.returns.kind === "entity")) imports.add(`${modulePath}/generated/models`);
  imports.add("time");
  const ruleVar = (action: ActionIR) => `global${exported(action.name)}ActionRule`;
  const sections: string[] = [];
  sections.push(`// GlobalActions serves the actions not tied to a resource.
type GlobalActions struct {
	db   ${dbType(ir)}
	auth *auth.Auth
}

// NewGlobalActions builds the handlers.
func NewGlobalActions(db ${dbType(ir)}, a *auth.Auth) *GlobalActions {
	return &GlobalActions{db: db, auth: a}
}

// Routes registers every global action.
func (h *GlobalActions) Routes(r gin.IRouter) {
${actions.map(a => `\tr.${a.method}(${q(routePath(a.path))}, h.${actionMethod(a)})`).join("\n")}
}`);
  sections.push(actions.map(a => `var ${ruleVar(a)} = ${ruleLiteral(a.rule)}`).join("\n\n"));
  for (const action of actions)
    sections.push(actionHandlerMethod(ir, action, "GlobalActions", ruleVar(action), imports, modulePath, null));
  return goFile(
    modulePath,
    HEADER("Handlers for the actions not tied to a resource (POST /api/actions/<name>)."),
    "resources",
    imports,
    sections.join("\n\n")
  );
}

function opMethod(kind: OperationIR["kind"]): string {
  return exported(kind);
}

function goRaw(text: string): string {
  return "`" + text + "`";
}

/** src/extensions/<resource>/hooks.go: user-owned hooks, created once. */
export function hooksScaffold(ir: IR, resource: ResourceIR, modulePath: string): GeneratedFile {
  const entity = entityByName(ir, resource.entity);
  const T = `models.${typeName(entity)}`;
  return {
    path: `src/extensions/${resource.name}/hooks.go`,
    mode: "scaffold",
    content: goFile(
      modulePath,
      SCAFFOLD_HEADER(`Hooks around the generated ${resource.name} handlers.`),
      packageName(resource.name),
      [`${modulePath}/generated/hooks`, `${modulePath}/generated/models`],
      `// Return an *httpx.Error from a before-hook to reject the request with that status.

// BeforeCreate may change the values about to be inserted.
func BeforeCreate(ctx *hooks.Context, input models.Values) (models.Values, error) {
	return input, nil
}

// AfterCreate runs once the row exists.
func AfterCreate(ctx *hooks.Context, row *${T}) error {
	return nil
}

// BeforeUpdate may change the patch about to be applied; an empty patch leaves the row as it is.
func BeforeUpdate(ctx *hooks.Context, existing *${T}, patch models.Values) (models.Values, error) {
	return patch, nil
}

// AfterUpdate runs once the row is updated.
func AfterUpdate(ctx *hooks.Context, row *${T}) error {
	return nil
}

// BeforeDelete runs before the row is deleted.
func BeforeDelete(ctx *hooks.Context, row *${T}) error {
	return nil
}

// AfterDelete runs once the row is gone.
func AfterDelete(ctx *hooks.Context, row *${T}) error {
	return nil
}
`
    )
  };
}
