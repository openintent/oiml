import type { ActionIR, EntityIR, GeneratedFile, IR, OperationIR, RelationIR, ResourceIR, RuleIR } from "@osl/core";
import { actionsOf, globalActions } from "@osl/core";
import {
  hasVia,
  actionInputName,
  fileSpecsLiteral,
  listRuleFilter,
  conditionDefaults,
  needsBodyCheck,
  rowArg,
  ruleLiteral,
  ruleValuesSource,
  ARCHIVE_DRIZZLE,
  archiveCondition,
  isMove,
  isStatementAction,
  rowActionImports,
  statementHandlerLines,
  moveSource,
  removeStatement,
  throughOf,
  throughRowParts,
  throughSource,
  withClause
} from "@osl/ts-common";
import {
  HEADER,
  SCAFFOLD_HEADER,
  cap,
  column,
  entityByName,
  q,
  routeFolder,
  scoped,
  scopedImport,
  singlePrimaryKey,
  tableExport,
  typeName
} from "./util.js";

function includeType(ir: IR, rel: RelationIR): string {
  const target = entityByName(ir, rel.target);
  return rel.kind === "many" ? `schema.${typeName(target)}[]` : `schema.${typeName(target)} | null`;
}

function includePresent(ir: IR, rel: RelationIR): string {
  const target = entityByName(ir, rel.target);
  if (rel.kind === "many") return `row.${rel.name}.map(present${typeName(target)})`;
  return `row.${rel.name} ? present${typeName(target)}(row.${rel.name}) : null`;
}

function isIntegerKey(entity: EntityIR): boolean {
  const pk = singlePrimaryKey(entity);
  return pk.type.kind === "scalar" && (pk.type.scalar === "integer" || pk.type.scalar === "bigint");
}

/** The TypeScript array type of tenant ids for inArray, by the tenant key's type */
function tenantIdsCast(ir: IR): string {
  const t = ir.auth?.tenancy;
  if (!t) return "as string[]";
  return isIntegerKey(entityByName(ir, t.entity)) ? "as number[]" : "as string[]";
}

/** generated/resources/<name>.ts */
export function resourceFile(ir: IR, resource: ResourceIR): string {
  const entity = entityByName(ir, resource.entity);
  const T = typeName(entity);
  const table = `${tableExport(entity)}Table`;
  const query = `db.query.${tableExport(entity)}`;
  const pk = singlePrimaryKey(entity).name;
  // A row written with a timed field set schedules the entity's timers
  const hasTimers = ir.timers.some(t => t.entity === entity.name);
  const timerLine = hasTimers ? `\n      await scheduleTimers(${q(entity.name)}, row);` : "";
  const ops = resource.operations.filter(o => o.rule.kind !== "none");
  const list = ops.find(o => o.kind === "list") as Extract<OperationIR, { kind: "list" }> | undefined;
  const get = ops.find(o => o.kind === "get") as Extract<OperationIR, { kind: "get" }> | undefined;
  const create = ops.find(o => o.kind === "create") as Extract<OperationIR, { kind: "create" }> | undefined;
  const update = ops.find(o => o.kind === "update") as Extract<OperationIR, { kind: "update" }> | undefined;
  const remove = ops.find(o => o.kind === "delete") as Extract<OperationIR, { kind: "delete" }> | undefined;
  const actions = actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none");
  const events = (action: "created" | "updated" | "deleted") =>
    ir.events.filter(e => e.kind === "entity" && e.entity === entity.name && e.action === action);
  const actionEvents = (name: string) =>
    ir.events.filter(e => e.kind === "action" && e.resource === resource.name && e.actionName === name);
  const hasFiles = entity.columns.some(c => c.type.kind === "file");
  const tenancy = ir.auth?.tenancy;
  const isTenant = tenancy?.entity === entity.name;
  const membershipTable = tenancy ? `${tableExport(entityByName(ir, tenancy.membership))}Table` : null;
  const tableVar = (e: EntityIR) => `${tableExport(e)}Table`;
  const me = `session!.user.${identityPk(ir)}`;
  // Under isolation: database the policy hides another tenant's row from the load: the probe tells it from a missing one
  const isolated = Boolean(tenancy?.isolation);
  const probe = entity.tenant?.exists;
  const miss = (ruleRef: string) => (probe ? `missing(id.data, ${ruleRef}, session)` : "notFound()");
  /**
   * The checks after a row is loaded: with hidden rows answered as not found, the read rule first (a hidden row
   * answers 404), then the operation's own rule, both reading one resolution of the paths they follow.
   */
  const rowChecks = (own: RuleIR, rowVar: string): { lines: string; arg: string } => {
    if (entity.hidden !== "not_found") return { lines: "", arg: rowArg(own, rowVar, sessionArg) };
    const via = hasVia(entity.rules.read) || hasVia(own);
    const arg = via ? `${rowVar}Values` : rowVar;
    const resolve = via ? `\n      const ${arg} = await withRuleValues(${rowVar}${sessionArg});` : "";
    return { lines: `${resolve}\n      if (!checkRule(RULES.read, session, ${arg}).ok) return notFound();`, arg };
  };
  const listFilter = list
    ? listRuleFilter(ir, entity, list.rule, {
        ruleRef: "RULES.read",
        session: "session",
        me,
        empty: "return ok([], { page: { page, page_size, total: 0 } });",
        tableVar,
        tenantCast: tenantIdsCast(ir),
        indent: "    "
      })
    : null;
  const ruleValues = ruleValuesSource(
    ir,
    [entity.rules.read, entity.rules.create, entity.rules.update, entity.rules.delete, ...actions.map(a => a.rule)],
    tableVar
  );
  /** withRuleValues takes the session when a rule ends in a membership relation (the caller's own row is looked up) */
  const sessionArg = ruleValues?.needsSession ? ", session" : "";
  /** Tables the module imports beyond the entity's own: the membership table of a tenant, and the ones rules reach */
  const extraTables = new Set<string>([...(listFilter?.tables ?? []), ...(ruleValues?.tables ?? [])]);
  extraTables.delete(entity.name);

  const drizzleImports = new Set<string>();
  if (get || update || remove || actions.some(a => a.scope === "row") || ruleValues) drizzleImports.add("eq");
  for (const name of ruleValues?.drizzle ?? []) drizzleImports.add(name);
  if (list) {
    drizzleImports.add("count");
    drizzleImports.add("and");
    if (list.filters.length) drizzleImports.add("eq");
    for (const name of listFilter!.drizzle) drizzleImports.add(name);
    if (list.search.length) {
      drizzleImports.add("ilike");
      drizzleImports.add("or");
    }
    for (const [, dir] of list.order) drizzleImports.add(dir);
    if (list.sortable.length) {
      drizzleImports.add("asc");
      drizzleImports.add("desc");
    }
  }
  const presents = new Set<string>([`present${T}`]);
  const validationImports = new Set<string>([`${resource.name}Id`]);
  const httpImports = new Set<string>(["handleError", "notFound", "ok"]);
  const accessImports = new Set<string>(["checkRule", "denied"]);
  for (const name of listFilter?.access ?? []) accessImports.add(name);
  const usesEmit =
    ["created", "updated", "deleted"].some(a => events(a as "created").length > 0) ||
    actions.some(a => actionEvents(a.name).length > 0);

  const relationsFor = (include: string[]) => include.map(name => entity.relations.find(r => r.name === name)!);
  for (const rel of [...relationsFor(list?.include ?? []), ...relationsFor(get?.include ?? [])])
    presents.add(`present${typeName(entityByName(ir, rel.target))}`);
  // Relations through a junction: loaded after the rows, one statement per relation
  const through = throughSource(ir, entity, list?.through, get?.through, tableVar);
  for (const name of through.presents) presents.add(name);
  for (const name of through.tables) if (name !== entity.name) extraTables.add(name);
  for (const name of through.drizzle) drizzleImports.add(name);
  const move = actions.find(isMove);
  if (move || (remove && entity.order)) drizzleImports.add("sql");
  // An archiving entity: the list's own condition
  if (entity.archive && list) for (const name of ARCHIVE_DRIZZLE) drizzleImports.add(name);
  // The compiler's one-statement row actions (archive, restore, the transitions) answer 409 when nothing changed
  const statements = rowActionImports(ir, actions);
  if (statements.length) httpImports.add("fail");

  const sections: string[] = [];

  sections.push(`const RULES = {
  read: ${ruleLiteral(entity.rules.read)} as Rule,
  create: ${ruleLiteral(entity.rules.create)} as Rule,
  update: ${ruleLiteral(entity.rules.update)} as Rule,
  delete: ${ruleLiteral(entity.rules.delete)} as Rule
};`);
  if (actions.length)
    sections.push(
      `const ACTION_RULES = {\n${actions.map(a => `  ${a.name}: ${ruleLiteral(a.rule)} as Rule`).join(",\n")}\n};`
    );
  if (hasFiles)
    sections.push(`/** File fields and what they accept */\nconst FILE_FIELDS = ${fileSpecsLiteral(entity)} as const;`);
  if (ruleValues) sections.push(ruleValues.source);
  if (probe && (get || update || remove || actions.some(a => a.scope === "row"))) {
    accessImports.add("unreachable");
    sections.push(`/** No row came back: another tenant's row answers as the rule answers a caller it refuses, a missing one 404 */
async function missing(id: unknown, rule: Rule, session: Session | null): Promise<Response> {
  return (await rowExists(${q(probe)}, id)) ? denied(unreachable(rule, session)) : notFound();
}`);
  }
  if (list?.sortable.length) {
    sections.push(`const SORTABLE = {\n${list.sortable.map(f => `  ${f}: ${table}.${f}`).join(",\n")}\n};

function sortOrder(sort: string): SQL[] {
  const [field, direction] = sort.split(":");
  const column = SORTABLE[field as keyof typeof SORTABLE];
  return [direction === "desc" ? desc(column) : asc(column)];
}`);
  }

  const rowSection = (name: "List" | "Get", include: string[], throughNames: string[] | undefined) => {
    const rels = relationsFor(include);
    const far = throughRowParts(ir, throughOf(entity, throughNames));
    const types = [...rels.map(r => `${r.name}: ${includeType(ir, r)}`), ...far.types];
    const shown = [...rels.map(r => `${r.name}: ${includePresent(ir, r)}`), ...far.presents];
    const rowType = types.length ? `schema.${T} & { ${types.join("; ")} }` : `schema.${T}`;
    const extra = shown.length ? `, ${shown.join(", ")}` : "";
    return `type ${name}Row = ${rowType};\nfunction present${name}Row(row: ${name}Row) {\n  return { ...present${T}(row)${extra} };\n}`;
  };
  if (list) sections.push(rowSection("List", list.include, list.through));
  if (get) sections.push(rowSection("Get", get.include, get.through));
  sections.push(...through.sections);
  if (move) sections.push(moveSource(entity, table, query));

  const resolveFiles = (expr: string) => (hasFiles ? `await resolveFileRefs(${expr}, FILE_FIELDS)` : expr);
  const methods: string[] = [];

  if (list) {
    validationImports.add(`${resource.name}ListQuery`);
    httpImports.add("parseQuery");
    const filterLines = list.filters.map(
      f => `    if (filters.${f} !== undefined) conditions.push(eq(${table}.${f}, filters.${f}));`
    );
    filterLines.push(...listFilter!.lines);
    if (entity.archive) filterLines.push(archiveCondition(entity, table, "    "));
    if (list.search.length) {
      filterLines.push(`    if (q) {
        const pattern = "%" + q.replace(/[\\\\%_]/g, "\\\\$&") + "%";
        conditions.push(or(${list.search.map(f => `ilike(${table}.${f}, pattern)`).join(", ")})!);
      }`);
    }
    const defaultOrder = list.order.map(([col, dir]) => `${dir}(${table}.${col})`).join(", ");
    const orderBy = list.sortable.length ? `sort ? sortOrder(sort) : [${defaultOrder}]` : `[${defaultOrder}]`;
    const picks = [
      "page",
      "page_size",
      ...(list.sortable.length ? ["sort"] : []),
      ...(list.search.length ? ["q"] : []),
      ...(entity.archive ? ["archived"] : [])
    ];
    const destructure = list.filters.length
      ? `const { ${picks.join(", ")}, ...filters } = query.data;`
      : `const { ${picks.join(", ")} } = query.data;`;
    methods.push(`  async list(request: Request): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(RULES.read, session);
      if (!verdict.ok) return denied(verdict);
      const query = parseQuery(${resource.name}ListQuery, request);
      if (!query.ok) return query.response;
      ${destructure}
      const conditions: SQL[] = [];
${filterLines.join("\n")}
      const where = conditions.length ? and(...conditions) : undefined;
${
  isolated
    ? `      // One statement at a time: both run on the request's transaction
      const rows = await ${query}.findMany({ where${withClause(entity, list.include)}, orderBy: ${orderBy}, limit: page_size, offset: (page - 1) * page_size });
      const [{ total }] = await db.select({ total: count() }).from(${table}).where(where);`
    : `      const [rows, [{ total }]] = await Promise.all([
        ${query}.findMany({ where${withClause(entity, list.include)}, orderBy: ${orderBy}, limit: page_size, offset: (page - 1) * page_size }),
        db.select({ total: count() }).from(${table}).where(where)
      ]);`
}
      return ok(${through.list("rows")}.map(presentListRow), { page: { page, page_size, total } });
    } catch (err) {
      return handleError(err, "read");
    }
  }`);
  }

  if (get) {
    httpImports.add("parseId");
    methods.push(`  async get(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(RULES.read, session);
      if (!verdict.ok) return denied(verdict);
      const id = parseId(${resource.name}Id, (await ctx.params).id);
      if (!id.ok) return id.response;
      const row = await ${query}.findFirst({ where: eq(${table}.${pk}, id.data)${withClause(entity, get.include)} });
      if (!row) return ${miss("RULES.read")};
      const rowVerdict = checkRule(RULES.read, session, ${rowArg(get.rule, "row", sessionArg)});
      if (!rowVerdict.ok) return ${entity.hidden === "not_found" ? "notFound()" : "denied(rowVerdict)"};
      return ok(presentGetRow(${through.get("row")}));
    } catch (err) {
      return handleError(err, "read");
    }
  }`);
  }

  if (create) {
    validationImports.add(`${resource.name}CreateInput`);
    httpImports.add("parseBody");
    httpImports.add("created");
    const owner = create.ownerField ? `, ${create.ownerField}: ${me}` : "";
    const emitLines = events("created").map(e => `      await emit(${q(e.name)}, present${T}(row));`);
    const defaults = conditionDefaults(entity, create.rule);
    const bodyCheck = needsBodyCheck(create.rule)
      ? `      const bodyVerdict = checkRule(RULES.create, session, ${rowArg(create.rule, owner || defaults ? `{ ${defaults}...body.data${owner} }` : "body.data", sessionArg)});
      if (!bodyVerdict.ok) return denied(bodyVerdict);\n`
      : "";
    // Under isolation: database a new tenant is bound to the request before the insert, or its own policy would refuse the row
    const bind = isTenant && isolated;
    const insert =
      isTenant && tenancy && membershipTable
        ? `${bind ? `      const tenantId = randomUUID();\n      await bindTenant(tenantId);\n` : ""}      const row = await db.transaction(async tx => {
        const [created] = await tx.insert(${table}).values(${bind ? `{ ...values, ${pk}: tenantId }` : "values"}).returning();
        await tx.insert(${membershipTable}).values({ ${tenancy.userColumn}: session!.user.${identityPk(ir)}, ${tenancy.tenantColumn}: created.${pk}, ${tenancy.roleColumn}: ${q(tenancy.creatorRole)} });
        return created;
      });`
        : `      const [row] = await db.insert(${table}).values(values).returning();`;
    methods.push(`  async create(request: Request): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(RULES.create, session);
      if (!verdict.ok) return denied(verdict);
      const body = await parseBody(${resource.name}CreateInput, request);
      if (!body.ok) return body.response;
${bodyCheck}      const hookContext: HookContext = { request, session };
      const values = await hooks.beforeCreate({ ...${resolveFiles("body.data")}${owner} }, hookContext);
${insert}
${emitLines.join("\n")}${timerLine}
      await hooks.afterCreate(row, hookContext);
      return created(present${T}(row));
    } catch (err) {
      return handleError(err, "write");
    }
  }`);
  }

  if (update) {
    validationImports.add(`${resource.name}UpdateInput`);
    httpImports.add("parseBody");
    httpImports.add("parseId");
    const emitLines = events("updated").map(e => `      await emit(${q(e.name)}, present${T}(row));`);
    const updateChecks = rowChecks(update.rule, "existing");
    methods.push(`  async update(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(RULES.update, session);
      if (!verdict.ok) return denied(verdict);
      const id = parseId(${resource.name}Id, (await ctx.params).id);
      if (!id.ok) return id.response;
      const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id.data) });
      if (!existing) return ${miss("RULES.update")};${updateChecks.lines}
      const rowVerdict = checkRule(RULES.update, session, ${updateChecks.arg});
      if (!rowVerdict.ok) return denied(rowVerdict);
      const body = await parseBody(${resource.name}UpdateInput, request);
      if (!body.ok) return body.response;
      const hookContext: HookContext = { request, session };
      const patch = await hooks.beforeUpdate(existing, ${resolveFiles("body.data")}, hookContext);
      if (Object.keys(patch).length === 0) return ok(present${T}(existing));
      const [row] = await db.update(${table}).set(patch).where(eq(${table}.${pk}, id.data)).returning();
${emitLines.join("\n")}${timerLine}
      await hooks.afterUpdate(row, hookContext);
      return ok(present${T}(row));
    } catch (err) {
      return handleError(err, "write");
    }
  }`);
  }

  if (remove) {
    httpImports.add("parseId");
    httpImports.add("noContent");
    const emitLines = events("deleted").map(e => `      await emit(${q(e.name)}, present${T}(existing));`);
    const deleteChecks = rowChecks(remove.rule, "existing");
    methods.push(`  async delete(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(RULES.delete, session);
      if (!verdict.ok) return denied(verdict);
      const id = parseId(${resource.name}Id, (await ctx.params).id);
      if (!id.ok) return id.response;
      const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id.data) });
      if (!existing) return ${miss("RULES.delete")};${deleteChecks.lines}
      const rowVerdict = checkRule(RULES.delete, session, ${deleteChecks.arg});
      if (!rowVerdict.ok) return denied(rowVerdict);
      const hookContext: HookContext = { request, session };
      await hooks.beforeDelete(existing, hookContext);
      ${removeStatement(entity, "id.data") ?? `await db.delete(${table}).where(eq(${table}.${pk}, id.data));`}
${emitLines.join("\n")}
      await hooks.afterDelete(existing, hookContext);
      return noContent();
    } catch (err) {
      return handleError(err, "delete");
    }
  }`);
  }

  for (const action of actions) {
    validationImports.add(actionInputName(action));
    httpImports.add("parseBody");
    if (action.scope === "row") httpImports.add("parseId");
    if (action.returns.kind === "none") httpImports.add("noContent");
    methods.push(
      actionHandler(ir, action, {
        table,
        query,
        pk,
        idName: `${resource.name}Id`,
        T,
        actionEvents: actionEvents(action.name),
        checks: rowChecks(action.rule, "current"),
        miss: miss(`ACTION_RULES.${action.name}`)
      })
    );
  }

  const usesSql = Boolean(list);
  const imports = [
    ...(drizzleImports.size
      ? [`import { ${[...drizzleImports].sort().join(", ")}${usesSql ? ", type SQL" : ""} } from "drizzle-orm";`]
      : []),
    ...(isTenant && isolated && create ? [`import { randomUUID } from "node:crypto";`] : []),
    `import { ${["db", ...(isTenant && isolated && create ? ["bindTenant"] : []), ...(accessImports.has("unreachable") ? ["rowExists"] : [])].join(", ")} } from "../db/client";`,
    `import * as schema from "../db/schema";`,
    `import { ${[
      `${tableExport(entity)} as ${table}`,
      ...(isTenant && membershipTable ? [`${membershipTable.replace(/Table$/, "")} as ${membershipTable}`] : []),
      ...[...extraTables]
        .filter(name => !(isTenant && tenancy && name === tenancy.membership))
        .sort()
        .map(name => `${tableExport(entityByName(ir, name))} as ${tableVar(entityByName(ir, name))}`)
    ].join(", ")} } from "../db/schema";`,
    `import { ${[...accessImports].sort().join(", ")}, type Rule } from "../access";`,
    ...(actions.some(a => !a.builtin) ? [`import { handlers } from "../actions";`] : []),
    ...(statements.length ? [`import { ${statements.join(", ")} } from "../row-actions";`] : []),
    `import { getSession, type Session } from "../auth";`,
    ...(usesEmit ? [`import { emit } from "../events";`] : []),
    ...(hasTimers ? [`import { scheduleTimers } from "../scheduling";`] : []),
    ...(hasFiles ? [`import { resolveFileRefs } from "../files";`] : []),
    `import { ${[...httpImports].sort().join(", ")} } from "../http";`,
    `import { ${[...presents].sort().join(", ")} } from "../present";`,
    `import { ${[...validationImports].sort().join(", ")} } from "../validation";`,
    `import { hooks } from "@/src/extensions/${resource.name}";`
  ];

  return `${HEADER(`Handlers for the ${resource.name} resource (${entity.name}).`)}
${imports.join("\n")}

export type RouteContext = { params: Promise<{ id: string }> };
export type HookContext = { request: Request; session: Session | null };

${sections.join("\n\n")}

export const ${resource.name} = {
${methods.join(",\n\n")}
};
`;
}

/** A REST handler for an action, inside a resource module or the global actions module */
function actionHandler(
  ir: IR,
  action: ActionIR,
  row: {
    table: string;
    query: string;
    pk: string;
    idName: string;
    T: string;
    actionEvents: IR["events"];
    /** The checks after the row is loaded (a hidden row's 404 when the entity asks for it) and the row the action's own check reads */
    checks: { lines: string; arg: string };
    /** What a row that did not come back answers: notFound(), or under isolation the probe's answer */
    miss: string;
  } | null
): string {
  const input = actionInputName(action);
  const present = action.returns.kind === "entity" ? `present${row!.T}` : null;
  const answer =
    action.returns.kind === "entity"
      ? `ok(${present}(result))`
      : action.returns.kind === "none"
        ? "noContent()"
        : "ok(result)";
  const eventsFor =
    row?.actionEvents ?? ir.events.filter(e => e.kind === "action" && !e.resource && e.actionName === action.name);
  const emitLines = eventsFor.map(
    e =>
      `      await emit(${q(e.name)}, ${action.returns.kind === "entity" ? `${present}(result)` : action.returns.kind === "none" ? "{}" : "result"});`
  );
  const rulesRef = row ? `ACTION_RULES.${action.name}` : `RULES.${action.name}`;
  const fn = cap(action.name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()));
  const name = fn.charAt(0).toLowerCase() + fn.slice(1);
  if (action.scope === "row" && row) {
    return `  /** POST ${action.path} */
  async ${name}(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(${rulesRef}, session);
      if (!verdict.ok) return denied(verdict);
      const id = parseId(${row.idName}, (await ctx.params).id);
      if (!id.ok) return id.response;
      const current = await ${row.query}.findFirst({ where: eq(${row.table}.${row.pk}, id.data) });
      if (!current) return ${row.miss};${row.checks.lines}
      const rowVerdict = checkRule(${rulesRef}, session, ${row.checks.arg});
      if (!rowVerdict.ok) return denied(rowVerdict);
      const body = await parseBody(${input}, request);
      if (!body.ok) return body.response;
      ${
        isMove(action)
          ? `const result = await moveRow(current, body.data.to);\n      if (!result) return notFound();`
          : isStatementAction(action)
            ? statementHandlerLines(ir, action, "current").join("\n      ")
            : `const result = await handlers.${action.handler}({ input: body.data, row: current, session, db, now: new Date() });`
      }
${emitLines.join("\n")}
      return ${answer};
    } catch (err) {
      return handleError(err, "write");
    }
  }`;
  }
  return `  /** POST ${action.path} */
  async ${name}(request: Request): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(${rulesRef}, session);
      if (!verdict.ok) return denied(verdict);
      const body = await parseBody(${input}, request);
      if (!body.ok) return body.response;
      const result = await handlers.${action.handler}({ input: body.data, row: undefined, session, db, now: new Date() });
${emitLines.join("\n")}
      return ${answer};
    } catch (err) {
      return handleError(err, "write");
    }
  }`;
}

/** The method name of an action on its resource or actions object */
export function actionMethod(action: ActionIR): string {
  const fn = cap(action.name.replace(/_(\w)/g, (_, c: string) => c.toUpperCase()));
  return fn.charAt(0).toLowerCase() + fn.slice(1);
}

/** generated/actions-api.ts: the handlers for actions not tied to a resource */
export function actionsApiFile(ir: IR): string {
  const actions = globalActions(ir).filter(a => a.rule.kind !== "none");
  const usesEmit = actions.some(a =>
    ir.events.some(e => e.kind === "action" && !e.resource && e.actionName === a.name)
  );
  const httpImports = new Set<string>(["handleError", "ok", "parseBody"]);
  if (actions.some(a => a.returns.kind === "none")) httpImports.add("noContent");
  return `${HEADER("Handlers for the actions not tied to a resource (POST /api/actions/<name>).")}
import { db } from "./db/client";
import { checkRule, denied, type Rule } from "./access";
import { handlers } from "./actions";
import { getSession } from "./auth";
${usesEmit ? `import { emit } from "./events";\n` : ""}import { ${[...httpImports].sort().join(", ")} } from "./http";
import { ${actions.map(actionInputName).sort().join(", ")} } from "./validation";

const RULES = {
${actions.map(a => `  ${a.name}: ${ruleLiteral(a.rule)} as Rule`).join(",\n")}
};

export const actions = {
${actions.map(a => actionHandler(ir, a, null)).join(",\n\n")}
};
`;
}

function identityPk(ir: IR): string {
  return ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
}

/** app/api/... route files for a resource, including its actions */
export function routeFiles(ir: IR, resource: ResourceIR): GeneratedFile[] {
  const ops = resource.operations.filter(o => o.rule.kind !== "none");
  const byPath = new Map<string, OperationIR[]>();
  for (const op of ops) (byPath.get(op.path) ?? byPath.set(op.path, []).get(op.path)!).push(op);
  const files: GeneratedFile[] = [];
  for (const [pathTemplate, pathOps] of byPath) {
    const withCtx = pathTemplate.includes("{");
    const exports = pathOps.map(op => {
      const fn = op.kind === "delete" ? "delete" : op.kind;
      return withCtx
        ? `export async function ${op.method}(request: Request, ctx: RouteContext): Promise<Response> {\n  return ${scoped(ir, `${resource.name}.${fn}(request, ctx)`)};\n}`
        : `export async function ${op.method}(request: Request): Promise<Response> {\n  return ${scoped(ir, `${resource.name}.${fn}(request)`)};\n}`;
    });
    files.push({
      path: `app/${routeFolder(pathTemplate)}/route.ts`,
      content: `${HEADER(`Routes for ${pathTemplate}.`)}
${scopedImport(ir)}import { ${resource.name}${withCtx ? ", type RouteContext" : ""} } from "@/generated/resources/${resource.name}";

${exports.join("\n\n")}
`
    });
  }
  for (const action of actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none")) {
    const withCtx = action.scope === "row";
    files.push({
      path: `app/${routeFolder(action.path)}/route.ts`,
      content: `${HEADER(`Route for the ${action.name} action: POST ${action.path}.`)}
${scopedImport(ir)}import { ${resource.name}${withCtx ? ", type RouteContext" : ""} } from "@/generated/resources/${resource.name}";

${
  withCtx
    ? `export async function POST(request: Request, ctx: RouteContext): Promise<Response> {\n  return ${scoped(ir, `${resource.name}.${actionMethod(action)}(request, ctx)`)};\n}`
    : `export async function POST(request: Request): Promise<Response> {\n  return ${scoped(ir, `${resource.name}.${actionMethod(action)}(request)`)};\n}`
}
`
    });
  }
  return files;
}

/** app/api/actions/<name>/route.ts for the global actions */
export function globalActionRouteFiles(ir: IR): GeneratedFile[] {
  return globalActions(ir)
    .filter(a => a.rule.kind !== "none")
    .map(action => ({
      path: `app/${routeFolder(action.path)}/route.ts`,
      content: `${HEADER(`Route for the ${action.name} action: POST ${action.path}.`)}
${scopedImport(ir)}import { actions } from "@/generated/actions-api";

export async function POST(request: Request): Promise<Response> {
  return ${scoped(ir, `actions.${actionMethod(action)}(request)`)};
}
`
    }));
}

/** src/extensions/<resource>.ts: user-owned hooks, created once. */
export function hooksScaffold(ir: IR, resource: ResourceIR): GeneratedFile {
  const entity = entityByName(ir, resource.entity);
  const T = typeName(entity);
  return {
    path: `src/extensions/${resource.name}.ts`,
    mode: "scaffold",
    content: `${SCAFFOLD_HEADER(`Hooks around the generated ${resource.name} handlers.`)}
import type { ${T}, New${T} } from "@/generated/db/schema";
import type { HookContext } from "@/generated/resources/${resource.name}";

// Throw an HttpError from "@/generated/http" in a before-hook to reject the request.
export const hooks = {
  async beforeCreate(input: New${T}, _ctx: HookContext): Promise<New${T}> {
    return input;
  },
  async afterCreate(_row: ${T}, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: ${T}, patch: Partial<New${T}>, _ctx: HookContext): Promise<Partial<New${T}>> {
    return patch;
  },
  async afterUpdate(_row: ${T}, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: ${T}, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: ${T}, _ctx: HookContext): Promise<void> {}
};
`
  };
}

export { column, cap, type EntityIR };
