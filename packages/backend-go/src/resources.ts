import type {
  ActionIR,
  EntityIR,
  EventIR,
  GeneratedFile,
  IR,
  OperationIR,
  RelationIR,
  ResourceIR,
  RuleIR
} from "@osl/core";
import { actionsOf, globalActions } from "@osl/core";
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
  ruleLiteral,
  singlePrimaryKey,
  typeName
} from "./util.js";
import { actionInputVar, idFunc, inputVar, queryVar } from "./validation.js";

/** Go expression of the row's value the rule is about (the owner or the tenant), or nil when the rule is not about a row */
function ruleValue(rule: RuleIR, row: string): string {
  return rule.kind === "owner" || rule.kind === "member" ? `${row}.${exported(rule.field)}` : "nil";
}

function routePath(pathTemplate: string): string {
  return pathTemplate.replace(/\{([a-z_]+)\}/g, ":$1");
}

function fail(op: "read" | "write" | "delete"): string {
  return `\tif err != nil {\n\t\thttpx.HandleError(c, err, ${q(op)})\n\t\treturn\n\t}`;
}

const DENY = (ruleVar: string, rowExpr?: string) =>
  rowExpr === undefined
    ? `\tif verdict := access.Check(${ruleVar}, session); verdict != nil {\n\t\taccess.Deny(c, verdict)\n\t\treturn\n\t}`
    : `\tif verdict := access.CheckRow(${ruleVar}, session, ${rowExpr}); verdict != nil {\n\t\taccess.Deny(c, verdict)\n\t\treturn\n\t}`;

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
  const order = target.primaryKey.map(quoteIdent).join(", ");
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
    lines.push(fail("write"));
    lines.push(DENY(ruleVar, ruleValue(action.rule, "row")));
    args.push("row");
  }
  lines.push(PARSE_BODY(`validation.${actionInputVar(action)}`, "values"));
  lines.push(`\tactx := &actions.Context{Gin: c, Session: session, DB: h.db}`);
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
    "github.com/jackc/pgx/v5/pgxpool",
    `${modulePath}/generated/access`,
    `${modulePath}/generated/auth`,
    `${modulePath}/generated/httpx`,
    `${modulePath}/generated/models`,
    `${modulePath}/generated/validation`
  ]);
  if (list || create || update) imports.add(`${modulePath}/generated/db`);
  if (create || update || remove) {
    imports.add(`${modulePath}/generated/hooks`);
    imports.add(`${hooksPkg} ${modulePath}/src/extensions/${resource.name}`);
  }
  if (files.length && (create || update)) imports.add(`${modulePath}/generated/files`);
  if (actions.length) {
    imports.add(`${modulePath}/generated/actions`);
    imports.add(`${modulePath}/generated/actions/handlers`);
  }

  const includes = new Map<string, Include>();
  const listIncludes = (list?.include ?? []).map(name => includeOf(ir, entity, name));
  const getIncludes = (get?.include ?? []).map(name => includeOf(ir, entity, name));
  for (const inc of [...listIncludes, ...getIncludes]) includes.set(inc.rel.name, inc);
  if (includes.size) imports.add("context");

  const sections: string[] = [];
  const routes = [
    ...ops.map(op => `\tr.${op.method}(${q(routePath(op.path))}, h.${opMethod(op.kind)})`),
    ...actions.map(a => `\tr.${a.method}(${q(routePath(a.path))}, h.${actionMethod(a)})`)
  ];
  sections.push(`// ${handler} serves the ${resource.name} resource (${entity.name}).
type ${handler} struct {
	db   *pgxpool.Pool
	auth *auth.Auth
}

// New${handler} builds the handlers.
func New${handler}(db *pgxpool.Pool, a *auth.Auth) *${handler} {
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
    if (list.rule.kind === "owner")
      filterLines.push(`\twhere.Eq(${goRaw(quoteIdent(list.rule.field))}, session.User.${identityPk})`);
    if (list.rule.kind === "member") {
      const empty = listIncludes.length ? `[]${prefix}ListRow{}` : `models.${presentManyFunc(entity)}(nil)`;
      filterLines.push(`\ttenants := access.MemberTenantIDs(session, ${q(list.rule.role ?? "")})
	if len(tenants) == 0 {
		httpx.List(c, ${empty}, httpx.Page{Page: query.Page, PageSize: query.PageSize, Total: 0})
		return
	}
	where.In(${goRaw(quoteIdent(list.rule.field))}, tenants)`);
    }
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
${fail("read")}
${DENY(ruleVar("read"), ruleValue(entity.rules.read, "row"))}
${body}
}`);
  }

  if (create) {
    const emits = emitLines(eventsFor("created"), `${present}(row)`, "write");
    if (emits.length) imports.add(`${modulePath}/generated/events`);
    const bodyCheck =
      create.rule.kind === "member" ? `${DENY(ruleVar("create"), `values[${q(create.rule.field)}]`)}\n` : "";
    const insert =
      isTenant && tenancy && membership
        ? `	tx, err := h.db.Begin(ctx)
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
${emits.length ? emits.join("\n") + "\n" : ""}	if err := ${hooksPkg}.AfterCreate(hookCtx, row); err != nil {
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
${fail("write")}
${DENY(ruleVar("update"), ruleValue(entity.rules.update, "existing"))}
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
${emits.length ? emits.join("\n") + "\n" : ""}	if err := ${hooksPkg}.AfterUpdate(hookCtx, row); err != nil {
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
${fail("delete")}
${DENY(ruleVar("delete"), ruleValue(entity.rules.delete, "existing"))}
	hookCtx := &hooks.Context{Gin: c, Session: session}
	if err := ${hooksPkg}.BeforeDelete(hookCtx, existing); err != nil {
		httpx.HandleError(c, err, "delete")
		return
	}
	if _, err := h.db.Exec(ctx, \`DELETE FROM \`+${tableC}+\` WHERE ${pkIdent} = $1\`, id); err != nil {
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

  for (const inc of [...includes.values()].sort((a, b) => a.rel.name.localeCompare(b.rel.name)))
    sections.push(loaderMethod(inc, entity, handler));

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
    "github.com/jackc/pgx/v5/pgxpool",
    `${modulePath}/generated/access`,
    `${modulePath}/generated/actions`,
    `${modulePath}/generated/actions/handlers`,
    `${modulePath}/generated/auth`,
    `${modulePath}/generated/httpx`,
    `${modulePath}/generated/validation`
  ]);
  if (actions.some(a => a.returns.kind === "entity")) imports.add(`${modulePath}/generated/models`);
  const ruleVar = (action: ActionIR) => `global${exported(action.name)}ActionRule`;
  const sections: string[] = [];
  sections.push(`// GlobalActions serves the actions not tied to a resource.
type GlobalActions struct {
	db   *pgxpool.Pool
	auth *auth.Auth
}

// NewGlobalActions builds the handlers.
func NewGlobalActions(db *pgxpool.Pool, a *auth.Auth) *GlobalActions {
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
