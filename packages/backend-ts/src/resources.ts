import type { ActionIR, EntityIR, GeneratedFile, IR, OperationIR, RelationIR, ResourceIR, RuleIR } from "@osl/core";
import { actionsOf, globalActions } from "@osl/core";
import {
  actionInputName,
  fileSpecsLiteral,
  listRuleFilter,
  needsBodyCheck,
  rowArg,
  ruleLiteral,
  ruleValuesSource
} from "@osl/ts-common";
import {
  HEADER,
  SCAFFOLD_HEADER,
  cap,
  column,
  entityByName,
  q,
  routeFolder,
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

function withClause(include: string[]): string {
  return include.length ? `, with: { ${include.map(i => `${i}: true`).join(", ")} }` : "";
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
  /** Tables the module imports beyond the entity's own: the membership table of a tenant, and the ones rules reach */
  const extraTables = new Set<string>([...(listFilter?.tables ?? []), ...(ruleValues?.tables ?? [])]);
  extraTables.delete(entity.name);

  const drizzleImports = new Set<string>();
  if (get || update || remove || actions.some(a => a.scope === "row") || ruleValues) drizzleImports.add("eq");
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
  if (list?.sortable.length) {
    sections.push(`const SORTABLE = {\n${list.sortable.map(f => `  ${f}: ${table}.${f}`).join(",\n")}\n};

function sortOrder(sort: string): SQL[] {
  const [field, direction] = sort.split(":");
  const column = SORTABLE[field as keyof typeof SORTABLE];
  return [direction === "desc" ? desc(column) : asc(column)];
}`);
  }

  const rowSection = (name: "List" | "Get", include: string[]) => {
    const rels = relationsFor(include);
    const rowType = rels.length
      ? `schema.${T} & { ${rels.map(r => `${r.name}: ${includeType(ir, r)}`).join("; ")} }`
      : `schema.${T}`;
    const extra = rels.length ? `, ${rels.map(r => `${r.name}: ${includePresent(ir, r)}`).join(", ")}` : "";
    return `type ${name}Row = ${rowType};\nfunction present${name}Row(row: ${name}Row) {\n  return { ...present${T}(row)${extra} };\n}`;
  };
  if (list) sections.push(rowSection("List", list.include));
  if (get) sections.push(rowSection("Get", get.include));

  const resolveFiles = (expr: string) => (hasFiles ? `await resolveFileRefs(${expr}, FILE_FIELDS)` : expr);
  const methods: string[] = [];

  if (list) {
    validationImports.add(`${resource.name}ListQuery`);
    httpImports.add("parseQuery");
    const filterLines = list.filters.map(
      f => `    if (filters.${f} !== undefined) conditions.push(eq(${table}.${f}, filters.${f}));`
    );
    filterLines.push(...listFilter!.lines);
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
      ...(list.search.length ? ["q"] : [])
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
      const [rows, [{ total }]] = await Promise.all([
        ${query}.findMany({ where${withClause(list.include)}, orderBy: ${orderBy}, limit: page_size, offset: (page - 1) * page_size }),
        db.select({ total: count() }).from(${table}).where(where)
      ]);
      return ok(rows.map(presentListRow), { page: { page, page_size, total } });
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
      const row = await ${query}.findFirst({ where: eq(${table}.${pk}, id.data)${withClause(get.include)} });
      if (!row) return notFound();
      const rowVerdict = checkRule(RULES.read, session, ${rowArg(get.rule, "row")});
      if (!rowVerdict.ok) return denied(rowVerdict);
      return ok(presentGetRow(row));
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
    const bodyCheck = needsBodyCheck(create.rule)
      ? `      const bodyVerdict = checkRule(RULES.create, session, ${rowArg(create.rule, owner ? `{ ...body.data${owner} }` : "body.data")});
      if (!bodyVerdict.ok) return denied(bodyVerdict);\n`
      : "";
    const insert =
      isTenant && tenancy && membershipTable
        ? `      const row = await db.transaction(async tx => {
        const [created] = await tx.insert(${table}).values(values).returning();
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
${emitLines.join("\n")}
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
    methods.push(`  async update(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(RULES.update, session);
      if (!verdict.ok) return denied(verdict);
      const id = parseId(${resource.name}Id, (await ctx.params).id);
      if (!id.ok) return id.response;
      const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id.data) });
      if (!existing) return notFound();
      const rowVerdict = checkRule(RULES.update, session, ${rowArg(update.rule, "existing")});
      if (!rowVerdict.ok) return denied(rowVerdict);
      const body = await parseBody(${resource.name}UpdateInput, request);
      if (!body.ok) return body.response;
      const hookContext: HookContext = { request, session };
      const patch = await hooks.beforeUpdate(existing, ${resolveFiles("body.data")}, hookContext);
      if (Object.keys(patch).length === 0) return ok(present${T}(existing));
      const [row] = await db.update(${table}).set(patch).where(eq(${table}.${pk}, id.data)).returning();
${emitLines.join("\n")}
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
    methods.push(`  async delete(request: Request, ctx: RouteContext): Promise<Response> {
    try {
      const session = await getSession(request);
      const verdict = checkRule(RULES.delete, session);
      if (!verdict.ok) return denied(verdict);
      const id = parseId(${resource.name}Id, (await ctx.params).id);
      if (!id.ok) return id.response;
      const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id.data) });
      if (!existing) return notFound();
      const rowVerdict = checkRule(RULES.delete, session, ${rowArg(remove.rule, "existing")});
      if (!rowVerdict.ok) return denied(rowVerdict);
      const hookContext: HookContext = { request, session };
      await hooks.beforeDelete(existing, hookContext);
      await db.delete(${table}).where(eq(${table}.${pk}, id.data));
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
        actionEvents: actionEvents(action.name)
      })
    );
  }

  const usesSql = Boolean(list);
  const imports = [
    ...(drizzleImports.size
      ? [`import { ${[...drizzleImports].sort().join(", ")}${usesSql ? ", type SQL" : ""} } from "drizzle-orm";`]
      : []),
    `import { db } from "../db/client";`,
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
    ...(actions.length ? [`import { handlers } from "../actions";`] : []),
    `import { getSession, type Session } from "../auth";`,
    ...(usesEmit ? [`import { emit } from "../events";`] : []),
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
  row: { table: string; query: string; pk: string; idName: string; T: string; actionEvents: IR["events"] } | null
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
      if (!current) return notFound();
      const rowVerdict = checkRule(${rulesRef}, session, ${rowArg(action.rule, "current")});
      if (!rowVerdict.ok) return denied(rowVerdict);
      const body = await parseBody(${input}, request);
      if (!body.ok) return body.response;
      const result = await handlers.${action.handler}({ input: body.data, row: current, session, db });
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
      const result = await handlers.${action.handler}({ input: body.data, row: undefined, session, db });
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
        ? `export async function ${op.method}(request: Request, ctx: RouteContext): Promise<Response> {\n  return ${resource.name}.${fn}(request, ctx);\n}`
        : `export async function ${op.method}(request: Request): Promise<Response> {\n  return ${resource.name}.${fn}(request);\n}`;
    });
    files.push({
      path: `app/${routeFolder(pathTemplate)}/route.ts`,
      content: `${HEADER(`Routes for ${pathTemplate}.`)}
import { ${resource.name}${withCtx ? ", type RouteContext" : ""} } from "@/generated/resources/${resource.name}";

${exports.join("\n\n")}
`
    });
  }
  for (const action of actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none")) {
    const withCtx = action.scope === "row";
    files.push({
      path: `app/${routeFolder(action.path)}/route.ts`,
      content: `${HEADER(`Route for the ${action.name} action: POST ${action.path}.`)}
import { ${resource.name}${withCtx ? ", type RouteContext" : ""} } from "@/generated/resources/${resource.name}";

${
  withCtx
    ? `export async function POST(request: Request, ctx: RouteContext): Promise<Response> {\n  return ${resource.name}.${actionMethod(action)}(request, ctx);\n}`
    : `export async function POST(request: Request): Promise<Response> {\n  return ${resource.name}.${actionMethod(action)}(request);\n}`
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
import { actions } from "@/generated/actions-api";

export async function POST(request: Request): Promise<Response> {
  return actions.${actionMethod(action)}(request);
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
