/**
 * The generated pages: a resource page in its split, table or board layout (list, new, detail) and
 * a dashboard. Pages are the same code on every backend; the client module and the router differ.
 */
import type {
  ActionIR,
  ColumnIR,
  EntityIR,
  IR,
  OperationIR,
  PageFilterValue,
  PageIR,
  RelationIR,
  ResourceIR,
  RuleIR,
  SectionIR,
  ShapeKeyIR,
  ThroughIR,
  TileGroupIR,
  TileIR
} from "@osl/core";
import { MONEY_PATTERN, actionsOf, ruledColumns, toPascalCase, toTitleCase, transitionOf } from "@osl/core";
import { entityByName, q, singlePrimaryKey, type TsConventions } from "../conventions.js";
import { detailBase, detailRouteId, pageComponent } from "./routes.js";
import type { WebTarget } from "./target.js";

type ListOp = Extract<OperationIR, { kind: "list" }>;
type GetOp = Extract<OperationIR, { kind: "get" }>;
type CreateOp = Extract<OperationIR, { kind: "create" }>;
type UpdateOp = Extract<OperationIR, { kind: "update" }>;
type DeleteOp = Extract<OperationIR, { kind: "delete" }>;

interface Ctx {
  ir: IR;
  page: PageIR;
  resource: ResourceIR;
  entity: EntityIR;
  target: WebTarget;
  conv: TsConventions;
  pk: ColumnIR;
  intKey: boolean;
  imports: {
    router: { link?: boolean; params?: boolean; navigate?: boolean; outlet?: boolean; pathname?: boolean };
    query: Set<string>;
    react: Set<string>;
    lucide: Set<string>;
    ui: Set<string>;
    shadcn: Map<string, Set<string>>;
    client: Set<string>;
    /** Names from generated/app/tenant.tsx, for pages that filter by the tenant context */
    tenant: Set<string>;
  };
}

function use(ctx: Ctx, group: "query" | "react" | "lucide" | "ui" | "client" | "tenant", name: string): void {
  ctx.imports[group].add(name);
}

function shadcn(ctx: Ctx, file: string, name: string): void {
  (ctx.imports.shadcn.get(file) ?? ctx.imports.shadcn.set(file, new Set()).get(file)!).add(name);
}

function scalar(col: ColumnIR): string {
  return col.type.kind === "scalar" ? col.type.scalar : col.type.kind;
}

function enumValues(ctx: Ctx, col: ColumnIR): string[] {
  if (col.enumValues) return col.enumValues;
  if (col.type.kind !== "enum") return [];
  return ctx.ir.enums.find(e => e.name === (col.type as { name: string }).name)!.values;
}

export function humanize(name: string): string {
  return toTitleCase(name.replace(/_id$/, ""));
}

export function entityTitle(entity: EntityIR): string {
  return toTitleCase(entity.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
}

function isIntegerKey(column: ColumnIR): boolean {
  return column.type.kind === "scalar" && (column.type.scalar === "integer" || column.type.scalar === "bigint");
}

/** A client-side predicate for a rule, over the signed-in user and (for row rules) the row */
export function rulePredicate(
  rule: RuleIR,
  user: string,
  row: string | null,
  identityPkName: string,
  ruled: ReadonlySet<string> = NO_FIELDS
): string {
  const base = basePredicate(rule, user, row, identityPkName, ruled);
  if (rule.kind === "any" || rule.kind === "all" || rule.kind === "none" || !rule.when || !row) return base;
  // A condition through a relation is decided by the API; the page offers the control when the base allows
  if (rule.when.via?.length) return base;
  // So is one on a field with a read rule: the row the page holds may not carry it, and a missing value would
  // read as "not equal", offering what the API refuses or hiding what it allows
  if (ruled.has(rule.when.column)) return base;
  // The condition is on the row the page shows; values compare as text, null only to null
  const col = `${row}.${rule.when.column}`;
  const test =
    rule.when.value === null
      ? `${col} ${rule.when.op === "eq" ? "==" : "!="} null`
      : `String(${col}) ${rule.when.op === "eq" ? "===" : "!=="} ${JSON.stringify(String(rule.when.value))}`;
  return `(${base} && ${test})`;
}

/** The fields of the row's entity that have a read rule, when the caller of rulePredicate names none */
const NO_FIELDS: ReadonlySet<string> = new Set();

function basePredicate(
  rule: RuleIR,
  user: string,
  row: string | null,
  identityPkName: string,
  ruled: ReadonlySet<string>
): string {
  switch (rule.kind) {
    case "public":
      return "true";
    case "none":
      return "false";
    case "authenticated":
    case "member":
      return `${user} !== null`;
    case "owner":
      // A path is resolved by the API; the page only needs a signed-in user to offer the control
      return row && !rule.via
        ? `${user} !== null && ${row}.${rule.field} === ${user}.${identityPkName}`
        : `${user} !== null`;
    case "role":
      return `${user} !== null && (${user} as { role?: unknown }).role === ${JSON.stringify(rule.value)}`;
    case "all": {
      const parts = [...new Set(rule.rules.map(r => rulePredicate(r, user, row, identityPkName, ruled)))];
      return parts.length === 1 ? parts[0] : `(${parts.join(" && ")})`;
    }
    case "any":
      return `(${rule.rules.map(r => rulePredicate(r, user, row, identityPkName, ruled)).join(" || ")})`;
  }
}

/** A string expression showing a column of `obj`; included forward relations show the related row's display column. */
function showExpr(ctx: Ctx, col: ColumnIR, obj: string, includes: RelationIR[], mode: "list" | "detail"): string {
  const expr = `${obj}.${col.name}`;
  const rel = includes.find(r => r.direction === "forward" && r.column === col.name);
  if (rel) {
    const target = entityByName(ctx.ir, rel.target);
    use(ctx, "ui", "text");
    return `(${obj}.${rel.name} ? text(${obj}.${rel.name}.${target.display}) : text(${expr}))`;
  }
  switch (scalar(col)) {
    case "boolean":
      if (mode === "list")
        return `(${expr} ? ${q(humanize(col.name))} : ${q("Not " + humanize(col.name).toLowerCase())})`;
      use(ctx, "ui", "yesNo");
      return `yesNo(${expr})`;
    case "datetime":
      use(ctx, "ui", "formatDateTime");
      return `formatDateTime(${expr})`;
    case "array":
      use(ctx, "ui", "formatList");
      return `formatList(${expr})`;
    case "json":
      use(ctx, "ui", "formatJson");
      return `formatJson(${expr})`;
    case "file":
      use(ctx, "ui", "text");
      return `text(${expr}?.name)`;
    case "money":
      // The amount with its currency: the field's own code, or the one the row holds
      use(ctx, "ui", "formatMoney");
      return `formatMoney(${expr}, ${col.money?.currencyField ? `${obj}.${col.money.currencyField}` : q(col.money?.currency ?? "")})`;
    default:
      use(ctx, "ui", "text");
      return `text(${expr})`;
  }
}

/** The key of the signed-in user's row, as the session carries it */
function identityKey(ir: IR): string {
  return ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
}

/** The key of the tenant the shell's switcher chooses */
function tenantKey(ir: IR): string {
  return ir.app?.tenant ? entityByName(ir, ir.app.tenant.entity).primaryKey[0] : "id";
}

/**
 * Where a row opens when it is shown outside its own list (a section, a dashboard's recent list, a relation's
 * value): the first detail page over it, else the detail of the first resource page over it, else nowhere.
 */
export function rowTarget(ir: IR, over: (page: PageIR) => boolean): { base: string; access: RuleIR } | null {
  const pages = ir.app?.pages ?? [];
  const detail = pages.find(p => p.kind === "detail" && over(p));
  if (detail) return { base: detail.path.replace(/\/:id$/, ""), access: detail.access };
  const list = pages.find(p => p.kind === "resource" && over(p));
  return list ? { base: list.path, access: list.access } : null;
}

/**
 * The expression showing a column of `obj`, as `showExpr` gives it; a relation's value links to where its row
 * opens, when the viewer may open that page. `fallback` stands in for an empty value; `inRow` keeps a click on
 * the link from also opening the row it sits in.
 */
function linkedExpr(
  ctx: Ctx,
  entity: EntityIR,
  col: ColumnIR,
  obj: string,
  includes: RelationIR[],
  mode: "list" | "detail",
  options: { fallback?: string; inRow?: boolean } = {}
): string {
  const shown = showExpr(ctx, col, obj, includes, mode);
  const label = options.fallback ? `${shown} || ${options.fallback}` : shown;
  const fk = entity.foreignKeys.find(f => f.column === col.name);
  if (!fk) return label;
  const related = entityByName(ctx.ir, fk.targetEntity);
  if (related.primaryKey.length !== 1 || related.primaryKey[0] !== fk.targetColumn) return label;
  const to = rowTarget(ctx.ir, p => p.entity === related.name);
  if (!to) return label;
  const open = rulePredicate(to.access, "user", null, identityKey(ctx.ir));
  if (open === "false") return label;
  ctx.imports.router.link = true;
  use(ctx, "ui", "text");
  const stop = options.inRow ? " onClick={event => event.stopPropagation()}" : "";
  const link = `<Link ${ctx.target.linkAttrs(to.base, `text(${obj}.${col.name})`)} className="hover:underline"${stop}>{${label}}</Link>`;
  const when = [...(col.nullable ? [`${obj}.${col.name} != null`] : []), ...(open === "true" ? [] : [open])];
  return when.length ? `${when.join(" && ")} ? ${link} : ${label}` : link;
}

/** JSX for one field of the detail pane; a field with a read rule is there only when the row carries it */
function detailRow(ctx: Ctx, col: ColumnIR, includes: RelationIR[]): string {
  const jsx = detailRowJsx(ctx, col, includes);
  if (!col.read) return jsx;
  return `        {${q(col.name)} in row ? (\n${jsx
    .split("\n")
    .map(line => `  ${line}`)
    .join("\n")}\n        ) : null}`;
}

function detailRowJsx(ctx: Ctx, col: ColumnIR, includes: RelationIR[]): string {
  const label = q(humanize(col.name));
  const expr = `row.${col.name}`;
  const rel = includes.find(r => r.direction === "forward" && r.column === col.name);
  use(ctx, "ui", "FieldRow");
  if (!rel) {
    switch (scalar(col)) {
      case "enum":
        shadcn(ctx, "badge", "Badge");
        use(ctx, "ui", "text");
        return `        <FieldRow label=${label}>{${expr} == null ? "—" : <Badge variant="secondary">{text(${expr})}</Badge>}</FieldRow>`;
      case "boolean":
        shadcn(ctx, "badge", "Badge");
        use(ctx, "ui", "yesNo");
        return `        <FieldRow label=${label}>{${expr} == null ? "—" : <Badge variant={${expr} ? "default" : "outline"}>{yesNo(${expr})}</Badge>}</FieldRow>`;
      case "array":
        shadcn(ctx, "badge", "Badge");
        use(ctx, "ui", "text");
        return `        <FieldRow label=${label}>
          <span className="flex flex-wrap gap-1">
            {(${expr} ?? []).map(item => (
              <Badge key={text(item)} variant="secondary">
                {text(item)}
              </Badge>
            ))}
          </span>
        </FieldRow>`;
      case "json":
        use(ctx, "ui", "formatJson");
        return `        <FieldRow label=${label}>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{formatJson(${expr}) || "—"}</pre>
        </FieldRow>`;
      case "text":
        use(ctx, "ui", "text");
        return `        <FieldRow label=${label}>
          <p className="whitespace-pre-wrap">{text(${expr}) || "—"}</p>
        </FieldRow>`;
      case "file":
        use(ctx, "ui", "FilePreview");
        return `        <FieldRow label=${label}>
          <FilePreview file={${expr}} />
        </FieldRow>`;
    }
  }
  return `        <FieldRow label=${label}>{${linkedExpr(ctx, ctx.entity, col, "row", includes, "detail", { fallback: '"—"' })}}</FieldRow>`;
}

/** What a list shows for the relations through a junction the page names in its columns: the far rows' names */
function relationListExprs(ctx: Ctx): { name: string; expr: string }[] {
  return (ctx.page.relations ?? []).map(name => {
    const rel = ctx.entity.through!.find(t => t.name === name)!;
    const far = entityByName(ctx.ir, rel.target);
    use(ctx, "ui", "text");
    return { name, expr: `row.${name}.map(item => text(item.${far.display})).join(", ")` };
  });
}

/**
 * A child's or junction's rule as the page can answer it from the parent row it shows: an owner path that goes one
 * step, through the relation to that parent, is a field of the parent (owner:playlist_id.owner_id on an entry is
 * owner_id on the playlist). Anything deeper stays the API's to decide, and the page offers the control to whoever
 * is signed in.
 */
function ruleFromParent(rule: RuleIR, from: string): RuleIR {
  if (rule.kind === "any") return { kind: "any", rules: rule.rules.map(r => ruleFromParent(r, from)) as never };
  if (rule.kind === "all") return { kind: "all", rules: rule.rules.map(r => ruleFromParent(r, from)) as never };
  if (rule.kind === "owner" && rule.via?.length === 1 && rule.via[0].column === from && !rule.when)
    return { kind: "owner", field: rule.field };
  return rule;
}

/** The predicate that offers a control of a child or junction resource on the parent's detail pane */
function parentPredicate(rule: RuleIR, from: string, idPk: string): string {
  const mapped = ruleFromParent(rule, from);
  const direct = JSON.stringify(mapped) !== JSON.stringify(rule);
  return rulePredicate(mapped, "user", direct ? "row" : null, idPk);
}

/** The component name of a relation the detail pane shows with its own controls */
function relationFieldName(ctx: Ctx, name: string): string {
  return `${pageComponent(ctx.page)}${toPascalCase(name)}Field`;
}

/**
 * The detail pane's component for a relation through a junction: the far rows by name, in the junction's order
 * when it has one. Adding, removing and reordering go through the junction's own resource, under its own rules,
 * as far as that resource offers them; without it the names are all there is.
 */
function throughFieldComponent(ctx: Ctx, rel: ThroughIR): string {
  const { ir, entity } = ctx;
  const junction = entityByName(ir, rel.junction);
  const far = entityByName(ir, rel.target);
  const idPk = ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
  const Field = relationFieldName(ctx, rel.name);
  const List = rel.orderBy ? "OrderedList" : "NameChips";
  use(ctx, "ui", List);
  use(ctx, "ui", "text");
  use(ctx, "client", "SessionUser");
  const farKey = `text(item.${rel.targetColumn})`;
  const farLabel = `text(item.${far.display})`;
  // A track may be in a playlist twice: an ordered list keys its rows by their place too
  const readOnly = `<${List} items={row.${rel.name}} keyOf={item => ${farKey}${rel.orderBy ? ` + ":" + row.${rel.name}.indexOf(item)` : ""}} label={item => ${farLabel}} />`;
  const via = ir.resources.find(r => r.entity === junction.name);
  const ops = via?.operations.filter(o => o.rule.kind !== "none") ?? [];
  const list = ops.find(o => o.kind === "list") as ListOp | undefined;
  // The junction's rows are needed to address one: its list, filtered by the row
  if (!via || !list || !list.filters.includes(rel.from)) {
    return `/** The ${rel.name} of ${article(entityTitle(entity))}: the ${far.name} rows ${rel.junction} links it to */
function ${Field}({ row, user }: { row: Detail; user: SessionUser | null }) {
  void user;
  return ${readOnly};
}`;
  }
  const J = via.name;
  const create = ops.find(o => o.kind === "create") as CreateOp | undefined;
  const remove = ops.find(o => o.kind === "delete") as DeleteOp | undefined;
  const move = rel.orderBy ? actionsOf(ir, J).find(a => a.builtin === "move" && a.rule.kind !== "none") : undefined;
  const options = ir.resources.find(
    r => r.entity === far.name && r.operations.some(o => o.kind === "list" && o.rule.kind !== "none")
  );
  // Adding needs only the two relation fields: a junction that asks for more (a role, a note) is added on its own page
  const addable =
    create &&
    options &&
    create.fields.includes(rel.to) &&
    (create.fields.includes(rel.from) || create.ownerField === rel.from) &&
    create.fields.every(f => {
      const c = junction.columns.find(col => col.name === f)!;
      return f === rel.from || f === rel.to || c.nullable || c.default !== undefined;
    });
  const paired =
    junction.uniques.some(u => u.columns.length === 2 && u.columns.includes(rel.from) && u.columns.includes(rel.to)) ||
    (junction.primaryKey.length === 2 &&
      junction.primaryKey.includes(rel.from) &&
      junction.primaryKey.includes(rel.to));
  use(ctx, "query", "useQuery");
  use(ctx, "query", "useMutation");
  use(ctx, "query", "useQueryClient");
  use(ctx, "ui", "ErrorNote");
  use(ctx, "client", "Inputs");
  use(ctx, "client", "Outputs");
  if (addable) use(ctx, "ui", "AddPicker");
  const jpk = junction.primaryKey[0];
  const mutation = (name: string, op: string) =>
    `  const ${name} = useMutation({ mutationFn: (input: Inputs[${q(J)}][${q(op)}]) => client.${J}.${op}(input), onSuccess: settle });`;
  const errors = [
    ...(addable ? ["add.error"] : []),
    ...(remove ? ["remove.error"] : []),
    ...(move ? ["move.error"] : [])
  ];
  const busy = [
    ...(addable ? ["add.isPending"] : []),
    ...(remove ? ["remove.isPending"] : []),
    ...(move ? ["move.isPending"] : [])
  ];
  const sorted = rel.orderBy
    ? `[...(links.data?.data ?? [])].sort((a, b) => Number(a.${rel.orderBy}) - Number(b.${rel.orderBy}))`
    : `[...(links.data?.data ?? [])].sort((a, b) => label(a).localeCompare(label(b)))`;
  const props = [
    `items={items}`,
    `keyOf={link => text(link.${jpk})}`,
    `label={label}`,
    ...(move
      ? [
          `onMove={${parentPredicate(move.rule, rel.from, idPk)} ? (link, to) => move.mutate({ id: link.${jpk}, to }) : undefined}`
        ]
      : []),
    ...(remove
      ? [
          `onRemove={${parentPredicate(remove.rule, rel.from, idPk)} ? link => remove.mutate({ id: link.${jpk} }) : undefined}`
        ]
      : []),
    ...(busy.length ? [`busy={busy}`] : [])
  ];
  const one = entityTitle(far).toLowerCase();
  return `/**
 * The ${rel.name} of ${article(entityTitle(entity))}: the ${far.name} rows ${rel.junction} links it to${rel.orderBy ? `, in the order of its ${rel.orderBy}` : ""}. Changes go
 * through ${J}, under its own rules; the names come with the row.
 */
function ${Field}({ row, user }: { row: Detail; user: SessionUser | null }) {
  void user;
  const queryClient = useQueryClient();
  const linkInput = { ${rel.from}: row.${rel.sourceColumn}, page_size: 200 } as Inputs[${q(J)}]["list"];
  const links = useQuery({ queryKey: [${q(J)}, "list", linkInput], queryFn: () => client.${J}.list(linkInput) });${
    addable
      ? `
  const options = useQuery({ queryKey: [${q(options!.name)}, "list", { page_size: 200 }], queryFn: () => client.${options!.name}.list({ page_size: 200 }) });`
      : ""
  }
  const settle = async () => {
    await queryClient.invalidateQueries({ queryKey: [${q(J)}] });
    await queryClient.invalidateQueries({ queryKey: KEY });
  };
  void settle;
${[...(addable ? [mutation("add", "create")] : []), ...(remove ? [mutation("remove", "delete")] : []), ...(move ? [mutation("move", "move")] : [])].join("\n")}
  type Link = Outputs[${q(J)}]["list"]["data"][number];
  const far = new Map(row.${rel.name}.map(item => [${farKey}, item] as const));
  const label = (link: Link) => text(far.get(text(link.${rel.to}))?.${far.display});
  const items = ${sorted};${busy.length ? `\n  const busy = ${busy.join(" || ")};` : ""}
  return (
    <div>
      {links.data ? <${List} ${props.join(" ")} /> : ${readOnly}}${
        addable
          ? `
      {${parentPredicate(create!.rule, rel.from, idPk)} ? (
        <AddPicker
          options={(options.data?.data ?? [])${paired ? `.filter(item => !far.has(${farKey}))` : ""}}
          keyOf={item => ${farKey}}
          label={item => ${farLabel}}
          placeholder=${q(`Add ${article(one)}…`)}
          onAdd={item => add.mutate({ ${rel.from}: row.${rel.sourceColumn}, ${rel.to}: item.${rel.targetColumn} } as Inputs[${q(J)}]["create"])}${busy.length ? "\n          busy={busy}" : ""}
        />
      ) : null}`
          : ""
      }${errors.length ? `\n      <ErrorNote error={${errors.join(" ?? ")}} className="mt-2" />` : ""}
    </div>
  );
}`;
}

/**
 * The detail pane's component for the children a row orders (a reverse relation to an ordered entity): the rows in
 * their order, moved through the child resource's move action when it has one.
 */
function orderedChildrenComponent(ctx: Ctx, rel: RelationIR): string {
  const { ir, entity } = ctx;
  const child = entityByName(ir, rel.target);
  const idPk = ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
  const Field = relationFieldName(ctx, rel.name);
  const cpk = child.primaryKey[0];
  const via = ir.resources.find(r => r.entity === child.name);
  const move = via ? actionsOf(ir, via.name).find(a => a.builtin === "move" && a.rule.kind !== "none") : undefined;
  use(ctx, "ui", "OrderedList");
  use(ctx, "ui", "text");
  use(ctx, "client", "SessionUser");
  const base = `items={row.${rel.name}} keyOf={item => text(item.${cpk})} label={item => text(item.${child.display})}`;
  if (!via || !move)
    return `/** The ${rel.name} of ${article(entityTitle(entity))}, in their order */
function ${Field}({ row, user }: { row: Detail; user: SessionUser | null }) {
  void user;
  return <OrderedList ${base} />;
}`;
  use(ctx, "query", "useMutation");
  use(ctx, "query", "useQueryClient");
  use(ctx, "ui", "ErrorNote");
  use(ctx, "client", "Inputs");
  return `/** The ${rel.name} of ${article(entityTitle(entity))}, in their order; a move goes through ${via.name}.move, under its own rule */
function ${Field}({ row, user }: { row: Detail; user: SessionUser | null }) {
  void user;
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: (input: Inputs[${q(via.name)}]["move"]) => client.${via.name}.move(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: [${q(via.name)}] });
      await queryClient.invalidateQueries({ queryKey: KEY });
    }
  });
  return (
    <div>
      <OrderedList
        ${base}
        onMove={${parentPredicate(move.rule, rel.column, idPk)} ? (item, to) => move.mutate({ id: item.${cpk}, to }) : undefined}
        busy={move.isPending}
      />
      <ErrorNote error={move.error} className="mt-2" />
    </div>
  );
}`;
}

/** Rows for relations the get operation includes that are not a column of the entity (reverse sides) */
function reverseRows(ctx: Ctx, includes: RelationIR[]): string[] {
  const out: string[] = [];
  for (const rel of includes.filter(r => r.direction === "reverse")) {
    const target = entityByName(ctx.ir, rel.target);
    use(ctx, "ui", "FieldRow");
    use(ctx, "ui", "text");
    if (rel.orderBy) {
      out.push(`        <FieldRow label=${q(humanize(rel.name))}>
          <${relationFieldName(ctx, rel.name)} row={row} user={user} />
        </FieldRow>`);
    } else if (rel.kind === "many") {
      out.push(`        <FieldRow label=${q(humanize(rel.name))}>
          {row.${rel.name}.length === 0 ? (
            "—"
          ) : (
            <ul className="space-y-1">
              {row.${rel.name}.map(item => (
                <li key={text(item.${target.primaryKey[0]})}>{text(item.${target.display})}</li>
              ))}
            </ul>
          )}
        </FieldRow>`);
    } else {
      out.push(
        `        <FieldRow label=${q(humanize(rel.name))}>{row.${rel.name} ? text(row.${rel.name}.${target.display}) : "—"}</FieldRow>`
      );
    }
  }
  return out;
}

/** One input of a shape's group: where its value sits in the form's values, and what it is */
interface ShapeInput {
  key: ShapeKeyIR;
  /** The keys from the column's own value down to this one (`["quiet_hours", "from"]`; a shape per enum value starts with the value) */
  path: string[];
}

function shapeValueType(keys: ShapeKeyIR[]): string {
  const parts = keys.map(key => {
    if (key.kind === "object") return `${key.name}: ${shapeValueType(key.keys ?? [])}`;
    if (key.kind === "boolean") return `${key.name}: boolean`;
    if (key.kind === "enum") {
      const literals = (key.values ?? []).map(q).join(" | ");
      return `${key.name}: ${key.required || key.default !== undefined ? literals : `"" | ${literals}`}`;
    }
    return `${key.name}: string`;
  });
  return `{ ${parts.join("; ")} }`;
}

function shapeInitial(keys: ShapeKeyIR[]): string {
  const parts = keys.map(key => {
    if (key.kind === "object") return `${key.name}: ${shapeInitial(key.keys ?? [])}`;
    if (key.kind === "boolean") return `${key.name}: ${key.default === true}`;
    if (key.kind === "enum")
      return `${key.name}: ${key.default !== undefined ? q(String(key.default)) : key.required ? q(key.values![0]) : '""'}`;
    return `${key.name}: ${key.default !== undefined ? q(String(key.default)) : '""'}`;
  });
  return `{ ${parts.join(", ")} }`;
}

/** Whether the inputs of a group are all empty: every one that is not a checkbox or a select with no empty choice */
function shapeBlank(keys: ShapeKeyIR[], at: string): string[] {
  return keys.flatMap(key => {
    if (key.kind === "object") return shapeBlank(key.keys ?? [], `${at}.${key.name}`);
    if (key.kind === "boolean") return [];
    if (key.kind === "enum" && (key.required || key.default !== undefined)) return [];
    return [`${at}.${key.name} === ""`];
  });
}

/** The API value of a group, from the form's values at `at` */
function shapeToInput(keys: ShapeKeyIR[], at: string): string {
  const parts = keys.map(key => {
    const v = `${at}.${key.name}`;
    const optional = (expr: string) => (key.required ? expr : `(${v} === "" ? undefined : ${expr})`);
    switch (key.kind) {
      case "object": {
        const inner = shapeToInput(key.keys ?? [], v);
        const blank = shapeBlank(key.keys ?? [], v);
        // A group the shape does not require is left out while every one of its inputs is empty
        return `${key.name}: ${key.required || !blank.length ? inner : `(${blank.join(" && ")} ? undefined : ${inner})`}`;
      }
      case "boolean":
        return `${key.name}: ${v}`;
      case "integer":
      case "float":
        return `${key.name}: ${optional(`Number(${v})`)}`;
      case "datetime":
        return `${key.name}: ${optional(`new Date(${v}).toISOString()`)}`;
      case "array":
        return `${key.name}: ${optional(key.of === "integer" || key.of === "float" ? `splitList(${v}).map(Number)` : key.of === "boolean" ? `splitList(${v}).map(item => item === "true")` : `splitList(${v})`)}`;
      case "enum":
        return `${key.name}: ${key.required || key.default !== undefined ? v : `(${v} || undefined)`}`;
      default:
        return `${key.name}: ${optional(v)}`;
    }
  });
  return `{ ${parts.join(", ")} }`;
}

/** The form's values of a group, read from a stored value held in `from` (a record that may lack any key) */
function shapeFromRow(ctx: Ctx, keys: ShapeKeyIR[], from: string): string {
  const parts = keys.map(key => {
    const v = `${from}.${key.name}`;
    const fallback = key.default !== undefined ? q(String(key.default)) : '""';
    switch (key.kind) {
      case "object":
        return `${key.name}: ${shapeFromRow(ctx, key.keys ?? [], `record(${v})`)}`;
      case "boolean":
        return `${key.name}: ${v} === undefined ? ${key.default === true} : ${v} === true`;
      case "enum": {
        const values = key.values ?? [];
        const first = key.default !== undefined ? q(String(key.default)) : key.required ? q(values[0]) : '""';
        return `${key.name}: ${values.map(value => `${v} === ${q(value)} ? ${q(value)}`).join(" : ")} : ${first}`;
      }
      case "datetime":
        use(ctx, "ui", "toDateTimeInput");
        return `${key.name}: typeof ${v} === "string" ? toDateTimeInput(${v}) : ${fallback}`;
      case "array":
        use(ctx, "ui", "formatList");
        return `${key.name}: Array.isArray(${v}) ? formatList(${v}) : ""`;
      default:
        use(ctx, "ui", "text");
        return `${key.name}: ${v} == null ? ${fallback} : text(${v})`;
    }
  });
  return `{ ${parts.join(", ")} }`;
}

/** `set("options", { ...values.options, quiet_hours: { ...values.options.quiet_hours, from: <value> } })` */
function shapeSet(column: string, path: string[], value: string): string {
  const build = (at: string, rest: string[]): string =>
    rest.length === 1
      ? `{ ...${at}, ${rest[0]}: ${value} }`
      : `{ ...${at}, ${rest[0]}: ${build(`${at}.${rest[0]}`, rest.slice(1))} }`;
  return `set(${q(column)}, ${build(`values.${column}`, path)})`;
}

/** The inputs of a group, one per key, nested groups in a fieldset of their own */
function shapeControls(ctx: Ctx, column: string, keys: ShapeKeyIR[], path: string[], pad: string): string[] {
  return keys.map(key => {
    const here = [...path, key.name];
    const id = q([column, ...here].join("."));
    const value = `values.${[column, ...here].join(".")}`;
    const label = q(humanize(key.name));
    if (key.kind === "object") {
      return `${pad}<fieldset className="grid gap-3 rounded-md border p-3">
${pad}  <legend className="px-1 text-sm font-medium">${humanize(key.name)}</legend>
${shapeControls(ctx, column, key.keys ?? [], here, `${pad}  `).join("\n")}
${pad}</fieldset>`;
    }
    if (key.kind === "boolean") {
      shadcn(ctx, "checkbox", "Checkbox");
      shadcn(ctx, "label", "Label");
      return `${pad}<div className="flex items-center gap-2">
${pad}  <Checkbox id=${id} checked={${value}} onCheckedChange={checked => ${shapeSet(column, here, "checked === true")}} />
${pad}  <Label htmlFor=${id}>${humanize(key.name)}</Label>
${pad}</div>`;
    }
    use(ctx, "ui", "FormRow");
    if (key.kind === "enum") {
      use(ctx, "ui", "selectClass");
      const literals = (key.values ?? []).map(q).join(" | ");
      const type = key.required || key.default !== undefined ? literals : `"" | ${literals}`;
      const options = (key.values ?? []).map(v => `${pad}    <option value=${q(v)}>${v}</option>`);
      if (!key.required && key.default === undefined) options.unshift(`${pad}    <option value="">—</option>`);
      return `${pad}<FormRow label=${label} htmlFor=${id}>
${pad}  <select id=${id} className={selectClass} value={${value}} onChange={e => ${shapeSet(column, here, `e.target.value as ${type}`)}}>
${options.join("\n")}
${pad}  </select>
${pad}</FormRow>`;
    }
    const change = `onChange={e => ${shapeSet(column, here, "e.target.value")}}`;
    const req = key.required ? " required" : "";
    if (key.kind === "text") {
      shadcn(ctx, "textarea", "Textarea");
      return `${pad}<FormRow label=${label} htmlFor=${id}>
${pad}  <Textarea id=${id} rows={3} value={${value}} ${change}${req} />
${pad}</FormRow>`;
    }
    shadcn(ctx, "input", "Input");
    let type = "text";
    let extra = "";
    if (key.kind === "integer") ((type = "number"), (extra = ' step="1"'));
    else if (key.kind === "float") ((type = "number"), (extra = ' step="any"'));
    else if (key.kind === "datetime") type = "datetime-local";
    else if (key.kind === "date") type = "date";
    else if (key.validate?.format === "email") type = "email";
    else if (key.validate?.format === "url") type = "url";
    if (key.kind === "array") extra = ' placeholder="comma, separated"';
    return `${pad}<FormRow label=${label} htmlFor=${id}>
${pad}  <Input id=${id} type=${q(type)}${extra} value={${value}} ${change}${req} />
${pad}</FormRow>`;
  });
}

/** A JSON column whose form is a group of inputs: one shape, or the shape of the enum value the form holds */
function shapedForm(col: ColumnIR, formFields: ReadonlySet<string>): "shape" | "by" | null {
  if (col.shape) return "shape";
  // The group follows the enum's select, so the enum is a value of the same form; without it the field stays a JSON box
  return col.shapeBy && formFields.has(col.shapeBy.column) ? "by" : null;
}

interface FormField {
  col: ColumnIR;
  /** TypeScript type of the form value */
  valueType: string;
  initial: string;
  /** A resource over the relation target, when the field picks a related row */
  picker?: { resource: ResourceIR; target: EntityIR };
  /** Names the picker component and the input ids of a form that sits beside a page's main form in one module */
  pickerPrefix: string;
}

function formFields(ctx: Ctx, columns: ColumnIR[], entity: EntityIR | null, pickerPrefix = ""): FormField[] {
  const names = new Set(columns.map(c => c.name));
  return columns.map(col => {
    const name = col.name;
    const kind = scalar(col);
    let valueType = "string";
    let initial = '""';
    const shaped = shapedForm(col, names);
    if (shaped === "shape") {
      valueType = shapeValueType(col.shape!);
      initial = shapeInitial(col.shape!);
    } else if (shaped === "by") {
      // One group per value of the enum, so what was typed for one survives a look at another
      valueType = `{ ${col.shapeBy!.shapes.map(s => `${s.value}: ${shapeValueType(s.keys)}`).join("; ")} }`;
      initial = `{ ${col.shapeBy!.shapes.map(s => `${s.value}: ${shapeInitial(s.keys)}`).join(", ")} }`;
    } else if (kind === "boolean") {
      valueType = "boolean";
      initial = col.default?.kind === "literal" ? String(Boolean(col.default.value)) : "false";
    } else if (kind === "enum") {
      const values = enumValues(ctx, col);
      const literals = values.map(q).join(" | ");
      valueType = col.nullable ? `"" | ${literals}` : literals;
      initial = col.nullable ? '""' : col.default?.kind === "literal" ? q(String(col.default.value)) : q(values[0]);
    } else if (col.default?.kind === "literal") {
      initial = q(String(col.default.value));
    }
    const fk = entity?.foreignKeys.find(f => f.column === name);
    let picker: FormField["picker"];
    if (fk) {
      const target = entityByName(ctx.ir, fk.targetEntity);
      const resource = ctx.ir.resources.find(
        r => r.entity === target.name && r.operations.some(o => o.kind === "list" && o.rule.kind !== "none")
      );
      if (resource) picker = { resource, target };
    }
    return { col, valueType, initial, picker, pickerPrefix };
  });
}

/** The expression turning a form value into the API input for a column */
function convert(field: FormField, mode: "create" | "update", formFields: ReadonlySet<string> = new Set()): string {
  const col = field.col;
  const v = `v.${col.name}`;
  // A sealed field is never shown again, so an edit that leaves its input empty leaves the stored value alone
  if (col.sealed && mode === "update") return `(${v} === "" ? undefined : ${v})`;
  const shaped = shapedForm(col, formFields);
  if (shaped === "shape") return shapeToInput(col.shape!, v);
  if (shaped === "by") {
    const by = col.shapeBy!;
    const [last, ...earlier] = [...by.shapes].reverse();
    return `${earlier
      .reverse()
      .map(s => `v.${by.column} === ${q(s.value)} ? ${shapeToInput(s.keys, `${v}.${s.value}`)} : `)
      .join("")}${shapeToInput(last.keys, `${v}.${last.value}`)}`;
  }
  const nullable = col.nullable;
  const required = mode === "create" ? !nullable && col.default === undefined && !col.generated : !nullable;
  const absent = nullable ? "null" : "undefined";
  const optional = (expr: string, empty = `${v} === ""`) => (required ? expr : `(${empty} ? ${absent} : ${expr})`);
  switch (scalar(col)) {
    case "boolean":
      return v;
    case "integer":
    case "bigint":
    case "float":
      return optional(`Number(${v})`);
    case "datetime":
      return optional(`new Date(${v}).toISOString()`);
    case "json":
      return optional(`(JSON.parse(${v}) as unknown)`);
    case "array": {
      const numeric = col.type.kind === "array" && ["integer", "bigint", "float", "decimal"].includes(col.type.of);
      return optional(numeric ? `splitList(${v}).map(Number)` : `splitList(${v})`);
    }
    case "enum":
      if (required && !nullable) return v;
      return `(${v} || ${absent})`;
    case "file":
      return `(${v} || ${absent})`;
    default:
      return required ? v : `(${v} || ${absent})`;
  }
}

/** The expression reading a column of a fetched row into its form value */
function fromRowExpr(ctx: Ctx, field: FormField, formFields: ReadonlySet<string> = new Set()): string {
  const col = field.col;
  const expr = `row.${col.name}`;
  // Never filled in from the row: what was sealed is not put back into a page
  if (col.sealed) return '""';
  const shaped = shapedForm(col, formFields);
  if (shaped === "shape") return shapeFromRow(ctx, col.shape!, `record(${expr})`);
  if (shaped === "by")
    return `{ ${col
      .shapeBy!.shapes.map(s => `${s.value}: ${shapeFromRow(ctx, s.keys, `record(${expr})`)}`)
      .join(", ")} }`;
  switch (scalar(col)) {
    case "boolean":
      return `${expr} ?? false`;
    case "enum":
      return col.nullable ? `${expr} ?? ""` : col.read ? `${expr} ?? ${field.initial}` : expr;
    case "datetime":
      use(ctx, "ui", "toDateTimeInput");
      return `toDateTimeInput(${expr})`;
    case "date":
      use(ctx, "ui", "text");
      return `text(${expr}).slice(0, 10)`;
    case "array":
      use(ctx, "ui", "formatList");
      return `formatList(${expr})`;
    case "json":
      return `${expr} == null ? "" : JSON.stringify(${expr}, null, 2)`;
    case "file":
      return `${expr}?.id ?? ""`;
    default:
      use(ctx, "ui", "text");
      return `text(${expr})`;
  }
}

function inputControl(
  ctx: Ctx,
  field: FormField,
  required: boolean,
  valuesType: string,
  formFields: ReadonlySet<string> = new Set()
): string {
  const col = field.col;
  const name = col.name;
  // The element id; two forms on one page must not share one
  const id = q(field.pickerPrefix ? `${field.pickerPrefix.toLowerCase()}-${name}` : name);
  const label = q(humanize(name));
  const req = required ? " required" : "";
  const kind = scalar(col);
  if (col.sealed) {
    // Write-only: the page never holds the stored value, so the input starts empty and an empty input changes nothing
    use(ctx, "ui", "FormRow");
    shadcn(ctx, "input", "Input");
    return `      <FormRow label=${label} htmlFor=${q(name)}>
        <Input id=${q(name)} type="password" autoComplete="new-password" placeholder="Sealed: leave empty to keep what is stored" value={values.${name}} onChange={e => set(${q(name)}, e.target.value)} />
      </FormRow>`;
  }
  const shaped = shapedForm(col, formFields);
  if (shaped === "shape")
    return `      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">${humanize(name)}</legend>
${shapeControls(ctx, name, col.shape!, [], "        ").join("\n")}
      </fieldset>`;
  if (shaped === "by") {
    // The group follows the enum's select: the inputs are the ones of the shape the chosen value names
    const by = col.shapeBy!;
    const groups = by.shapes.map(
      s => `        {values.${by.column} === ${q(s.value)} ? (
          <>
${s.keys.length ? shapeControls(ctx, name, s.keys, [s.value], "            ").join("\n") : `            <p className="text-sm text-muted-foreground">Nothing to set for ${s.value}.</p>`}
          </>
        ) : null}`
    );
    return `      <fieldset className="grid gap-3 rounded-md border p-3">
        <legend className="px-1 text-sm font-medium">${humanize(name)}</legend>
${groups.join("\n")}
      </fieldset>`;
  }
  if (kind === "money") {
    // A decimal string from the keyboard to the API: a text input, never a number input, whose value is a float
    use(ctx, "ui", "FormRow");
    shadcn(ctx, "input", "Input");
    const holder = col.money?.currencyField;
    const code = holder ? (formFields.has(holder) ? `{values.${holder}}` : null) : (col.money?.currency ?? null);
    const unit = code === null ? "" : `\n          <span className="text-sm text-muted-foreground">${code}</span>`;
    return `      <FormRow label=${label} htmlFor=${q(name)}>
        <div className="flex items-center gap-2">
          <Input id=${q(name)} type="text" inputMode="decimal" pattern={${q(MONEY_PATTERN.slice(1, -1))}} placeholder="0.00" title="A decimal amount with at most four fraction digits" value={values.${name}} onChange={e => set(${q(name)}, e.target.value.trim())}${req} />${unit}
        </div>
      </FormRow>`;
  }
  if (field.picker) {
    use(ctx, "ui", "FormRow");
    return `      <FormRow label=${label} htmlFor=${id}>
        <${pickerName(field)} id=${id} value={values.${name}} onChange={value => set(${q(name)}, value)} allowEmpty={${!required}} />
      </FormRow>`;
  }
  if (kind === "boolean") {
    shadcn(ctx, "checkbox", "Checkbox");
    shadcn(ctx, "label", "Label");
    return `      <div className="flex items-center gap-2">
        <Checkbox id=${id} checked={values.${name}} onCheckedChange={checked => set(${q(name)}, checked)} />
        <Label htmlFor=${id}>${humanize(name)}</Label>
      </div>`;
  }
  use(ctx, "ui", "FormRow");
  if (kind === "file") {
    use(ctx, "ui", "FileInput");
    const t = col.type as { kind: "file"; accept?: string[] };
    const accept = t.accept ? ` accept=${q(t.accept.join(","))}` : "";
    return `      <FormRow label=${label} htmlFor=${id}>
        <FileInput id=${id} value={values.${name}} current={current?.${name}}${accept} onChange={fileId => set(${q(name)}, fileId)} />
      </FormRow>`;
  }
  if (kind === "enum") {
    use(ctx, "ui", "selectClass");
    const options = enumValues(ctx, col).map(v => `          <option value=${q(v)}>${v}</option>`);
    if (col.nullable) options.unshift(`          <option value="">—</option>`);
    return `      <FormRow label=${label} htmlFor=${id}>
        <select id=${id} className={selectClass} value={values.${name}} onChange={e => set(${q(name)}, e.target.value as ${valuesType}[${q(name)}])}>
${options.join("\n")}
        </select>
      </FormRow>`;
  }
  if (kind === "text" || kind === "json") {
    shadcn(ctx, "textarea", "Textarea");
    const extra = kind === "json" ? ' className="font-mono text-xs" rows={6}' : " rows={4}";
    return `      <FormRow label=${label} htmlFor=${id}>
        <Textarea id=${id}${extra} value={values.${name}} onChange={e => set(${q(name)}, e.target.value)}${req} />
      </FormRow>`;
  }
  shadcn(ctx, "input", "Input");
  let type = "text";
  let extra = "";
  if (kind === "integer" || kind === "bigint") ((type = "number"), (extra = ' step="1"'));
  else if (kind === "float" || kind === "decimal") ((type = "number"), (extra = ' step="any"'));
  else if (kind === "datetime") type = "datetime-local";
  else if (kind === "date") type = "date";
  else if (kind === "time") type = "time";
  else if (col.validate?.format === "email") type = "email";
  else if (col.validate?.format === "url") type = "url";
  if (kind === "array") extra = ' placeholder="comma, separated"';
  if (col.maxLength && kind === "string") extra += ` maxLength={${col.maxLength}}`;
  return `      <FormRow label=${label} htmlFor=${id}>
        <Input id=${id} type=${q(type)}${extra} value={values.${name}} onChange={e => set(${q(name)}, e.target.value)}${req} />
      </FormRow>`;
}

function pickerName(field: FormField): string {
  return `${field.pickerPrefix}${field.col.name.replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase())}Picker`;
}

function pickerComponent(ctx: Ctx, field: FormField): string {
  const { resource, target } = field.picker!;
  use(ctx, "query", "useQuery");
  use(ctx, "ui", "selectClass");
  use(ctx, "ui", "text");
  use(ctx, "client", "client");
  return `/** Picks a ${entityTitle(target)} from the ${resource.name} resource */
function ${pickerName(field)}({
  id,
  value,
  onChange,
  allowEmpty
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  allowEmpty: boolean;
}) {
  const options = useQuery({ queryKey: [${q(resource.name)}, "list", { page_size: 200 }], queryFn: () => client.${resource.name}.list({ page_size: 200 }) });
  return (
    <select id={id} className={selectClass} value={value} onChange={e => onChange(e.target.value)}>
      {allowEmpty ? <option value="">—</option> : null}
      {(options.data?.data ?? []).map(item => (
        <option key={text(item.${target.primaryKey[0]})} value={text(item.${target.primaryKey[0]})}>
          {text(item.${target.display})}
        </option>
      ))}
    </select>
  );
}`;
}

/**
 * A form over a set of fields: the values type, its empty value, converters to the API input, the
 * field renderer and the component. `prefix` names them (`Posts`, `PostsPublish`).
 */
function formCode(
  ctx: Ctx,
  prefix: string,
  fields: FormField[],
  options: {
    createType?: string;
    updateType?: string;
    createFields?: FormField[];
    updateFields?: FormField[];
    fromRow?: boolean;
    currentType?: string;
    /** Create fields the caller sends itself, from the context its list is filtered by; they are not in the form */
    presets?: string[];
  }
): string {
  use(ctx, "react", "FormEvent");
  use(ctx, "react", "Fragment");
  use(ctx, "react", "useState");
  use(ctx, "ui", "ErrorNote");
  use(ctx, "ui", "splitList");
  shadcn(ctx, "button", "Button");
  const ValuesT = `${prefix}Values`;
  const formNames: ReadonlySet<string> = new Set(fields.map(f => f.col.name));
  const valuesType = fields.map(f => `  ${f.col.name}: ${f.valueType};`).join("\n");
  const empty = fields.map(f => `  ${f.col.name}: ${f.initial}`).join(",\n");
  const requiredOnCreate = (f: FormField) => !f.col.nullable && f.col.default === undefined && !f.col.generated;
  const cases = fields
    .map(
      f => `    case ${q(f.col.name)}:
      return (
${inputControl(ctx, f, options.createType ? requiredOnCreate(f) : !f.col.nullable, ValuesT, new Set(fields.map(o => o.col.name)))}
      );`
    )
    .join("\n");
  const parts: string[] = [];
  parts.push(`const ${prefix.toUpperCase()}_FIELDS = [${fields.map(f => q(f.col.name)).join(", ")}] as const;
type ${prefix}Field = (typeof ${prefix.toUpperCase()}_FIELDS)[number];

type ${ValuesT} = {
${valuesType}
};

const EMPTY_${prefix.toUpperCase()}: ${ValuesT} = {
${empty}
};`);
  // A sealed field is written by callers who never read it back, so its input is offered whatever its read rule says
  if (fields.some(f => f.col.read && !f.col.sealed))
    parts.push(`/** Fields with a read rule: an input is offered only to a viewer who may read the field, and a field that was not offered is not sent */
const ${prefix.toUpperCase()}_RULED: readonly string[] = [${fields
      .filter(f => f.col.read && !f.col.sealed)
      .map(f => q(f.col.name))
      .join(", ")}];

/** The fields a form offers: \`readable\` answers for the ones with a read rule (the session for a new row, the row's own keys for an edit) */
function offered${prefix}<F extends string>(fields: readonly F[], readable: (field: string) => boolean): F[] {
  return fields.filter(field => !${prefix.toUpperCase()}_RULED.includes(field) || readable(field));
}

/** An input without the fields the form did not offer, so a field its viewer may not read is never overwritten blind */
function sent${prefix}<T extends object>(input: T, readable: (field: string) => boolean): T {
  const out = { ...input } as Record<string, unknown>;
  for (const field of ${prefix.toUpperCase()}_RULED) if (!readable(field)) delete out[field];
  return out as T;
}`);
  if (options.createType && options.createFields)
    parts.push(`const ${prefix.toUpperCase()}_CREATE: readonly ${prefix}Field[] = [${options.createFields.map(f => q(f.col.name)).join(", ")}];

function to${prefix}CreateInput(v: ${ValuesT}): ${options.presets?.length ? `Omit<${options.createType}, ${options.presets.map(q).join(" | ")}>` : options.createType} {
  return {
${options.createFields.map(f => `    ${f.col.name}: ${convert(f, "create", formNames)}`).join(",\n")}
  };
}`);
  if (options.updateType && options.updateFields)
    parts.push(`const ${prefix.toUpperCase()}_UPDATE: readonly ${prefix}Field[] = [${options.updateFields.map(f => q(f.col.name)).join(", ")}];

function to${prefix}UpdateInput(v: ${ValuesT}): ${options.updateType} {
  return {
${options.updateFields.map(f => `    ${f.col.name}: ${convert(f, "update", formNames)}`).join(",\n")}
  };
}`);
  if (options.fromRow && fields.some(f => shapedForm(f.col, formNames)))
    parts.push(`/** A stored JSON value as a record a form reads its keys from; anything else reads as no keys */
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}`);
  if (options.fromRow)
    parts.push(`function ${prefix.charAt(0).toLowerCase()}${prefix.slice(1)}FromRow(row: Detail): ${ValuesT} {
  return {
${fields.map(f => `    ${f.col.name}: ${fromRowExpr(ctx, f, formNames)}`).join(",\n")}
  };
}`);
  parts.push(...fields.filter(f => f.picker).map(f => pickerComponent(ctx, f)));
  const hasFiles = fields.some(f => scalar(f.col) === "file");
  parts.push(`type ${prefix}Setter = <K extends keyof ${ValuesT}>(key: K, value: ${ValuesT}[K]) => void;

function render${prefix}Field(field: ${prefix}Field, values: ${ValuesT}, set: ${prefix}Setter${hasFiles ? `, current?: ${options.currentType ?? "Detail"} | null` : ""}) {
  switch (field) {
${cases}
  }
}

function ${prefix}Form({
  fields,
  initial,${hasFiles ? "\n  current," : ""}
  submitLabel,
  pending,
  error,
  onSubmit,
  onCancel
}: {
  fields: readonly ${prefix}Field[];
  initial: ${ValuesT};${hasFiles ? `\n  current?: ${options.currentType ?? "Detail"} | null;` : ""}
  submitLabel: string;
  pending: boolean;
  error: { message: string } | null;
  onSubmit: (values: ${ValuesT}) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<${ValuesT}>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const set: ${prefix}Setter = (key, value) => setValues(current => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    try {
      onSubmit(values);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form onSubmit={submit} className="grid max-w-xl gap-4">
      {fields.map(field => (
        <Fragment key={field}>{render${prefix}Field(field, values, set${hasFiles ? ", current" : ""})}</Fragment>
      ))}
      <ErrorNote error={error ?? (problem ? { message: problem } : null)} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}`);
  return parts.join("\n\n");
}

/** The list query input and its React state for a table page's controls */
function filterControls(ctx: Ctx, list: ListOp): { stateType: string; controls: string[]; toInput: string } {
  // A field the page's own filter fixes has no control: the fixed value would win over it
  const offered = list.filters.filter(f => !(f in (ctx.page.filter ?? {})));
  const entries = offered.map(f => {
    const col = ctx.entity.columns.find(c => c.name === f)!;
    const kind = scalar(col);
    let control: string;
    const label = humanize(f);
    if (kind === "enum") {
      use(ctx, "ui", "selectClass");
      control = `          <select aria-label=${q(label)} className={selectClass + " w-auto"} value={filters.${f} ?? ""} onChange={e => setFilter(${q(f)}, e.target.value)}>
            <option value="">${label}: any</option>
${enumValues(ctx, col)
  .map(v => `            <option value=${q(v)}>${v}</option>`)
  .join("\n")}
          </select>`;
    } else if (kind === "boolean") {
      use(ctx, "ui", "selectClass");
      control = `          <select aria-label=${q(label)} className={selectClass + " w-auto"} value={filters.${f} ?? ""} onChange={e => setFilter(${q(f)}, e.target.value)}>
            <option value="">${label}: any</option>
            <option value="true">${label}: yes</option>
            <option value="false">${label}: no</option>
          </select>`;
    } else {
      shadcn(ctx, "input", "Input");
      const type =
        kind === "integer" || kind === "bigint" || kind === "float" || kind === "decimal"
          ? "number"
          : kind === "date"
            ? "date"
            : "text";
      control = `          <Input aria-label=${q(label)} type=${q(type)} placeholder=${q(label)} className="w-40" value={filters.${f} ?? ""} onChange={e => setFilter(${q(f)}, e.target.value)} />`;
    }
    let value: string;
    switch (kind) {
      case "boolean":
        // The REST contract reads booleans from the query string as "true" | "false"; tRPC takes booleans
        value =
          ctx.target.kind === "next"
            ? `filters.${f} || undefined`
            : `filters.${f} === "true" ? true : filters.${f} === "false" ? false : undefined`;
        break;
      case "integer":
      case "bigint":
      case "float":
        value = `filters.${f} ? Number(filters.${f}) : undefined`;
        break;
      default:
        value = `filters.${f} || undefined`;
    }
    return { f, control, value };
  });
  return {
    stateType: `{ ${offered.map(f => `${f}?: string`).join("; ")} }`,
    controls: entries.map(e => e.control),
    toInput: entries.map(e => `${e.f}: ${e.value}`).join(", ")
  };
}

/** generated/app/pages/<page>.tsx for a resource page */
export function resourcePageFile(ir: IR, page: PageIR, target: WebTarget, conv: TsConventions): string {
  const resource = ir.resources.find(r => r.name === page.resource)!;
  const entity = entityByName(ir, resource.entity);
  const ops = resource.operations.filter(o => o.rule.kind !== "none");
  const list = ops.find(o => o.kind === "list") as ListOp | undefined;
  const get = ops.find(o => o.kind === "get") as GetOp | undefined;
  if (!list || !get)
    throw new Error(`page ${page.name}: resource ${resource.name} must allow list and get (its read rule is none)`);
  const create = ops.find(o => o.kind === "create") as CreateOp | undefined;
  // A detail page that takes over this page's detail owns the edit form, delete and the row actions
  const taken = Boolean(page.detailPage);
  const updateOp = ops.find(o => o.kind === "update") as UpdateOp | undefined;
  const update = taken ? undefined : updateOp;
  const remove = taken ? undefined : (ops.find(o => o.kind === "delete") as DeleteOp | undefined);
  const rowActions = taken ? [] : actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none" && a.scope === "row");
  const collectionActions = actionsOf(ir, resource.name).filter(
    a => a.rule.kind !== "none" && a.scope === "collection"
  );
  const layout = page.layout ?? "split";
  const ctx: Ctx = {
    ir,
    page,
    resource,
    entity,
    target,
    conv,
    pk: singlePrimaryKey(entity),
    intKey: isIntegerKey(singlePrimaryKey(entity)),
    imports: {
      router: { link: true, params: !taken, outlet: target.kind === "tanstack" },
      query: new Set(["useQuery"]),
      react: new Set(["useState"]),
      lucide: new Set(),
      ui: new Set(),
      shadcn: new Map(),
      client: new Set(["client", "sessionUser", "Inputs"]),
      tenant: new Set()
    }
  };
  if (target.kind === "next") use(ctx, "react", "ReactNode");
  const Comp = pageComponent(page);
  const R = resource.name;
  const pk = ctx.pk.name;
  const title = page.title;
  const one = entityTitle(entity);
  const listIncludes = list.include.map(name => entity.relations.find(r => r.name === name)!);
  const getIncludes = get.include.map(name => entity.relations.find(r => r.name === name)!);
  const idPk = identityKey(ir);
  // Fields with a read rule: a rule's condition on one is the API's to decide, and its column, detail row and input are for those who may read it
  const ruledNames: ReadonlySet<string> = new Set(ruledColumns(entity).map(c => c.name));
  // A sealed field's input is offered to whoever may write it: its readers are few or none, and it is never shown again
  const offeredByRule: ReadonlySet<string> = new Set(
    ruledColumns(entity)
      .filter(c => !c.sealed)
      .map(c => c.name)
  );
  // The context a filtered list sits in is sent with a create opened from it
  const presets = presetsOf(ir, page.filter, create);
  const preset = new Set(presets.map(p => p.field));
  const mutations = Boolean(create || update || remove || rowActions.length || collectionActions.length);
  if (mutations) {
    use(ctx, "query", "useMutation");
    use(ctx, "query", "useQueryClient");
  }
  if (create || remove || layout !== "split") ctx.imports.router.navigate = true;
  if (layout === "split") ctx.imports.router.pathname = true;

  const columns = page.columns.map(name => entity.columns.find(c => c.name === name)!);
  const [first, ...rest] = columns;
  const metaParts = [
    ...rest.map(c => showExpr(ctx, c, "row", listIncludes, "list")),
    ...relationListExprs(ctx).map(r => r.expr)
  ];
  const metaExpr = metaParts.length ? `[${metaParts.join(", ")}].filter(Boolean).join(" · ")` : null;
  use(ctx, "ui", "text");

  const sections: string[] = [];
  sections.push(`type Row = Outputs[${q(R)}]["list"]["data"][number];
type Detail = Outputs[${q(R)}]["get"];
${create || update ? `type Input<K extends keyof Inputs[${q(R)}]> = Inputs[${q(R)}][K];\n` : ""}
const PAGE_SIZE = ${layout === "board" ? 200 : list.pageSize};
const KEY = [${q(R)}] as const;

function idOf(raw: string) {
  return ${ctx.intKey ? "Number(raw)" : "raw"};
}`);

  // Permissions, evaluated client-side so the UI only offers what the API will allow
  const perms: string[] = [];
  if (create)
    perms.push(
      `function canCreate(user: SessionUser | null): boolean {\n  return ${rulePredicate(create.rule, "user", null, idPk)};\n}`
    );
  if (update)
    perms.push(
      `function canUpdate(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(update.rule, "user", "row", idPk, ruledNames)};\n}`
    );
  if (remove)
    perms.push(
      `function canDelete(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(remove.rule, "user", "row", idPk, ruledNames)};\n}`
    );
  for (const a of rowActions)
    perms.push(
      `function can${toPascalCase(a.name)}(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(a.rule, "user", "row", idPk, ruledNames)};\n}`
    );
  for (const a of collectionActions)
    perms.push(
      `function can${toPascalCase(a.name)}(user: SessionUser | null): boolean {\n  return ${rulePredicate(a.rule, "user", null, idPk)};\n}`
    );
  if (perms.length) use(ctx, "client", "SessionUser");
  const usesRow = perms.some(p => p.includes("row."));
  if (perms.length) sections.push(perms.join("\n\n"));
  if (page.filter) {
    use(ctx, "client", "SessionUser");
    if (usesContext(page.filter, "tenant")) use(ctx, "tenant", "Tenant");
    sections.push(fixedFilterDecl(page.filter, target, idPk, tenantKey(ir)));
  }
  const scope = tenantScope(ctx, page.filter);
  const gated = page.access.kind !== "public";
  if (gated) sections.push(gate(ctx, page.access));

  // The row form
  if (create || update) {
    use(ctx, "client", "Inputs");
    const names = entity.columns
      .map(c => c.name)
      .filter(n => (create?.fields.includes(n) && !preset.has(n)) || update?.fields.includes(n));
    const fields = formFields(
      ctx,
      names.map(n => entity.columns.find(c => c.name === n)!),
      entity
    );
    sections.push(
      formCode(ctx, Comp, fields, {
        createType: create ? `Input<"create">` : undefined,
        createFields: create
          ? fields.filter(f => create.fields.includes(f.col.name) && !preset.has(f.col.name))
          : undefined,
        presets: [...preset],
        updateType: update ? `Input<"update">["data"]` : undefined,
        updateFields: update ? fields.filter(f => update.fields.includes(f.col.name)) : undefined,
        fromRow: Boolean(update)
      })
    );
  }
  // Action forms, for actions with inputs
  for (const a of [...rowActions, ...collectionActions].filter(a => a.input.length)) {
    use(ctx, "client", "Inputs");
    const prefix = `${Comp}${toPascalCase(a.name)}`;
    const fields = formFields(ctx, a.input, null);
    sections.push(
      formCode(ctx, prefix, fields, {
        createType: `Omit<Inputs[${q(R)}][${q(a.name)}], "id">`,
        createFields: fields,
        currentType: "never"
      })
    );
  }

  const linkAttrs = (path: string, idExpr?: string) => target.linkAttrs(path, idExpr);
  const newLinkJsx = create
    ? `{canCreate(user) ? (
            <Link ${linkAttrs(`${page.path}/new`)} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label=${q(`New ${one.toLowerCase()}`)}>
              <Plus />
            </Link>
          ) : null}`
    : "";
  if (create) {
    use(ctx, "lucide", "Plus");
    shadcn(ctx, "button", "buttonVariants");
  }
  const collectionActionJsx = collectionActions.map(a => {
    const Pascal = toPascalCase(a.name);
    return a.input.length
      ? `{can${Pascal}(user) ? (
            <Button variant="outline" size="sm" onClick={() => setOpenAction(open => (open === ${q(a.name)} ? null : ${q(a.name)}))}>
              ${toTitleCase(a.name)}
            </Button>
          ) : null}`
      : `{can${Pascal}(user) ? (
            <Button variant="outline" size="sm" disabled={${a.name}Action.isPending} onClick={() => ${a.name}Action.mutate({})}>
              ${toTitleCase(a.name)}
            </Button>
          ) : null}`;
  });
  if (collectionActions.length) shadcn(ctx, "button", "Button");
  const collectionActionDecls = collectionActions.map(a => {
    use(ctx, "ui", "ErrorNote");
    return `  const ${a.name}Action = useMutation({
    mutationFn: (input: Inputs[${q(R)}][${q(a.name)}]) => client.${R}.${a.name}(input),
    onSuccess: async () => {
      setOpenAction(null);
      await queryClient.invalidateQueries({ queryKey: KEY });
    }
  });`;
  });
  const collectionActionForms = collectionActions
    .filter(a => a.input.length)
    .map(a => {
      const prefix = `${Comp}${toPascalCase(a.name)}`;
      return `        {openAction === ${q(a.name)} ? (
          <div className="border-b border-border px-4 py-3">
            <${prefix}Form fields={${prefix.toUpperCase()}_CREATE} initial={EMPTY_${prefix.toUpperCase()}} submitLabel=${q(toTitleCase(a.name))} pending={${a.name}Action.isPending} error={${a.name}Action.error} onCancel={() => setOpenAction(null)} onSubmit={values => ${a.name}Action.mutate(to${prefix}CreateInput(values))} />
          </div>
        ) : null}`;
    });
  const collectionErrors = collectionActions
    .filter(a => !a.input.length)
    .map(a => `        <ErrorNote error={${a.name}Action.error} className="m-4" />`);
  if (collectionActions.length) use(ctx, "client", "Inputs");
  const headerExtras = [newLinkJsx, ...collectionActionJsx].filter(Boolean).join("\n          ");

  // Layout, index, new, detail
  use(ctx, "ui", "PaneHeader");
  use(ctx, "ui", "ErrorNote");
  use(ctx, "ui", "EmptyPane");
  const sessionQuery = SESSION_QUERY;
  const { queryOpts, fixedSpread } = listQueryOptions(page);
  const listQueryDecl = (inputExpr: string) =>
    `useQuery({ queryKey: [...KEY, "list", ${inputExpr}], queryFn: () => client.${R}.list(${inputExpr})${queryOpts} })`;
  const detailLink = (idExpr: string) => linkAttrs(page.path, idExpr);

  if (layout === "split") {
    use(ctx, "ui", "ListSkeleton");
    use(ctx, "ui", "Pagination");
    const toggle = archiveToggle(ctx, true);
    const muted = archivedClass(ctx, "row");
    sections.push(`export function ${Comp}Layout(${target.layoutProps}) {
  const [page, setPage] = useState(1);${toggle?.decl ?? ""}
  const [openAction, setOpenAction] = useState<string | null>(null);
  void openAction;
  void setOpenAction;
  const session = ${sessionQuery};
  const user = sessionUser(session.data);
  void user;${scope.decl}
  const input = { page, page_size: PAGE_SIZE${toggle?.spread ?? ""}${fixedSpread} } as Inputs[${q(R)}]["list"];
  const list = ${listQueryDecl("input")};
  ${target.activeDecl}${mutations ? "\n  const queryClient = useQueryClient();" : ""}
${collectionActionDecls.join("\n")}
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border">
        <PaneHeader title=${q(title)} count={list.data?.page.total}>
          ${[toggle?.button, headerExtras].filter(Boolean).join("\n          ")}
        </PaneHeader>
${collectionActionForms.join("\n")}
${collectionErrors.join("\n")}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {${scope.none("          ")}list.isPending ? (
            <ListSkeleton />
          ) : list.error ? (
            <ErrorNote error={list.error} className="m-4" />
          ) : list.data.data.length === 0 ? (
            <EmptyPane>${toggle ? `{archived ? ${q(`No archived ${title.toLowerCase()}.`)} : ${q(`No ${title.toLowerCase()} yet.`)}}` : `No ${title.toLowerCase()} yet.`}</EmptyPane>
          ) : (
            <ul className="py-1">
              {list.data.data.map((row: Row) => (
                <li key={text(row.${pk})}>
                  <Link
                    ${detailLink(`text(row.${pk})`)}
                    className={cn("block border-l-2 border-transparent px-4 py-2 hover:bg-accent/60", ${target.isActive(page.path, `text(row.${pk})`)} && "border-primary bg-accent"${muted ? `, ${muted}` : ""})}
                  >
                    <div className="truncate text-sm font-medium">{${showExpr(ctx, first, "row", listIncludes, "list")} || ${q(`${one} `)} + text(row.${pk})}</div>${
                      metaExpr
                        ? `
                    <div className="truncate text-xs text-muted-foreground">{${metaExpr}}</div>`
                        : ""
                    }
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.page.total} onChange={setPage} /> : null}
      </aside>
      <section className="min-w-0 flex-1 overflow-y-auto">
        ${target.outlet}
      </section>
    </div>
  );
}

export function ${Comp}Index() {
  return <EmptyPane>Select ${article(one)} from the list${create ? ", or create one" : ""}.</EmptyPane>;
}`);
    use(ctx, "ui", "cn");
  } else {
    sections.push(`export function ${Comp}Layout(${target.layoutProps}) {
  return <div className="h-full min-h-0 overflow-hidden">${target.outlet}</div>;
}`);
    if (layout === "table")
      sections.push(
        tableIndex(ctx, list, headerExtras, collectionActionDecls, collectionActionForms, collectionErrors, mutations)
      );
    else
      sections.push(
        boardIndex(ctx, list, idPk, headerExtras, collectionActionDecls, collectionActionForms, collectionErrors)
      );
  }

  if (create) {
    use(ctx, "ui", "Pane");
    const presetTenant = presets.some(p => p.context === "tenant");
    const presetActor = presets.some(p => p.context === "actor");
    if (presetTenant) {
      use(ctx, "tenant", "useTenant");
      use(ctx, "tenant", "NoTenant");
      use(ctx, "ui", "PaneSkeleton");
    }
    const back = layout === "split" ? "" : backLink(ctx);
    const createRuled = create.fields.some(f => offeredByRule.has(f));
    if (createRuled) use(ctx, "client", "fieldsOf");
    sections.push(`export function ${Comp}New() {
  ${target.navigateDecl}
  const queryClient = useQueryClient();${presetTenant ? "\n  const { tenant, loading: tenantLoading } = useTenant();" : ""}${
    presetActor
      ? `
  const session = ${sessionQuery};
  const user = sessionUser(session.data);`
      : ""
  }
  const createRow = useMutation({
    mutationFn: (input: Input<"create">) => client.${R}.create(input),
    onSuccess: async row => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      await ${target.navigateTo(page.path, `text(row.${pk})`)};
    }
  });${
    createRuled
      ? `
  // A field with a read rule is offered only to a viewer who could read it, and is not sent otherwise${
    presetActor
      ? ""
      : `
  const session = ${sessionQuery};`
  }
  const could: Record<string, boolean> = fieldsOf(session.data).${R};
  const readable = (field: string) => could[field] === true;`
      : ""
  }${
    presetTenant
      ? `
  if (tenantLoading) return <PaneSkeleton />;
  if (tenant === null) return <NoTenant />;`
      : ""
  }
  return (
    <Pane title=${q(`New ${one.toLowerCase()}`)}${back ? ` actions={${back}}` : ""}>
      <${Comp}Form
        fields={${createRuled ? `offered${Comp}(${Comp.toUpperCase()}_CREATE, readable)` : `${Comp.toUpperCase()}_CREATE`}}
        initial={EMPTY_${Comp.toUpperCase()}}
        submitLabel="Create"
        pending={createRow.isPending}
        error={createRow.error}
        onSubmit={values => createRow.mutate(${presetInput(presets, createRuled ? `sent${Comp}(to${Comp}CreateInput(values), readable)` : `to${Comp}CreateInput(values)`, `Input<"create">`)})}
      />
    </Pane>
  );
}`);
  }

  // Detail: the page's own, unless a detail page takes it over
  if (!taken)
    sections.push(
      detailComponent(ctx, {
        name: `${Comp}Detail`,
        form: Comp,
        base: page.path,
        listPath: page.path,
        back: layout !== "split",
        fields: page.fields,
        get,
        update,
        remove,
        rowActions,
        queryClient: mutations,
        usesRow,
        reverse: true,
        sections: []
      })
    );

  const body = sections.join("\n\n");
  const shape = layout === "split" ? "a master list" : layout === "table" ? "a table" : "a board";
  const detail = taken
    ? `; the ${page.detailPage} page shows the selected one`
    : " and a detail pane for the selected one";
  const source = `${conv.header(`The ${title} page: ${shape} of ${entity.name} rows${detail}.`)}
${pageImports(ctx).join("\n")}

${body}
`;
  return gated ? guardExports(source, [`${Comp}Layout`, `${Comp}Index`, `${Comp}New`, `${Comp}Detail`]) : source;
}

function backLink(ctx: Ctx, path: string = ctx.page.path): string {
  use(ctx, "lucide", "ArrowLeft");
  shadcn(ctx, "button", "buttonVariants");
  ctx.imports.router.link = true;
  return `<Link ${ctx.target.linkAttrs(path)} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Back">
            <ArrowLeft />
          </Link>`;
}

/** The session query every page component reads the signed-in user from */
const SESSION_QUERY = `useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() })`;

/** The access gate of a page that is not public, with what it imports */
function gate(ctx: Ctx, access: RuleIR): string {
  use(ctx, "client", "SessionUser");
  use(ctx, "client", "client");
  use(ctx, "client", "sessionUser");
  use(ctx, "query", "useQuery");
  use(ctx, "react", "ReactNode");
  use(ctx, "ui", "PaneSkeleton");
  ctx.imports.router.link = true;
  shadcn(ctx, "card", "Card");
  shadcn(ctx, "card", "CardContent");
  shadcn(ctx, "card", "CardDescription");
  shadcn(ctx, "card", "CardHeader");
  shadcn(ctx, "card", "CardTitle");
  shadcn(ctx, "button", "buttonVariants");
  return accessGateDecl(access, ctx.target, identityKey(ctx.ir));
}

/** The import lines of a page module, from what its code used */
function pageImports(ctx: Ctx): string[] {
  const imports: string[] = ['"use client";'];
  imports.push(`import { ${[...ctx.imports.query].sort().join(", ")} } from "@tanstack/react-query";`);
  imports.push(...ctx.target.routerImports(ctx.imports.router));
  if (ctx.imports.lucide.size)
    imports.push(`import { ${[...ctx.imports.lucide].sort().join(", ")} } from "lucide-react";`);
  const react = [...ctx.imports.react].sort();
  const reactValues = react.filter(n => n !== "FormEvent" && n !== "ReactNode");
  const reactTypes = react.filter(n => n === "FormEvent" || n === "ReactNode");
  if (react.length)
    imports.push(`import { ${[...reactValues, ...reactTypes.map(t => `type ${t}`)].join(", ")} } from "react";`);
  for (const [file, names] of [...ctx.imports.shadcn.entries()].sort(([a], [b]) => a.localeCompare(b)))
    imports.push(`import { ${[...names].sort().join(", ")} } from "@/components/ui/${file}";`);
  const ui = new Set(ctx.imports.ui);
  if (ui.delete("cn")) imports.push(`import { cn } from "@/lib/utils";`);
  const clientNames = [...ctx.imports.client].sort();
  const clientValues = clientNames.filter(n => !["Inputs", "Outputs", "SessionUser"].includes(n));
  const clientTypes = ["Inputs", "Outputs", "SessionUser"].filter(n => clientNames.includes(n) || n === "Outputs");
  imports.push(
    `import { ${clientValues.join(", ")}, ${clientTypes.map(t => `type ${t}`).join(", ")} } from "../client";`
  );
  if (ctx.imports.tenant.size) {
    const names = [...ctx.imports.tenant].sort();
    const specifiers = [
      ...names.filter(n => n !== "Tenant"),
      ...names.filter(n => n === "Tenant").map(t => `type ${t}`)
    ];
    imports.push(`import { ${specifiers.join(", ")} } from "../tenant";`);
  }
  imports.push(`import { ${[...ui].sort().join(", ")} } from "../ui";`);
  return imports;
}

/** What a detail component is built from: the generated detail of a resource page, or a detail page */
interface DetailParts {
  /** The exported component */
  name: string;
  /** The prefix of the row form and of the row action forms */
  form: string;
  /** The path the row's address hangs off: `<base>/:id` */
  base: string;
  /** The route the address is read from on TanStack, when it is not `<base>/$id` */
  routeId?: string;
  /** The list the row belongs to: where delete returns and the back link points. A page of its own has none. */
  listPath: string | null;
  back: boolean;
  fields: string[];
  get: GetOp;
  update?: UpdateOp;
  remove?: DeleteOp;
  rowActions: ActionIR[];
  /** Whether the component declares the query client */
  queryClient: boolean;
  /** Whether a permission reads the row */
  usesRow: boolean;
  /** Whether the reverse relations the get includes are listed; a detail page's sections replace them */
  reverse: boolean;
  /** The JSX of the sections under the row */
  sections: string[];
  /** Seconds between refetches of the row */
  refresh?: number;
}

/** The component that shows one row: its title, fields, edit form, delete and row actions, then its sections */
function detailComponent(ctx: Ctx, d: DetailParts): string {
  const { ir, entity, target } = ctx;
  const R = ctx.resource.name;
  const pk = ctx.pk.name;
  const one = entityTitle(entity);
  const Form = d.form;
  const { update, remove, rowActions } = d;
  const includes = d.get.include.map(name => entity.relations.find(r => r.name === name)!);
  use(ctx, "ui", "Pane");
  use(ctx, "ui", "PaneSkeleton");
  use(ctx, "ui", "RowError");
  use(ctx, "ui", "text");
  const detailFields = d.fields.map(name => entity.columns.find(c => c.name === name)!);
  // An input of a field with a read rule is offered in the edit form only where the row carries the field; a
  // sealed field's always is, since its readers are few or none and it is never shown again
  const offeredByRule: ReadonlySet<string> = new Set(
    ruledColumns(entity)
      .filter(c => !c.sealed)
      .map(c => c.name)
  );
  const updateRuled = Boolean(update?.fields.some(f => offeredByRule.has(f)));
  const getThrough = (d.get.through ?? []).map(name => entity.through!.find(t => t.name === name)!);
  // A detail page's sections replace the reverse relations, except an ordered one: a section cannot reorder it
  const ordered = includes.filter(r => r.direction === "reverse" && r.orderBy);
  const rows = [
    ...detailFields.map(c => detailRow(ctx, c, includes)),
    ...reverseRows(ctx, d.reverse ? includes : ordered),
    ...getThrough.map(
      rel => `        <FieldRow label=${q(humanize(rel.name))}>
          <${relationFieldName(ctx, rel.name)} row={row} user={user} />
        </FieldRow>`
    )
  ];
  if (getThrough.length) use(ctx, "ui", "FieldRow");
  // The relations the pane shows with their own controls: each is a component of its own, with its own requests
  const components: string[] = [];
  for (const rel of ordered) components.push(orderedChildrenComponent(ctx, rel));
  for (const rel of getThrough) components.push(throughFieldComponent(ctx, rel));
  const actions: string[] = [];
  if (d.back && d.listPath !== null) actions.push(`          ${backLink(ctx, d.listPath)}`);
  for (const a of rowActions) {
    shadcn(ctx, "button", "Button");
    const Pascal = toPascalCase(a.name);
    // The compiler's archive shows on a live row and its restore on an archived one, and a transition on a row in
    // one of the states it starts from: the others would answer 409
    const when =
      a.builtin === "archive"
        ? ` && !row.${entity.archive!.column}`
        : a.builtin === "restore"
          ? ` && row.${entity.archive!.column}`
          : a.builtin === "transition"
            ? ` && [${transitionOf(ir, a).from.map(q).join(", ")}].includes(String(row.${entity.transitions!.column}))`
            : "";
    actions.push(
      a.input.length
        ? `          {can${Pascal}(user, row) ? (
            <Button variant="outline" size="sm" onClick={() => setOpenAction(open => (open === ${q(a.name)} ? null : ${q(a.name)}))}>
              ${toTitleCase(a.name)}
            </Button>
          ) : null}`
        : `          {can${Pascal}(user, row)${when} ? (
            <Button variant="outline" size="sm" disabled={${a.name}Action.isPending} onClick={() => ${a.name}Action.mutate({ id })}>
              ${toTitleCase(a.name)}
            </Button>
          ) : null}`
    );
  }
  if (update) {
    shadcn(ctx, "button", "Button");
    actions.push(`          {canUpdate(user, row) ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(current => !current)}>
              {editing ? "Cancel" : "Edit"}
            </Button>
          ) : null}`);
  }
  if (remove) {
    shadcn(ctx, "button", "Button");
    ctx.imports.router.navigate = true;
    actions.push(`          {canDelete(user, row) ? (
            <Button
              variant="destructive"
              size="sm"
              disabled={removeRow.isPending}
              onClick={() => {
                if (window.confirm(${q(`Delete this ${one.toLowerCase()}?`)})) removeRow.mutate({ id });
              }}
            >
              Delete
            </Button>
          ) : null}`);
  }
  if (update || rowActions.length) {
    use(ctx, "react", "useEffect");
    use(ctx, "react", "useState");
  }
  if (update || remove || rowActions.length) {
    use(ctx, "client", "Inputs");
    use(ctx, "query", "useMutation");
  }
  if (d.queryClient) use(ctx, "query", "useQueryClient");
  const rowActionDecls = rowActions.map(
    a => `  const ${a.name}Action = useMutation({
    mutationFn: (input: Inputs[${q(R)}][${q(a.name)}]) => client.${R}.${a.name}(input),
    onSuccess: async () => {
      setOpenAction(null);
      await queryClient.invalidateQueries({ queryKey: KEY });
    }
  });`
  );
  const rowActionForms = rowActions
    .filter(a => a.input.length)
    .map(a => {
      const prefix = `${Form}${toPascalCase(a.name)}`;
      return `      {openAction === ${q(a.name)} ? (
        <div className="mb-6 rounded-md border border-border p-4">
          <${prefix}Form fields={${prefix.toUpperCase()}_CREATE} initial={EMPTY_${prefix.toUpperCase()}} submitLabel=${q(toTitleCase(a.name))} pending={${a.name}Action.isPending} error={${a.name}Action.error} onCancel={() => setOpenAction(null)} onSubmit={values => ${a.name}Action.mutate({ id, ...to${prefix}CreateInput(values) })} />
        </div>
      ) : null}`;
    });
  const rowActionErrors = rowActions
    .filter(a => !a.input.length)
    .map(a => `      <ErrorNote error={${a.name}Action.error} className="mb-4" />`);
  if (rowActionErrors.length) use(ctx, "ui", "ErrorNote");
  const detailBody = update
    ? `      {editing ? (
        <${Form}Form
          fields={${updateRuled ? `offered${Form}(${Form.toUpperCase()}_UPDATE, field => field in row)` : `${Form.toUpperCase()}_UPDATE`}}
          initial={${Form.charAt(0).toLowerCase()}${Form.slice(1)}FromRow(row)}${entity.columns.some(c => c.type.kind === "file" && update.fields.includes(c.name)) ? "\n          current={row}" : ""}
          submitLabel="Save"
          pending={updateRow.isPending}
          error={updateRow.error}
          onCancel={() => setEditing(false)}
          onSubmit={values => updateRow.mutate({ id, data: ${updateRuled ? `sent${Form}(to${Form}UpdateInput(values), field => field in row)` : `to${Form}UpdateInput(values)`} })}
        />
      ) : (
        <dl className="grid gap-3">
${rows.join("\n")}
        </dl>
      )}`
    : `      <dl className="grid gap-3">
${rows.join("\n")}
      </dl>`;
  // The API's answer decides what the address shows: a missing or hidden row, a refusal, or a sign-in
  let signIn = "";
  if (ir.auth) {
    ctx.imports.router.link = true;
    shadcn(ctx, "button", "buttonVariants");
    signIn = ` signIn={<Link ${target.linkAttrs("/login")} className={buttonVariants()}>Sign in</Link>}`;
  }
  const refetch = d.refresh ? `, refetchInterval: ${d.refresh * 1000}` : "";
  const component = `export function ${d.name}() {
  ${target.useIdParam(d.base, d.routeId)}
  const id = idOf(rawId);${remove ? `\n  ${target.navigateDecl}` : ""}${
    d.queryClient
      ? `
  const queryClient = useQueryClient();`
      : ""
  }${
    update
      ? `
  const [editing, setEditing] = useState(false);`
      : ""
  }${
    rowActions.length
      ? `
  const [openAction, setOpenAction] = useState<string | null>(null);`
      : ""
  }${
    update || rowActions.length
      ? `
  useEffect(() => {${update ? "\n    setEditing(false);" : ""}${rowActions.length ? "\n    setOpenAction(null);" : ""}
  }, [id]);`
      : ""
  }
  const query = useQuery({ queryKey: [...KEY, "get", id], queryFn: () => client.${R}.get({ id })${refetch} });
  const session = ${SESSION_QUERY};
  const user = sessionUser(session.data);
  void user;${
    update
      ? `
  const updateRow = useMutation({
    mutationFn: (input: Inputs[${q(R)}]["update"]) => client.${R}.update(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      setEditing(false);
    }
  });`
      : ""
  }${
    remove
      ? `
  const removeRow = useMutation({
    mutationFn: (input: Inputs[${q(R)}]["delete"]) => client.${R}.delete(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      await ${target.navigateTo(d.listPath ?? "/")};
    }
  });`
      : ""
  }
${rowActionDecls.join("\n")}
  if (query.isPending) return <PaneSkeleton />;
  if (query.error) return <RowError error={query.error}${signIn} />;
  const row: Detail = query.data;${d.usesRow ? "" : "\n  void row;"}
  return (
    <Pane
      title={${showExpr(ctx, entity.columns.find(c => c.name === entity.display)!, "row", includes, "detail")} || ${q(`${one} `)} + text(row.${pk})}${
        actions.length
          ? `
      actions={
        <>
${actions.join("\n")}
        </>
      }`
          : ""
      }
    >
${rowActionForms.join("\n")}
${rowActionErrors.join("\n")}
${detailBody}${d.sections.map(s => `\n${s}`).join("")}
    </Pane>
  );
}`;
  return [...components, component].join("\n\n");
}

/** The index of a table page: filters, search, sortable columns, paging, row click */
function tableIndex(
  ctx: Ctx,
  list: ListOp,
  headerExtras: string,
  actionDecls: string[],
  actionForms: string[],
  actionErrors: string[],
  mutations: boolean
): string {
  const { page, entity, resource, target } = ctx;
  const Comp = pageComponent(page);
  const R = resource.name;
  const pk = ctx.pk.name;
  const columns = page.columns.map(name => entity.columns.find(c => c.name === name)!);
  const listIncludes = list.include.map(name => entity.relations.find(r => r.name === name)!);
  const filters = filterControls(ctx, list);
  const { queryOpts, fixedSpread } = listQueryOptions(page);
  const scope = tenantScope(ctx, page.filter);
  const toggle = archiveToggle(ctx, true);
  const muted = archivedClass(ctx, "row");
  if (muted) use(ctx, "ui", "cn");
  shadcn(ctx, "table", "Table");
  shadcn(ctx, "table", "TableBody");
  shadcn(ctx, "table", "TableCell");
  shadcn(ctx, "table", "TableHead");
  shadcn(ctx, "table", "TableHeader");
  shadcn(ctx, "table", "TableRow");
  use(ctx, "ui", "Pagination");
  use(ctx, "ui", "ListSkeleton");
  if (list.sortable.length) use(ctx, "ui", "SortHeader");
  if (list.search.length) {
    use(ctx, "ui", "useDebounced");
    shadcn(ctx, "input", "Input");
  }
  use(ctx, "client", "Inputs");
  const heads = columns.map(c =>
    list.sortable.includes(c.name)
      ? `                <TableHead>
                  <SortHeader field=${q(c.name)} sort={sort} onSort={next => { setSort(next); setPage(1); }}>
                    ${humanize(c.name)}
                  </SortHeader>
                </TableHead>`
      : c.read
        ? `                {could.${c.name} ? <TableHead>${humanize(c.name)}</TableHead> : null}`
        : `                <TableHead>${humanize(c.name)}</TableHead>`
  );
  // A column of a field with a read rule is there only for a viewer who could read it on some row; a row leaves its cell empty when its own rule refuses
  const cells = columns.map(c =>
    c.read
      ? `                  {could.${c.name} ? <TableCell>{${showExpr(ctx, c, "row", listIncludes, "list")}}</TableCell> : null}`
      : `                  <TableCell>{${showExpr(ctx, c, "row", listIncludes, "list")}}</TableCell>`
  );
  const ruledColumn = columns.some(c => c.read);
  if (ruledColumn) use(ctx, "client", "fieldsOf");
  for (const relation of relationListExprs(ctx)) {
    heads.push(`                <TableHead>${humanize(relation.name)}</TableHead>`);
    cells.push(`                  <TableCell>{${relation.expr}}</TableCell>`);
  }
  return `export function ${Comp}Index() {
  const [page, setPage] = useState(1);${toggle?.decl ?? ""}
  const [sort, setSort] = useState<string | undefined>(undefined);${list.sortable.length ? "" : "\n  void setSort;"}
${
  list.search.length
    ? `  const [search, setSearch] = useState("");
  const q = useDebounced(search);`
    : ""
}
  const [filters, setFilters] = useState<${filters.stateType}>({});
  const [openAction, setOpenAction] = useState<string | null>(null);
  void openAction;
  void setOpenAction;
  const setFilter = (key: keyof typeof filters, value: string) => {
    setFilters(current => ({ ...current, [key]: value }));
    setPage(1);
  };
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  void user;${ruledColumn ? `\n  const could = fieldsOf(session.data).${R};` : ""}${scope.decl}
  const input = {
    page,
    page_size: PAGE_SIZE${list.sortable.length ? ",\n    sort" : ""}${list.search.length ? ",\n    q: q || undefined" : ""}${filters.toInput ? `,\n    ${filters.toInput}` : ""}${toggle ? `,\n    ${toggle.spread.slice(2)}` : ""}${fixedSpread.replace(", ", ",\n    ")}
  } as Inputs[${q(R)}]["list"];
  const list = useQuery({ queryKey: [...KEY, "list", input], queryFn: () => client.${R}.list(input)${queryOpts} });
  ${target.navigateDecl}${mutations ? "\n  const queryClient = useQueryClient();" : ""}
${actionDecls.join("\n")}
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader title=${q(page.title)} count={list.data?.page.total}>
          ${[toggle?.button, headerExtras].filter(Boolean).join("\n          ")}
      </PaneHeader>
${actionForms.join("\n")}
${actionErrors.join("\n")}
      ${
        list.search.length || filters.controls.length
          ? `<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
${list.search.length ? `          <Input type="search" placeholder="Search" className="w-56" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />` : ""}
${filters.controls.join("\n")}
      </div>`
          : ""
      }
      <div className="min-h-0 flex-1 overflow-auto px-4">
        {${scope.none("        ")}list.isPending ? (
          <ListSkeleton />
        ) : list.error ? (
          <ErrorNote error={list.error} className="m-4" />
        ) : list.data.data.length === 0 ? (
          <EmptyPane>No ${page.title.toLowerCase()} found.</EmptyPane>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
${heads.join("\n")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.data.map((row: Row) => (
                <TableRow key={text(row.${pk})} className=${muted ? `{cn("cursor-pointer", ${muted})}` : `"cursor-pointer"`} onClick={() => ${target.navigateTo(page.path, `text(row.${pk})`)}}>
${cells.join("\n")}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {list.data ? <Pagination page={page} pageSize={PAGE_SIZE} total={list.data.page.total} onChange={setPage} /> : null}
    </div>
  );
}`;
}

/**
 * The index of a board page: one column per value of the group field, native drag and drop to move cards. A drop
 * updates the field, unless the field is the one a state machine moves: then a drop runs the transition that takes
 * the card from its column to that one, and a column no transition reaches from there takes no drop at all.
 */
function boardIndex(
  ctx: Ctx,
  list: ListOp,
  idPk: string,
  headerExtras: string,
  actionDecls: string[],
  actionForms: string[],
  actionErrors: string[]
): string {
  const { page, entity, resource, target } = ctx;
  const Comp = pageComponent(page);
  const R = resource.name;
  const pk = ctx.pk.name;
  const groupBy = page.groupBy!;
  const { queryOpts, fixedSpread } = listQueryOptions(page);
  const toggle = archiveToggle(ctx, false);
  const scope = tenantScope(ctx, page.filter);
  const groupCol = entity.columns.find(c => c.name === groupBy)!;
  const values = enumValues(ctx, groupCol);
  const columns = page.columns.map(name => entity.columns.find(c => c.name === name)!).filter(c => c.name !== groupBy);
  const listIncludes = list.include.map(name => entity.relations.find(r => r.name === name)!);
  const [first, ...rest] = columns.length ? columns : [entity.columns.find(c => c.name === entity.display)!];
  const metaParts = [
    ...rest.map(c => showExpr(ctx, c, "row", listIncludes, "list")),
    ...relationListExprs(ctx).map(r => r.expr)
  ];
  const metaExpr = metaParts.length ? `[${metaParts.join(", ")}].filter(Boolean).join(" · ")` : null;
  use(ctx, "query", "useMutation");
  use(ctx, "query", "useQueryClient");
  use(ctx, "ui", "ListSkeleton");
  use(ctx, "client", "Inputs");
  use(ctx, "client", "Outputs");
  if (entity.transitions?.column === groupBy)
    return transitionBoard(ctx, idPk, values, first, metaExpr, listIncludes, headerExtras, [
      actionDecls,
      actionForms,
      actionErrors
    ]);
  return `const BOARD_INPUT = { page: 1, page_size: PAGE_SIZE } as Inputs[${q(R)}]["list"];
const COLUMNS = [${values.map(q).join(", ")}] as const;
type Column = (typeof COLUMNS)[number];

export function ${Comp}Index() {${toggle?.decl ?? ""}
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  void user;${scope.decl}
  const boardInput = { ...BOARD_INPUT${toggle?.spread ?? ""}${fixedSpread} } as Inputs[${q(R)}]["list"];
  const boardKey = [...KEY, "list", boardInput] as const;
  const list = useQuery({ queryKey: boardKey, queryFn: () => client.${R}.list(boardInput)${queryOpts} });
  const [openAction, setOpenAction] = useState<string | null>(null);
  void openAction;
  void setOpenAction;
  ${target.navigateDecl}
  const queryClient = useQueryClient();
${actionDecls.join("\n")}
  const move = useMutation({
    mutationFn: ({ id, ${groupBy} }: { id: Row[${q(pk)}]; ${groupBy}: Column }) => client.${R}.update({ id, data: { ${groupBy} } }),
    onMutate: async ({ id, ${groupBy} }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<Outputs[${q(R)}]["list"]>(boardKey);
      if (previous) {
        queryClient.setQueryData<Outputs[${q(R)}]["list"]>(boardKey, {
          ...previous,
          data: previous.data.map(row => (row.${pk} === id ? { ...row, ${groupBy} } : row))
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY })
  });
  const rows = list.data?.data ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader title=${q(page.title)} count={list.data?.page.total}>
          ${[toggle?.button, headerExtras].filter(Boolean).join("\n          ")}
      </PaneHeader>
${actionForms.join("\n")}
${actionErrors.join("\n")}
      <ErrorNote error={move.error ?? list.error} className="m-4" />
      {${scope.none("      ")}list.isPending ? (
        <ListSkeleton />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
          {COLUMNS.map(column => (
            <section
              key={column}
              className="flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30"
              onDragOver={event => event.preventDefault()}
              onDrop={event => {
                event.preventDefault();
                const dragged = event.dataTransfer.getData("text/plain");
                const row = rows.find(r => text(r.${pk}) === dragged);
                if (row && row.${groupBy} !== column) move.mutate({ id: row.${pk}, ${groupBy}: column });
              }}
            >
              <header className="flex items-center justify-between px-3 py-2 text-sm font-medium">
                <span>{column}</span>
                <span className="text-xs text-muted-foreground">{rows.filter(r => r.${groupBy} === column).length}</span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {rows
                  .filter(r => r.${groupBy} === column)
                  .map((row: Row) => (
                    <div
                      key={text(row.${pk})}
                      draggable
                      onDragStart={event => {
                        event.dataTransfer.setData("text/plain", text(row.${pk}));
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => ${target.navigateTo(page.path, `text(row.${pk})`)}}
                      className="cursor-grab rounded-md border border-border bg-card p-3 text-sm shadow-xs hover:bg-accent/40 active:cursor-grabbing"
                    >
                      <div className="font-medium">{${showExpr(ctx, first, "row", listIncludes, "list")} || text(row.${pk})}</div>${
                        metaExpr
                          ? `
                      <div className="mt-1 text-xs text-muted-foreground">{${metaExpr}}</div>`
                          : ""
                      }
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}`;
}

/**
 * The index of a board over the field of a state machine. MOVES is the transition table the viewer may use; a card
 * dragged over a column is offered the drop only when one of them takes it there from where it is, and the drop
 * runs that transition. The field is never updated: a refused transition (409 when the card was stale, 403 when the
 * rule depends on more than the page knows) puts the card back.
 */
function transitionBoard(
  ctx: Ctx,
  idPk: string,
  values: string[],
  first: ColumnIR,
  metaExpr: string | null,
  listIncludes: RelationIR[],
  headerExtras: string,
  [actionDecls, actionForms, actionErrors]: [string[], string[], string[]]
): string {
  const { page, entity, resource, target, ir } = ctx;
  const Comp = pageComponent(page);
  const R = resource.name;
  const pk = ctx.pk.name;
  const groupBy = page.groupBy!;
  const { queryOpts, fixedSpread } = listQueryOptions(page);
  const toggle = archiveToggle(ctx, false);
  const scope = tenantScope(ctx, page.filter);
  const steps = actionsOf(ir, R).filter(a => a.builtin === "transition" && a.rule.kind !== "none");
  use(ctx, "client", "SessionUser");
  use(ctx, "react", "useRef");
  use(ctx, "ui", "cn");
  const moves = steps.map(a => {
    const step = transitionOf(ir, a);
    return `  {
    name: ${q(step.name)},
    from: [${step.from.map(q).join(", ")}],
    to: ${q(step.to)},
    allowed: (user, row) => ${rulePredicate(a.rule, "user", "row", idPk, new Set(ruledColumns(ctx.entity).map(c => c.name)))},
    run: id => client.${R}.${a.name}({ id })
  }`;
  });
  return `const BOARD_INPUT = { page: 1, page_size: PAGE_SIZE } as Inputs[${q(R)}]["list"];
const COLUMNS = [${values.map(q).join(", ")}] as const;
type Column = (typeof COLUMNS)[number];

/** The transitions of ${entity.name}: a card moves from one column to another only along one of these */
interface Move {
  name: string;
  from: readonly string[];
  to: Column;
  /** Whether the viewer's rule lets them run it on this card */
  allowed(user: SessionUser | null, row: Row): boolean;
  run(id: Row[${q(pk)}]): Promise<unknown>;
}

const MOVES: Move[] = [
${moves.join(",\n")}
];

/** The transition that takes a card to a column from where it is, if the viewer may run one */
function moveTo(user: SessionUser | null, row: Row, column: Column): Move | undefined {
  return MOVES.find(move => move.to === column && move.from.includes(String(row.${groupBy})) && move.allowed(user, row));
}

export function ${Comp}Index() {${toggle?.decl ?? ""}
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);${scope.decl}
  const boardInput = { ...BOARD_INPUT${toggle?.spread ?? ""}${fixedSpread} } as Inputs[${q(R)}]["list"];
  const boardKey = [...KEY, "list", boardInput] as const;
  const list = useQuery({ queryKey: boardKey, queryFn: () => client.${R}.list(boardInput)${queryOpts} });
  const [openAction, setOpenAction] = useState<string | null>(null);
  void openAction;
  void setOpenAction;
  // The card in the air, the column that last refused it, and what the board says about a drop it did not take
  const [dragging, setDragging] = useState<Row | null>(null);
  const refusedBy = useRef<Column | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  ${target.navigateDecl}
  const queryClient = useQueryClient();
${actionDecls.join("\n")}
  const move = useMutation({
    mutationFn: ({ id, step }: { id: Row[${q(pk)}]; step: Move }) => step.run(id),
    onMutate: async ({ id, step }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const previous = queryClient.getQueryData<Outputs[${q(R)}]["list"]>(boardKey);
      if (previous) {
        queryClient.setQueryData<Outputs[${q(R)}]["list"]>(boardKey, {
          ...previous,
          data: previous.data.map(row => (row.${pk} === id ? { ...row, ${groupBy}: step.to } : row))
        });
      }
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(boardKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY })
  });
  const rows = list.data?.data ?? [];
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onDragOverCapture={() => {
        refusedBy.current = null;
      }}
    >
      <PaneHeader title=${q(page.title)} count={list.data?.page.total}>
          ${[toggle?.button, headerExtras].filter(Boolean).join("\n          ")}
      </PaneHeader>
${actionForms.join("\n")}
${actionErrors.join("\n")}
      <ErrorNote error={move.error ?? list.error} className="m-4" />
      {refusal ? (
        <p role="status" data-board-refusal className="mx-4 mt-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {refusal}
        </p>
      ) : null}
      {${scope.none("      ")}list.isPending ? (
        <ListSkeleton />
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4">
          {COLUMNS.map(column => {
            const offered = dragging && dragging.${groupBy} !== column ? Boolean(moveTo(user, dragging, column)) : null;
            return (
              <section
                key={column}
                data-column={column}
                data-offered={offered === null ? undefined : offered}
                className={cn(
                  "flex w-72 shrink-0 flex-col rounded-lg border border-border bg-muted/30",
                  offered === true && "ring-2 ring-ring",
                  offered === false && "opacity-50"
                )}
                onDragOver={event => {
                  if (!dragging || dragging.${groupBy} === column) return;
                  // Only a column a transition reaches takes the drop; over any other the browser shows no-drop
                  if (moveTo(user, dragging, column)) event.preventDefault();
                  else refusedBy.current = column;
                }}
                onDrop={event => {
                  event.preventDefault();
                  const step = dragging ? moveTo(user, dragging, column) : undefined;
                  if (dragging && step) move.mutate({ id: dragging.${pk}, step });
                  setDragging(null);
                }}
              >
                <header className="flex items-center justify-between px-3 py-2 text-sm font-medium">
                  <span>{column}</span>
                  <span className="text-xs text-muted-foreground">{rows.filter(r => r.${groupBy} === column).length}</span>
                </header>
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                  {rows
                    .filter(r => r.${groupBy} === column)
                    .map((row: Row) => (
                      <div
                        key={text(row.${pk})}
                        data-card={text(row.${pk})}
                        draggable
                        onDragStart={event => {
                          event.dataTransfer.setData("text/plain", text(row.${pk}));
                          event.dataTransfer.effectAllowed = "move";
                          refusedBy.current = null;
                          setRefusal(null);
                          setDragging(row);
                        }}
                        onDragEnd={() => {
                          // Let go over a column no transition reaches: the card never left, and the board says why
                          if (refusedBy.current)
                            setRefusal(\`No transition takes a card from \${row.${groupBy}} to \${refusedBy.current}.\`);
                          refusedBy.current = null;
                          setDragging(null);
                        }}
                        onClick={() => ${target.navigateTo(page.path, `text(row.${pk})`)}}
                        className="cursor-grab rounded-md border border-border bg-card p-3 text-sm shadow-xs hover:bg-accent/40 active:cursor-grabbing"
                      >
                        <div className="font-medium">{${showExpr(ctx, first, "row", listIncludes, "list")} || text(row.${pk})}</div>${
                          metaExpr
                            ? `
                        <div className="mt-1 text-xs text-muted-foreground">{${metaExpr}}</div>`
                            : ""
                        }
                      </div>
                    ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}`;
}

/**
 * A section of a detail page: a list of another resource filtered by the row on the page, with the pager tables
 * use and, when the section asks for it, the resource's create form. Null when nobody may list the resource.
 */
function sectionCode(ctx: Ctx, section: SectionIR, prefix: string): { decls: string; jsx: string } | null {
  const { ir, target, page } = ctx;
  const resource = ir.resources.find(r => r.name === section.resource)!;
  const entity = entityByName(ir, resource.entity);
  const ops = resource.operations.filter(o => o.rule.kind !== "none");
  const list = ops.find(o => o.kind === "list") as ListOp | undefined;
  if (!list) return null;
  const create = section.create ? (ops.find(o => o.kind === "create") as CreateOp | undefined) : undefined;
  const S = resource.name;
  const idPk = identityKey(ir);
  const includes = list.include.map(name => entity.relations.find(r => r.name === name)!);
  const columns = section.columns.map(name => entity.columns.find(c => c.name === name)!);
  const key = entity.primaryKey.length === 1 ? entity.primaryKey[0] : null;
  const byTenant = usesContext(section.filter, "tenant");
  // Who may call the list at all; the API has the last word, so a refusal hides the section too
  const allowed = rulePredicate(list.rule, "user", null, idPk);
  // Where a row opens: the first detail page over the resource, else the first resource page's detail
  const to = key ? rowTarget(ir, p => p.resource === section.resource) : null;
  const openWhen = to ? rulePredicate(to.access, "user", null, idPk) : "false";
  const opens = to !== null && openWhen !== "false";
  const presets = presetsOf(ir, section.filter, create);
  const preset = new Set(presets.map(p => p.field));
  // Fields with a read rule: a column is there only for a viewer who could read it on some row, and an input of the
  // create form only for one who could read what it writes, as on a table page and its form
  const ruledColumn = columns.some(c => c.read);
  const createRuled = Boolean(
    create?.fields.some(f => {
      const column = entity.columns.find(c => c.name === f);
      return Boolean(column?.read && !column.sealed && !preset.has(f));
    })
  );
  if (ruledColumn || createRuled) use(ctx, "client", "fieldsOf");

  use(ctx, "react", "useState");
  use(ctx, "query", "useQuery");
  use(ctx, "client", "Inputs");
  use(ctx, "client", "SessionUser");
  use(ctx, "client", "errorStatus");
  use(ctx, "ui", "ListSkeleton");
  use(ctx, "ui", "ErrorNote");
  use(ctx, "ui", "Pagination");
  use(ctx, "ui", "text");
  for (const part of ["Table", "TableBody", "TableCell", "TableHead", "TableHeader", "TableRow"])
    shadcn(ctx, "table", part);
  if (opens) ctx.imports.router.navigate = true;
  if (byTenant) use(ctx, "tenant", "useTenant");

  const decls: string[] = [];
  if (create) {
    use(ctx, "query", "useMutation");
    use(ctx, "query", "useQueryClient");
    decls.push(
      `function canCreate${prefix}(user: SessionUser | null): boolean {\n  return ${rulePredicate(create.rule, "user", null, idPk)};\n}`
    );
    const fields = formFields(
      ctx,
      entity.columns.filter(c => create.fields.includes(c.name) && !preset.has(c.name)),
      entity,
      prefix
    );
    decls.push(
      formCode(ctx, prefix, fields, {
        createType: `Inputs[${q(S)}]["create"]`,
        createFields: fields,
        presets: [...preset],
        currentType: "never"
      })
    );
  }

  const input = [
    "page",
    `page_size: ${section.limit}`,
    ...(section.order ? [`sort: ${q(`${section.order[0]}:${section.order[1]}`)}`] : []),
    ...Object.entries(section.filter).map(([k, v]) => `${k}: ${fixedValue(v, target, "user", idPk, tenantKey(ir))}`)
  ];
  const queryOpts = `${enabledOpt(section.filter, allowed === "true" ? [] : ["allowed"])}${
    page.refresh ? `, refetchInterval: ${page.refresh * 1000}` : ""
  }`;
  const go = to && key ? target.navigateTo(to.base, `text(row.${key})`) : "";
  const rowAttrs = !opens
    ? ""
    : openWhen === "true"
      ? ` className="cursor-pointer" onClick={() => ${go}}`
      : ` className={opens ? "cursor-pointer" : undefined} onClick={opens ? () => ${go} : undefined}`;
  const heads = columns.map(c =>
    c.read
      ? `              {could.${c.name} ? <TableHead>${humanize(c.name)}</TableHead> : null}`
      : `              <TableHead>${humanize(c.name)}</TableHead>`
  );
  const cells = columns.map(c => {
    const cell = `<TableCell>{${linkedExpr(ctx, entity, c, "row", includes, "list", { inRow: opens })}}</TableCell>`;
    return c.read ? `                {could.${c.name} ? ${cell} : null}` : `                ${cell}`;
  });
  const P = prefix.toUpperCase();
  const sent = presetInput(
    presets,
    createRuled ? `sent${prefix}(to${prefix}CreateInput(values), readable)` : `to${prefix}CreateInput(values)`,
    `Inputs[${q(S)}]["create"]`
  );
  decls.push(`/** ${section.title}: the ${S} of the row on the page */
function ${prefix}Section({ id, user }: { id: ReturnType<typeof idOf>; user: SessionUser | null }) {
  const [page, setPage] = useState(1);${
    create
      ? `
  const [formKey, setFormKey] = useState(0);
  const queryClient = useQueryClient();`
      : ""
  }${opens ? `\n  ${target.navigateDecl}` : ""}${
    byTenant ? "\n  const { tenant, loading: tenantLoading } = useTenant();" : ""
  }${allowed === "true" ? "" : `\n  const allowed = ${allowed};`}${
    opens && openWhen !== "true" ? `\n  const opens = ${openWhen};` : ""
  }${
    ruledColumn || createRuled
      ? `\n  const session = ${SESSION_QUERY};\n  const could: Record<string, boolean> = fieldsOf(session.data).${S};`
      : ""
  }${createRuled ? "\n  const readable = (field: string) => could[field] === true;" : ""}
  const input = { ${input.join(", ")} } as Inputs[${q(S)}]["list"];
  const list = useQuery({ queryKey: [${q(S)}, "list", input], queryFn: () => client.${S}.list(input)${queryOpts} });${
    create
      ? `
  const createRow = useMutation({
    mutationFn: (input: Inputs[${q(S)}]["create"]) => client.${S}.create(input),
    onSuccess: async () => {
      setFormKey(current => current + 1);
      await queryClient.invalidateQueries({ queryKey: [${q(S)}] });
    }
  });`
      : ""
  }
  const status = errorStatus(list.error);
  if (${allowed === "true" ? "" : "!allowed || "}status === 401 || status === 403${byTenant ? " || (!tenantLoading && tenant === null)" : ""}) return null;
  return (
    <section className="mt-8 space-y-3">
      <h2 className="text-sm font-semibold">
        {${q(section.title)}}
        {list.data ? <span className="ml-2 font-normal text-muted-foreground">{list.data.page.total}</span> : null}
      </h2>
      {list.isPending ? (
        <ListSkeleton />
      ) : list.error ? (
        <ErrorNote error={list.error} />
      ) : list.data.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">${`No ${section.title.toLowerCase()} yet.`}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
${heads.join("\n")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.data.data.map((row${key ? "" : ", index"}) => (
              <TableRow key={${key ? `text(row.${key})` : "index"}}${rowAttrs}>
${cells.join("\n")}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {list.data ? <Pagination page={page} pageSize={${section.limit}} total={list.data.page.total} onChange={setPage} /> : null}${
        create
          ? `
      {canCreate${prefix}(user) ? (
        <${prefix}Form
          key={formKey}
          fields={${createRuled ? `offered${prefix}(${P}_CREATE, readable)` : `${P}_CREATE`}}
          initial={EMPTY_${P}}
          submitLabel="Add"
          pending={createRow.isPending}
          error={createRow.error}
          onSubmit={values => createRow.mutate(${sent})}
        />
      ) : null}`
          : ""
      }
    </section>
  );
}`);
  return {
    decls: decls.join("\n\n"),
    jsx: `      <${prefix}Section key={text(row.${ctx.pk.name})} id={id} user={user} />`
  };
}

/** generated/app/pages/<page>.tsx for a detail page: one row at an address of its own, and its sections */
export function detailPageFile(ir: IR, page: PageIR, target: WebTarget, conv: TsConventions): string {
  const resource = ir.resources.find(r => r.name === page.resource)!;
  const entity = entityByName(ir, resource.entity);
  const ops = resource.operations.filter(o => o.rule.kind !== "none");
  const get = ops.find(o => o.kind === "get") as GetOp | undefined;
  if (!get) throw new Error(`page ${page.name}: resource ${resource.name} must allow get (its read rule is none)`);
  const update = ops.find(o => o.kind === "update") as UpdateOp | undefined;
  const remove = ops.find(o => o.kind === "delete") as DeleteOp | undefined;
  const rowActions = actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none" && a.scope === "row");
  // The resource page whose detail this page takes over, when its path is that page's path plus /:id
  const listPage = page.listPage ? ir.app!.pages.find(p => p.name === page.listPage)! : null;
  const ctx: Ctx = {
    ir,
    page,
    resource,
    entity,
    target,
    conv,
    pk: singlePrimaryKey(entity),
    intKey: isIntegerKey(singlePrimaryKey(entity)),
    imports: {
      router: { params: true },
      query: new Set(["useQuery"]),
      react: new Set(),
      lucide: new Set(),
      ui: new Set(),
      shadcn: new Map(),
      client: new Set(["client", "sessionUser"]),
      tenant: new Set()
    }
  };
  const Comp = pageComponent(page);
  const R = resource.name;
  const idPk = identityKey(ir);

  const parts: string[] = [];
  parts.push(`type Detail = Outputs[${q(R)}]["get"];
${update ? `type Input<K extends keyof Inputs[${q(R)}]> = Inputs[${q(R)}][K];\n` : ""}
const KEY = [${q(R)}] as const;

function idOf(raw: string) {
  return ${ctx.intKey ? "Number(raw)" : "raw"};
}`);

  // Permissions, evaluated client-side so the page only offers what the API will allow; a condition on a field
  // with a read rule is the API's to decide, as on a resource page
  const ruledNames: ReadonlySet<string> = new Set(ruledColumns(entity).map(c => c.name));
  const perms: string[] = [];
  if (update)
    perms.push(
      `function canUpdate(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(update.rule, "user", "row", idPk, ruledNames)};\n}`
    );
  if (remove)
    perms.push(
      `function canDelete(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(remove.rule, "user", "row", idPk, ruledNames)};\n}`
    );
  for (const a of rowActions)
    perms.push(
      `function can${toPascalCase(a.name)}(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(a.rule, "user", "row", idPk, ruledNames)};\n}`
    );
  if (perms.length) {
    use(ctx, "client", "SessionUser");
    parts.push(perms.join("\n\n"));
  }
  const usesRow = perms.some(p => p.includes("row."));
  // A page that takes over a list's detail sits behind the list's gate: the IR gives it that access
  const gated = page.access.kind !== "public";
  if (gated) parts.push(gate(ctx, page.access));

  if (update) {
    use(ctx, "client", "Inputs");
    const fields = formFields(
      ctx,
      entity.columns.filter(c => update.fields.includes(c.name)),
      entity
    );
    parts.push(
      formCode(ctx, Comp, fields, { updateType: `Input<"update">["data"]`, updateFields: fields, fromRow: true })
    );
  }
  const names = new Set([Comp]);
  for (const a of rowActions.filter(a => a.input.length)) {
    use(ctx, "client", "Inputs");
    const prefix = `${Comp}${toPascalCase(a.name)}`;
    names.add(prefix);
    const fields = formFields(ctx, a.input, null);
    parts.push(
      formCode(ctx, prefix, fields, {
        createType: `Omit<Inputs[${q(R)}][${q(a.name)}], "id">`,
        createFields: fields,
        currentType: "never"
      })
    );
  }

  const sections: string[] = [];
  page.sections.forEach((section, index) => {
    const plain = `${Comp}${toPascalCase(section.resource)}`;
    const prefix = names.has(plain) ? `${plain}${index + 1}` : plain;
    names.add(prefix);
    const code = sectionCode(ctx, section, prefix);
    if (!code) return;
    parts.push(code.decls);
    sections.push(code.jsx);
  });

  parts.push(
    detailComponent(ctx, {
      name: `${Comp}Page`,
      form: Comp,
      base: listPage ? listPage.path : detailBase(page),
      routeId: detailRouteId(ir, page),
      listPath: listPage ? listPage.path : null,
      back: listPage !== null && (listPage.layout ?? "split") !== "split",
      fields: page.fields,
      get,
      update,
      remove,
      rowActions,
      queryClient: Boolean(update || remove || rowActions.length),
      usesRow,
      reverse: page.sections.length === 0,
      sections,
      refresh: page.refresh
    })
  );

  const source = `${conv.header(`The ${page.title} page: one ${entity.name} row${page.sections.length ? " and its sections" : ""}.`)}
${pageImports(ctx).join("\n")}

${parts.join("\n\n")}
`;
  return gated ? guardExports(source, [`${Comp}Page`]) : source;
}

/** generated/app/pages/<page>.tsx for a dashboard page */
export function dashboardPageFile(ir: IR, page: PageIR, target: WebTarget, conv: TsConventions): string {
  const Comp = pageComponent(page);
  const lucide = new Set<string>();
  const pageFor = (resourceName: string) =>
    ir.app!.pages.find(p => p.kind === "resource" && p.resource === resourceName);
  // The REST contract reads booleans from the query string as "true" | "false"; tRPC takes booleans
  const filterValues = (filter: Record<string, string | number | boolean>) =>
    Object.fromEntries(
      Object.entries(filter).map(([k, v]) => [k, target.kind === "next" && typeof v === "boolean" ? String(v) : v])
    );
  void filterValues;
  const idPk = ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
  const tenantPk = tenantKey(ir);
  const refetch = page.refresh ? `, refetchInterval: ${page.refresh * 1000}` : "";
  const gated = page.access.kind !== "public";
  // Where a recent row opens, and the test of who may open that page; null when it is not a link
  const rowLinks = page.recent.map(recent => {
    const entity = entityByName(ir, ir.resources.find(r => r.name === recent.resource)!.entity);
    const to = entity.primaryKey.length === 1 ? rowTarget(ir, p => p.resource === recent.resource) : null;
    const open = to ? rulePredicate(to.access, "user", null, idPk) : "false";
    return open === "false" ? null : { base: to!.base, open };
  });
  // Enum groups expand into one tile per value here; relation groups render at runtime, one tile per related row
  type Flat = TileIR & { group?: Extract<TileGroupIR, { kind: "relation" }> };
  const flat: Flat[] = page.tiles.flatMap((tile): Flat[] => {
    if (tile.groupBy?.kind === "enum") {
      const field = tile.groupBy.field;
      return tile.groupBy.values.map(v => ({
        ...tile,
        label: `${tile.label}: ${toTitleCase(v)}`,
        filter: { ...tile.filter, [field]: v },
        groupBy: undefined
      }));
    }
    if (tile.groupBy?.kind === "relation") return [{ ...tile, group: tile.groupBy, groupBy: undefined }];
    return [tile];
  });
  const hasGroup = flat.some(t => t.group);
  const needsUser =
    gated ||
    hasGroup ||
    flat.some(t => usesActor(t.filter)) ||
    page.recent.some(r => usesActor(r.filter)) ||
    rowLinks.some(l => l !== null && l.open !== "true");
  // The tenant the shell's switcher chose: queries filtered by it wait for it
  const byTenant =
    flat.some(t => usesContext(t.filter, "tenant")) || page.recent.some(r => usesContext(r.filter, "tenant"));
  const inputExpr = (tile: Flat, extra = "") => {
    const parts = [
      "page: 1",
      "page_size: 1",
      ...Object.entries(tile.filter).map(([k, v]) => `${k}: ${fixedValue(v, target, "user", idPk, tenantPk)}`)
    ];
    if (extra) parts.push(extra);
    return `{ ${parts.join(", ")} } as Inputs[${q(tile.resource)}]["list"]`;
  };
  const tileOpts = (tile: Flat) => `${refetch}${enabledOpt(tile.filter)}`;
  const tileDecls = flat
    .map((tile, i) =>
      tile.group
        ? ""
        : `  const tile${i}Input = ${inputExpr(tile)};\n  const tile${i} = useQuery({ queryKey: [${q(tile.resource)}, "list", tile${i}Input], queryFn: () => client.${tile.resource}.list(tile${i}Input)${tileOpts(tile)} });`
    )
    .filter(Boolean);
  const iconJsx = (tile: Flat) => {
    const icon = tile.icon ? iconExport(tile.icon) : null;
    if (icon) lucide.add(icon);
    return icon ? ` icon={<${icon} className="size-4 text-muted-foreground" />}` : "";
  };
  const wrapLink = (tile: Flat, body: string) => {
    const link = pageFor(tile.resource);
    return link
      ? `        <Link ${target.linkAttrs(link.path)} className="block">\n          ${body}\n        </Link>`
      : `        ${body}`;
  };
  const tileJsx = flat.map((tile, i) =>
    tile.group
      ? `        <GroupTiles${i} user={user} />`
      : wrapLink(tile, `<Tile label=${q(tile.label)} value={tile${i}.data?.page.total ?? null}${iconJsx(tile)} />`)
  );
  const groupComponents = flat
    .map((tile, i) => {
      if (!tile.group) return "";
      const g = tile.group;
      return `/** One tile per ${g.entity}, counting ${tile.resource} by ${g.field} */
function GroupTiles${i}({ user }: { user: SessionUser | null }) {
  const rows = useQuery({ queryKey: [${q(g.resource)}, "list", { page: 1, page_size: 200 }], queryFn: () => client.${g.resource}.list({ page: 1, page_size: 200 } as Inputs[${q(g.resource)}]["list"])${refetch} });
  if (rows.isPending) return <Skeleton className="h-24 w-full" />;
  if (rows.error) return <ErrorNote error={rows.error} />;
  return (
    <>
      {rows.data.data.map(row => (
        <GroupTile${i} key={text(row.${g.key})} id={row.${g.key}} label={text(row.${g.display})} user={user} />
      ))}
    </>
  );
}

function GroupTile${i}({ id, label, user }: { id: Outputs[${q(g.resource)}]["list"]["data"][number][${q(g.key)}]; label: string; user: SessionUser | null }) {
  void user;${usesContext(tile.filter, "tenant") ? "\n  const { tenant } = useTenant();" : ""}
  const input = ${inputExpr(tile, `${g.field}: id`)};
  const count = useQuery({ queryKey: [${q(tile.resource)}, "list", input], queryFn: () => client.${tile.resource}.list(input)${tileOpts(tile)} });
  return (
${wrapLink(tile, `<Tile label={${JSON.stringify(`${tile.label}: `)} + label} value={count.data?.page.total ?? null}${iconJsx(tile)} />`)}
  );
}`;
    })
    .filter(Boolean);
  const recentDecls = page.recent.map((recent, i) => {
    const input = { page: 1, page_size: recent.limit };
    if (!Object.keys(recent.filter).length)
      return `  const recent${i} = useQuery({ queryKey: [${q(recent.resource)}, "list", ${JSON.stringify(input)}], queryFn: () => client.${recent.resource}.list(${JSON.stringify(input)} as Inputs[${q(recent.resource)}]["list"])${refetch} });`;
    const fixed = Object.entries(recent.filter).map(
      ([k, v]) => `${k}: ${fixedValue(v, target, "user", idPk, tenantPk)}`
    );
    return `  const recent${i}Input = { page: 1, page_size: ${recent.limit}, ${fixed.join(", ")} } as Inputs[${q(recent.resource)}]["list"];
  const recent${i} = useQuery({ queryKey: [${q(recent.resource)}, "list", recent${i}Input], queryFn: () => client.${recent.resource}.list(recent${i}Input)${refetch}${enabledOpt(recent.filter)} });`;
  });
  const recentJsx = page.recent.map((recent, i) => {
    const resource = ir.resources.find(r => r.name === recent.resource)!;
    const entity = entityByName(ir, resource.entity);
    const link = rowLinks[i];
    const pk = entity.primaryKey[0];
    const label = `{text(row.${entity.display}) || text(row.${pk})}`;
    const anchor = link
      ? `<Link ${target.linkAttrs(link.base, `text(row.${pk})`)} className="hover:underline">${label}</Link>`
      : "";
    // A row links to its page only for a viewer who may open that page
    const item = !link
      ? `<span>${label}</span>`
      : link.open === "true"
        ? anchor
        : `{${link.open} ? ${anchor} : <span>${label}</span>}`;
    return `        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent ${toTitleCase(recent.resource).toLowerCase()}</CardTitle>
          </CardHeader>
          <CardContent>
            {recent${i}.isPending ? (
              <Skeleton className="h-16 w-full" />
            ) : recent${i}.error ? (
              <ErrorNote error={recent${i}.error} />
            ) : recent${i}.data.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recent${i}.data.data.map(row => (
                  <li key={text(row.${pk})} className="flex items-center justify-between gap-3">
                    ${item}
                    ${entity.columns.some(c => c.name === "created_at") ? `<span className="text-xs text-muted-foreground">{formatDateTime(row.created_at)}</span>` : ""}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>`;
  });
  const needsLink = gated || page.tiles.some(t => pageFor(t.resource)) || rowLinks.some(l => l !== null);
  const userDecl = !needsUser
    ? ""
    : ir.auth
      ? `  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  void user;`
      : `  const user: SessionUser | null = null;
  void user;`;
  const tilesBlock = page.tiles.length
    ? `<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">\n${tileJsx.join("\n")}\n      </div>`
    : "";
  const recentBlock = page.recent.length
    ? `<div className="grid gap-4 lg:grid-cols-2">\n${recentJsx.join("\n")}\n      </div>`
    : "";
  const blocks = [tilesBlock, recentBlock];
  // A user in no tenant sees the empty state in place of the tiles and lists, which would wait forever
  const deeper = (jsx: string[]) =>
    jsx
      .filter(Boolean)
      .flatMap(block => `      ${block}`.split("\n"))
      .map(line => (line ? `    ${line}` : line))
      .join("\n");
  const clientImports = [
    "client",
    ...(needsUser && ir.auth ? ["sessionUser"] : []),
    "type Inputs",
    ...(hasGroup ? ["type Outputs"] : []),
    ...(needsUser ? ["type SessionUser"] : [])
  ];
  const source = `${conv.header(`The ${page.title} dashboard: counts and recent rows.`)}
"use client";
import { useQuery } from "@tanstack/react-query";
${target.routerImports({ link: needsLink }).join("\n")}
${lucide.size ? `import { ${[...lucide].sort().join(", ")} } from "lucide-react";` : ""}${gated ? `\nimport type { ReactNode } from "react";\nimport { buttonVariants } from "@/components/ui/button";` : ""}
import { Card, CardContent, ${gated ? "CardDescription, " : ""}CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ${clientImports.join(", ")} } from "../client";${byTenant ? `\nimport { NoTenant, useTenant } from "../tenant";` : ""}
import { ErrorNote, ${gated ? "PaneSkeleton, " : ""}Tile, formatDateTime, text } from "../ui";
${gated ? `\n${accessGateDecl(page.access, target, idPk)}\n` : ""}${groupComponents.length ? `\n${groupComponents.join("\n\n")}\n` : ""}
export function ${Comp}Page() {
${userDecl}${byTenant ? "\n  const { tenant, loading: tenantLoading } = useTenant();" : ""}
${tileDecls.join("\n")}
${recentDecls.join("\n")}
  void formatDateTime;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">${page.title}</h1>
      ${byTenant ? `{!tenantLoading && tenant === null ? (\n        <NoTenant />\n      ) : (\n        <>\n${deeper(blocks)}\n        </>\n      )}` : blocks.join("\n      ")}
    </div>
  );
}
`;
  return gated ? guardExports(source, [`${Comp}Page`]) : source;
}

type FilterContext = "actor" | "row" | "tenant";
type Filter = Record<string, PageFilterValue> | undefined;

/** The context a filter value reads (the signed-in user, the row on the page, the chosen tenant), when it is not a literal */
function contextOf(value: PageFilterValue): FilterContext | null {
  if (typeof value !== "object") return null;
  return "actor" in value ? "actor" : "row" in value ? "row" : "tenant";
}

/** Whether a filter reads a context, so its query waits for it */
function usesContext(filter: Filter, context: FilterContext): boolean {
  return Object.values(filter ?? {}).some(v => contextOf(v) === context);
}

function usesActor(filter: Filter): boolean {
  return usesContext(filter, "actor");
}

/**
 * The expression of a fixed filter value in the list input: the user's key, the key of the row on the page (`id`
 * in a section), the chosen tenant's key, or the literal. The REST contract reads booleans as "true" | "false".
 */
function fixedValue(
  value: PageFilterValue,
  target: WebTarget,
  userExpr: string,
  idPk: string,
  tenantPk = "id"
): string {
  switch (contextOf(value)) {
    case "actor":
      return `${userExpr}?.${idPk} ?? ""`;
    case "row":
      return "id";
    case "tenant":
      return `tenant?.${tenantPk} ?? ""`;
  }
  if (target.kind === "next" && typeof value === "boolean") return JSON.stringify(String(value));
  return JSON.stringify(value);
}

/** `, enabled: ...` for a query whose filter waits for the session or the tenant */
function enabledOpt(filter: Filter, more: string[] = []): string {
  const waits = [
    ...more,
    ...(usesContext(filter, "actor") ? ["user !== null"] : []),
    ...(usesContext(filter, "tenant") ? ["tenant !== null"] : [])
  ];
  return waits.length ? `, enabled: ${waits.join(" && ")}` : "";
}

/**
 * The "Show archived" toggle of a page over an archiving entity: its state, what it adds to the list input and its
 * button. Null when the entity does not archive, or when the page's fixed filter already says which rows it shows.
 */
function archiveToggle(ctx: Ctx, paged: boolean): { decl: string; spread: string; button: string } | null {
  if (!ctx.entity.archive || (ctx.page.filter && "archived" in ctx.page.filter)) return null;
  shadcn(ctx, "button", "Button");
  // The REST contract reads booleans from the query string as "true" | "false"; tRPC takes booleans
  const yes = ctx.target.kind === "next" ? `"true" as const` : "true";
  return {
    decl: "\n  const [archived, setArchived] = useState(false);",
    spread: `, ...(archived ? { archived: ${yes} } : {})`,
    button: `<Button
            variant={archived ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={archived}
            onClick={() => {
              setArchived(current => !current);${paged ? "\n              setPage(1);" : ""}
            }}
          >
            {archived ? "Showing archived" : "Show archived"}
          </Button>`
  };
}

/** The class a list row takes when it is archived: muted, so the archived rows read as out of the way */
function archivedClass(ctx: Ctx, row: string): string | null {
  return ctx.entity.archive ? `${row}.${ctx.entity.archive.column} && "text-muted-foreground"` : null;
}

/** The list query options a page adds: a refetch interval, and waiting for what its filter reads */
function listQueryOptions(page: PageIR): { queryOpts: string; fixedSpread: string } {
  const queryOpts = `${page.refresh ? `, refetchInterval: ${page.refresh * 1000}` : ""}${enabledOpt(page.filter)}`;
  const args = usesContext(page.filter, "tenant") ? "user, tenant" : "user";
  return { queryOpts, fixedSpread: page.filter ? `, ...fixedFilter(${args})` : "" };
}

/** `function fixedFilter(user)` for a page's fixed filter; it takes the tenant too when the filter reads it */
function fixedFilterDecl(
  filter: Record<string, PageFilterValue>,
  target: WebTarget,
  idPk: string,
  tenantPk: string
): string {
  const entries = Object.entries(filter).map(([k, v]) => `${k}: ${fixedValue(v, target, "user", idPk, tenantPk)}`);
  const byTenant = usesContext(filter, "tenant");
  return `/** Filters this page always applies */
function fixedFilter(user: SessionUser | null${byTenant ? ", tenant: Tenant | null" : ""}) {
  void user;
  return { ${entries.join(", ")} };
}`;
}

/**
 * What a list filtered by the tenant context adds to its component: the hook, and the empty state shown in the
 * list's place to a user who is in no tenant (the query waits for a tenant, so it would stay pending).
 */
function tenantScope(ctx: Ctx, filter: Filter): { decl: string; none: (indent: string) => string } {
  if (!usesContext(filter, "tenant")) return { decl: "", none: () => "" };
  use(ctx, "tenant", "useTenant");
  use(ctx, "tenant", "NoTenant");
  return {
    decl: "\n  const { tenant, loading: tenantLoading } = useTenant();",
    none: indent => `!tenantLoading && tenant === null ? (\n${indent}  <NoTenant />\n${indent}) : `
  };
}

interface Preset {
  field: string;
  context: FilterContext;
  /** The expression sent for the field */
  value: string;
}

/**
 * The create fields a filtered list presets: the context values of its filter (the row, the tenant, the user)
 * are sent with a create opened from it, and their fields leave the form. Literal filters preset nothing.
 */
function presetsOf(ir: IR, filter: Filter, create: CreateOp | undefined): Preset[] {
  if (!create) return [];
  return Object.entries(filter ?? {}).flatMap(([field, v]): Preset[] => {
    const context = contextOf(v);
    if (!context || !create.fields.includes(field)) return [];
    const value =
      context === "row" ? "id" : context === "tenant" ? `tenant?.${tenantKey(ir)}` : `user?.${identityKey(ir)}`;
    return [{ field, context, value }];
  });
}

/** The create input a form with presets sends: the form's values and the preset fields */
function presetInput(presets: Preset[], formInput: string, inputType: string): string {
  if (!presets.length) return formInput;
  return `{ ...${formInput}, ${presets.map(p => `${p.field}: ${p.value}`).join(", ")} } as ${inputType}`;
}

/**
 * The access gate of a page whose access is not public: `canOpen`, the gate card, and `guarded`, which wraps a
 * page component so it waits for the session and then renders the page or the gate.
 */
function accessGateDecl(access: RuleIR, target: WebTarget, idPk: string): string {
  return `/** Who may open this page */
function canOpen(user: SessionUser | null): boolean {
  return ${rulePredicate(access, "user", null, idPk)};
}

function AccessGate({ user }: { user: SessionUser | null }) {
  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>{user ? "No access" : "Sign in required"}</CardTitle>
          <CardDescription>{user ? "Your account cannot open this page." : "Sign in to open this page."}</CardDescription>
        </CardHeader>
        {user ? null : (
          <CardContent>
            <Link ${target.linkAttrs("/login")} className={buttonVariants()}>
              Sign in
            </Link>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

/** Waits for the session, then renders the page or the gate */
function guarded<P extends object>(Component: (props: P) => ReactNode) {
  return function Guarded(props: P) {
    const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
    if (session.isPending) return <PaneSkeleton />;
    const user = sessionUser(session.data);
    if (!canOpen(user)) return <AccessGate user={user} />;
    return <Component {...props} />;
  };
}`;
}

/** Rename the exported page components to inner ones and export guarded versions */
function guardExports(source: string, names: string[]): string {
  let out = source;
  const exported: string[] = [];
  for (const name of names) {
    const pattern = new RegExp(`export function ${name}\\(`);
    if (!pattern.test(out)) continue;
    out = out.replace(pattern, `function ${name}Inner(`);
    exported.push(`export const ${name} = guarded(${name}Inner);`);
  }
  return `${out.trimEnd()}\n\n${exported.join("\n")}\n`;
}

/** lucide icon name in kebab-case to its PascalCase export: file-text -> FileText */
export function iconExport(kebab: string): string {
  return kebab
    .split("-")
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

/** "an article" / "a task" */
function article(noun: string): string {
  const lower = noun.toLowerCase();
  return `${/^[aeiou]/.test(lower) ? "an" : "a"} ${lower}`;
}

export type { ActionIR };
