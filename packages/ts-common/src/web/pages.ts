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
  TileGroupIR,
  TileIR
} from "@osl/core";
import { actionsOf, toPascalCase, toTitleCase } from "@osl/core";
import { entityByName, q, singlePrimaryKey, type TsConventions } from "../conventions.js";
import { pageComponent } from "./routes.js";
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
  };
}

function use(ctx: Ctx, group: "query" | "react" | "lucide" | "ui" | "client", name: string): void {
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

function entityTitle(entity: EntityIR): string {
  return toTitleCase(entity.name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase());
}

function isIntegerKey(column: ColumnIR): boolean {
  return column.type.kind === "scalar" && (column.type.scalar === "integer" || column.type.scalar === "bigint");
}

/** A client-side predicate for a rule, over the signed-in user and (for row rules) the row */
export function rulePredicate(rule: RuleIR, user: string, row: string | null, identityPkName: string): string {
  const base = basePredicate(rule, user, row, identityPkName);
  if (rule.kind === "any" || rule.kind === "none" || !rule.when || !row) return base;
  // The condition is on the row the page shows; values compare as text, null only to null
  const col = `${row}.${rule.when.column}`;
  const test =
    rule.when.value === null
      ? `${col} ${rule.when.op === "eq" ? "==" : "!="} null`
      : `String(${col}) ${rule.when.op === "eq" ? "===" : "!=="} ${JSON.stringify(String(rule.when.value))}`;
  return `(${base} && ${test})`;
}

function basePredicate(rule: RuleIR, user: string, row: string | null, identityPkName: string): string {
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
    case "any":
      return `(${rule.rules.map(r => rulePredicate(r, user, row, identityPkName)).join(" || ")})`;
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
    default:
      use(ctx, "ui", "text");
      return `text(${expr})`;
  }
}

/** JSX for one field of the detail pane */
function detailRow(ctx: Ctx, col: ColumnIR, includes: RelationIR[]): string {
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
  return `        <FieldRow label=${label}>{${showExpr(ctx, col, "row", includes, "detail")} || "—"}</FieldRow>`;
}

/** Rows for relations the get operation includes that are not a column of the entity (reverse sides) */
function reverseRows(ctx: Ctx, includes: RelationIR[]): string[] {
  const out: string[] = [];
  for (const rel of includes.filter(r => r.direction === "reverse")) {
    const target = entityByName(ctx.ir, rel.target);
    use(ctx, "ui", "FieldRow");
    use(ctx, "ui", "text");
    if (rel.kind === "many") {
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

interface FormField {
  col: ColumnIR;
  /** TypeScript type of the form value */
  valueType: string;
  initial: string;
  /** A resource over the relation target, when the field picks a related row */
  picker?: { resource: ResourceIR; target: EntityIR };
}

function formFields(ctx: Ctx, columns: ColumnIR[], entity: EntityIR | null): FormField[] {
  return columns.map(col => {
    const name = col.name;
    const kind = scalar(col);
    let valueType = "string";
    let initial = '""';
    if (kind === "boolean") {
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
    return { col, valueType, initial, picker };
  });
}

/** The expression turning a form value into the API input for a column */
function convert(field: FormField, mode: "create" | "update"): string {
  const col = field.col;
  const v = `v.${col.name}`;
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
function fromRowExpr(ctx: Ctx, field: FormField): string {
  const col = field.col;
  const expr = `row.${col.name}`;
  switch (scalar(col)) {
    case "boolean":
      return `${expr} ?? false`;
    case "enum":
      return col.nullable ? `${expr} ?? ""` : expr;
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

function inputControl(ctx: Ctx, field: FormField, required: boolean, valuesType: string): string {
  const col = field.col;
  const name = col.name;
  const label = q(humanize(name));
  const req = required ? " required" : "";
  const kind = scalar(col);
  if (field.picker) {
    use(ctx, "ui", "FormRow");
    return `      <FormRow label=${label} htmlFor=${q(name)}>
        <${pickerName(field)} id=${q(name)} value={values.${name}} onChange={value => set(${q(name)}, value)} allowEmpty={${!required}} />
      </FormRow>`;
  }
  if (kind === "boolean") {
    shadcn(ctx, "checkbox", "Checkbox");
    shadcn(ctx, "label", "Label");
    return `      <div className="flex items-center gap-2">
        <Checkbox id=${q(name)} checked={values.${name}} onCheckedChange={checked => set(${q(name)}, checked)} />
        <Label htmlFor=${q(name)}>${humanize(name)}</Label>
      </div>`;
  }
  use(ctx, "ui", "FormRow");
  if (kind === "file") {
    use(ctx, "ui", "FileInput");
    const t = col.type as { kind: "file"; accept?: string[] };
    const accept = t.accept ? ` accept=${q(t.accept.join(","))}` : "";
    return `      <FormRow label=${label} htmlFor=${q(name)}>
        <FileInput id=${q(name)} value={values.${name}} current={current?.${name}}${accept} onChange={fileId => set(${q(name)}, fileId)} />
      </FormRow>`;
  }
  if (kind === "enum") {
    use(ctx, "ui", "selectClass");
    const options = enumValues(ctx, col).map(v => `          <option value=${q(v)}>${v}</option>`);
    if (col.nullable) options.unshift(`          <option value="">—</option>`);
    return `      <FormRow label=${label} htmlFor=${q(name)}>
        <select id=${q(name)} className={selectClass} value={values.${name}} onChange={e => set(${q(name)}, e.target.value as ${valuesType}[${q(name)}])}>
${options.join("\n")}
        </select>
      </FormRow>`;
  }
  if (kind === "text" || kind === "json") {
    shadcn(ctx, "textarea", "Textarea");
    const extra = kind === "json" ? ' className="font-mono text-xs" rows={6}' : " rows={4}";
    return `      <FormRow label=${label} htmlFor=${q(name)}>
        <Textarea id=${q(name)}${extra} value={values.${name}} onChange={e => set(${q(name)}, e.target.value)}${req} />
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
  return `      <FormRow label=${label} htmlFor=${q(name)}>
        <Input id=${q(name)} type=${q(type)}${extra} value={values.${name}} onChange={e => set(${q(name)}, e.target.value)}${req} />
      </FormRow>`;
}

function pickerName(field: FormField): string {
  return `${field.col.name.replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase())}Picker`;
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
  }
): string {
  use(ctx, "react", "FormEvent");
  use(ctx, "react", "Fragment");
  use(ctx, "react", "useState");
  use(ctx, "ui", "ErrorNote");
  use(ctx, "ui", "splitList");
  shadcn(ctx, "button", "Button");
  const ValuesT = `${prefix}Values`;
  const valuesType = fields.map(f => `  ${f.col.name}: ${f.valueType};`).join("\n");
  const empty = fields.map(f => `  ${f.col.name}: ${f.initial}`).join(",\n");
  const requiredOnCreate = (f: FormField) => !f.col.nullable && f.col.default === undefined && !f.col.generated;
  const cases = fields
    .map(
      f => `    case ${q(f.col.name)}:
      return (
${inputControl(ctx, f, options.createType ? requiredOnCreate(f) : !f.col.nullable, ValuesT)}
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
  if (options.createType && options.createFields)
    parts.push(`const ${prefix.toUpperCase()}_CREATE: readonly ${prefix}Field[] = [${options.createFields.map(f => q(f.col.name)).join(", ")}];

function to${prefix}CreateInput(v: ${ValuesT}): ${options.createType} {
  return {
${options.createFields.map(f => `    ${f.col.name}: ${convert(f, "create")}`).join(",\n")}
  };
}`);
  if (options.updateType && options.updateFields)
    parts.push(`const ${prefix.toUpperCase()}_UPDATE: readonly ${prefix}Field[] = [${options.updateFields.map(f => q(f.col.name)).join(", ")}];

function to${prefix}UpdateInput(v: ${ValuesT}): ${options.updateType} {
  return {
${options.updateFields.map(f => `    ${f.col.name}: ${convert(f, "update")}`).join(",\n")}
  };
}`);
  if (options.fromRow)
    parts.push(`function ${prefix.charAt(0).toLowerCase()}${prefix.slice(1)}FromRow(row: Detail): ${ValuesT} {
  return {
${fields.map(f => `    ${f.col.name}: ${fromRowExpr(ctx, f)}`).join(",\n")}
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
  const entries = list.filters.map(f => {
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
    stateType: `{ ${list.filters.map(f => `${f}?: string`).join("; ")} }`,
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
  const update = ops.find(o => o.kind === "update") as UpdateOp | undefined;
  const remove = ops.find(o => o.kind === "delete") as DeleteOp | undefined;
  const rowActions = actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none" && a.scope === "row");
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
      router: { link: true, params: true, outlet: target.kind === "tanstack" },
      query: new Set(["useQuery"]),
      react: new Set(["useState"]),
      lucide: new Set(),
      ui: new Set(),
      shadcn: new Map(),
      client: new Set(["client", "sessionUser", "Inputs"])
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
  const idPk = ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id";
  const mutations = Boolean(create || update || remove || rowActions.length || collectionActions.length);
  if (mutations) {
    use(ctx, "query", "useMutation");
    use(ctx, "query", "useQueryClient");
  }
  if (create || remove || layout !== "split") ctx.imports.router.navigate = true;
  if (layout === "split") ctx.imports.router.pathname = true;

  const columns = page.columns.map(name => entity.columns.find(c => c.name === name)!);
  const [first, ...rest] = columns;
  const metaExpr = rest.length
    ? `[${rest.map(c => showExpr(ctx, c, "row", listIncludes, "list")).join(", ")}].filter(Boolean).join(" · ")`
    : null;
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
      `function canUpdate(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(update.rule, "user", "row", idPk)};\n}`
    );
  if (remove)
    perms.push(
      `function canDelete(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(remove.rule, "user", "row", idPk)};\n}`
    );
  for (const a of rowActions)
    perms.push(
      `function can${toPascalCase(a.name)}(user: SessionUser | null, row: Detail): boolean {\n  return ${rulePredicate(a.rule, "user", "row", idPk)};\n}`
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
    sections.push(fixedFilterDecl(page.filter, target, idPk));
  }
  const gated = page.access.kind !== "public";
  if (gated) {
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
    sections.push(accessGateDecl(page.access, target, idPk));
  }

  // The row form
  if (create || update) {
    use(ctx, "client", "Inputs");
    const names = entity.columns.map(c => c.name).filter(n => create?.fields.includes(n) || update?.fields.includes(n));
    const fields = formFields(
      ctx,
      names.map(n => entity.columns.find(c => c.name === n)!),
      entity
    );
    sections.push(
      formCode(ctx, Comp, fields, {
        createType: create ? `Input<"create">` : undefined,
        createFields: create ? fields.filter(f => create.fields.includes(f.col.name)) : undefined,
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
  const sessionQuery = `useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() })`;
  const { queryOpts, fixedSpread } = listQueryOptions(page);
  const listQueryDecl = (inputExpr: string) =>
    `useQuery({ queryKey: [...KEY, "list", ${inputExpr}], queryFn: () => client.${R}.list(${inputExpr})${queryOpts} })`;
  const detailLink = (idExpr: string) => linkAttrs(page.path, idExpr);

  if (layout === "split") {
    use(ctx, "ui", "ListSkeleton");
    use(ctx, "ui", "Pagination");
    sections.push(`export function ${Comp}Layout(${target.layoutProps}) {
  const [page, setPage] = useState(1);
  const [openAction, setOpenAction] = useState<string | null>(null);
  void openAction;
  void setOpenAction;
  const session = ${sessionQuery};
  const user = sessionUser(session.data);
  void user;
  const input = { page, page_size: PAGE_SIZE${fixedSpread} } as Inputs[${q(R)}]["list"];
  const list = ${listQueryDecl("input")};
  ${target.activeDecl}${mutations ? "\n  const queryClient = useQueryClient();" : ""}
${collectionActionDecls.join("\n")}
  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border">
        <PaneHeader title=${q(title)} count={list.data?.page.total}>
          ${headerExtras}
        </PaneHeader>
${collectionActionForms.join("\n")}
${collectionErrors.join("\n")}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isPending ? (
            <ListSkeleton />
          ) : list.error ? (
            <ErrorNote error={list.error} className="m-4" />
          ) : list.data.data.length === 0 ? (
            <EmptyPane>No ${title.toLowerCase()} yet.</EmptyPane>
          ) : (
            <ul className="py-1">
              {list.data.data.map((row: Row) => (
                <li key={text(row.${pk})}>
                  <Link
                    ${detailLink(`text(row.${pk})`)}
                    className={cn("block border-l-2 border-transparent px-4 py-2 hover:bg-accent/60", ${target.isActive(page.path, `text(row.${pk})`)} && "border-primary bg-accent")}
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
        boardIndex(ctx, list, update!, headerExtras, collectionActionDecls, collectionActionForms, collectionErrors)
      );
  }

  if (create) {
    use(ctx, "ui", "Pane");
    const back = layout === "split" ? "" : backLink(ctx);
    sections.push(`export function ${Comp}New() {
  ${target.navigateDecl}
  const queryClient = useQueryClient();
  const createRow = useMutation({
    mutationFn: (input: Input<"create">) => client.${R}.create(input),
    onSuccess: async row => {
      await queryClient.invalidateQueries({ queryKey: KEY });
      await ${target.navigateTo(page.path, `text(row.${pk})`)};
    }
  });
  return (
    <Pane title=${q(`New ${one.toLowerCase()}`)}${back ? ` actions={${back}}` : ""}>
      <${Comp}Form
        fields={${Comp.toUpperCase()}_CREATE}
        initial={EMPTY_${Comp.toUpperCase()}}
        submitLabel="Create"
        pending={createRow.isPending}
        error={createRow.error}
        onSubmit={values => createRow.mutate(to${Comp}CreateInput(values))}
      />
    </Pane>
  );
}`);
  }

  // Detail
  use(ctx, "ui", "Pane");
  use(ctx, "ui", "PaneSkeleton");
  const detailFields = page.fields.map(name => entity.columns.find(c => c.name === name)!);
  const rows = [...detailFields.map(c => detailRow(ctx, c, getIncludes)), ...reverseRows(ctx, getIncludes)];
  const actions: string[] = [];
  if (layout !== "split") actions.push(`          ${backLink(ctx)}`);
  for (const a of rowActions) {
    shadcn(ctx, "button", "Button");
    const Pascal = toPascalCase(a.name);
    actions.push(
      a.input.length
        ? `          {can${Pascal}(user, row) ? (
            <Button variant="outline" size="sm" onClick={() => setOpenAction(open => (open === ${q(a.name)} ? null : ${q(a.name)}))}>
              ${toTitleCase(a.name)}
            </Button>
          ) : null}`
        : `          {can${Pascal}(user, row) ? (
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
  if (update || rowActions.length) use(ctx, "react", "useEffect");
  const rowActionDecls = rowActions.map(
    a => `  const ${a.name}Action = useMutation({
    mutationFn: (input: Inputs[${q(R)}][${q(a.name)}]) => client.${R}.${a.name}(input),
    onSuccess: async () => {
      setOpenAction(null);
      await queryClient.invalidateQueries({ queryKey: KEY });
    }
  });`
  );
  if (rowActions.length) use(ctx, "client", "Inputs");
  const rowActionForms = rowActions
    .filter(a => a.input.length)
    .map(a => {
      const prefix = `${Comp}${toPascalCase(a.name)}`;
      return `      {openAction === ${q(a.name)} ? (
        <div className="mb-6 rounded-md border border-border p-4">
          <${prefix}Form fields={${prefix.toUpperCase()}_CREATE} initial={EMPTY_${prefix.toUpperCase()}} submitLabel=${q(toTitleCase(a.name))} pending={${a.name}Action.isPending} error={${a.name}Action.error} onCancel={() => setOpenAction(null)} onSubmit={values => ${a.name}Action.mutate({ id, ...to${prefix}CreateInput(values) })} />
        </div>
      ) : null}`;
    });
  const rowActionErrors = rowActions
    .filter(a => !a.input.length)
    .map(a => `      <ErrorNote error={${a.name}Action.error} className="mb-4" />`);
  const detailBody = update
    ? `      {editing ? (
        <${Comp}Form
          fields={${Comp.toUpperCase()}_UPDATE}
          initial={${Comp.charAt(0).toLowerCase()}${Comp.slice(1)}FromRow(row)}${entity.columns.some(c => c.type.kind === "file" && update.fields.includes(c.name)) ? "\n          current={row}" : ""}
          submitLabel="Save"
          pending={updateRow.isPending}
          error={updateRow.error}
          onCancel={() => setEditing(false)}
          onSubmit={values => updateRow.mutate({ id, data: to${Comp}UpdateInput(values) })}
        />
      ) : (
        <dl className="grid gap-3">
${rows.join("\n")}
        </dl>
      )}`
    : `      <dl className="grid gap-3">
${rows.join("\n")}
      </dl>`;
  sections.push(`export function ${Comp}Detail() {
  ${target.useIdParam(page.path)}
  const id = idOf(rawId);${remove ? `\n  ${target.navigateDecl}` : ""}${
    mutations
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
  const query = useQuery({ queryKey: [...KEY, "get", id], queryFn: () => client.${R}.get({ id }) });
  const session = ${sessionQuery};
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
      await ${target.navigateTo(page.path)};
    }
  });`
      : ""
  }
${rowActionDecls.join("\n")}
  if (query.isPending) return <PaneSkeleton />;
  if (query.error) return <ErrorNote error={query.error} className="m-6" />;
  const row: Detail = query.data;${usesRow ? "" : "\n  void row;"}
  return (
    <Pane
      title={${showExpr(ctx, entity.columns.find(c => c.name === entity.display)!, "row", getIncludes, "detail")} || ${q(`${one} `)} + text(row.${pk})}${
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
${detailBody}
    </Pane>
  );
}`);
  if (update || remove) use(ctx, "client", "Inputs");
  if (!mutations) {
    // nothing extra
  }

  // Imports
  const imports: string[] = ['"use client";'];
  imports.push(`import { ${[...ctx.imports.query].sort().join(", ")} } from "@tanstack/react-query";`);
  imports.push(...target.routerImports(ctx.imports.router));
  if (ctx.imports.lucide.size)
    imports.push(`import { ${[...ctx.imports.lucide].sort().join(", ")} } from "lucide-react";`);
  const react = [...ctx.imports.react].sort();
  const reactValues = react.filter(n => n !== "FormEvent" && n !== "ReactNode");
  const reactTypes = react.filter(n => n === "FormEvent" || n === "ReactNode");
  imports.push(`import { ${[...reactValues, ...reactTypes.map(t => `type ${t}`)].join(", ")} } from "react";`);
  for (const [file, names] of [...ctx.imports.shadcn.entries()].sort(([a], [b]) => a.localeCompare(b)))
    imports.push(`import { ${[...names].sort().join(", ")} } from "@/components/ui/${file}";`);
  if (ctx.imports.ui.has("cn")) {
    ctx.imports.ui.delete("cn");
    imports.push(`import { cn } from "@/lib/utils";`);
  }
  const clientNames = [...ctx.imports.client].sort();
  const clientValues = clientNames.filter(n => !["Inputs", "Outputs", "SessionUser"].includes(n));
  const clientTypes = ["Inputs", "Outputs", "SessionUser"].filter(n => clientNames.includes(n) || n === "Outputs");
  imports.push(
    `import { ${clientValues.join(", ")}, ${clientTypes.map(t => `type ${t}`).join(", ")} } from "../client";`
  );
  imports.push(`import { ${[...ctx.imports.ui].sort().join(", ")} } from "../ui";`);

  const body = sections.join("\n\n");
  const source = `${conv.header(`The ${title} page: ${layout === "split" ? "a master list" : layout === "table" ? "a table" : "a board"} of ${entity.name} rows and a detail pane for the selected one.`)}
${imports.join("\n")}

${body}
`;
  return gated ? guardExports(source, [`${Comp}Layout`, `${Comp}Index`, `${Comp}New`, `${Comp}Detail`]) : source;
}

function backLink(ctx: Ctx): string {
  use(ctx, "lucide", "ArrowLeft");
  shadcn(ctx, "button", "buttonVariants");
  return `<Link ${ctx.target.linkAttrs(ctx.page.path)} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Back">
            <ArrowLeft />
          </Link>`;
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
  const { queryOpts } = listQueryOptions(page);
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
      : `                <TableHead>${humanize(c.name)}</TableHead>`
  );
  const cells = columns.map(
    c => `                  <TableCell>{${showExpr(ctx, c, "row", listIncludes, "list")}}</TableCell>`
  );
  return `export function ${Comp}Index() {
  const [page, setPage] = useState(1);
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
  void user;
  const input = {
    page,
    page_size: PAGE_SIZE${list.sortable.length ? ",\n    sort" : ""}${list.search.length ? ",\n    q: q || undefined" : ""}${filters.toInput ? `,\n    ${filters.toInput}` : ""}${page.filter ? ",\n    ...fixedFilter(user)" : ""}
  } as Inputs[${q(R)}]["list"];
  const list = useQuery({ queryKey: [...KEY, "list", input], queryFn: () => client.${R}.list(input)${queryOpts} });
  ${target.navigateDecl}${mutations ? "\n  const queryClient = useQueryClient();" : ""}
${actionDecls.join("\n")}
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PaneHeader title=${q(page.title)} count={list.data?.page.total}>
          ${headerExtras}
      </PaneHeader>
${actionForms.join("\n")}
${actionErrors.join("\n")}
      ${
        list.search.length || list.filters.length
          ? `<div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
${list.search.length ? `          <Input type="search" placeholder="Search" className="w-56" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />` : ""}
${filters.controls.join("\n")}
      </div>`
          : ""
      }
      <div className="min-h-0 flex-1 overflow-auto px-4">
        {list.isPending ? (
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
                <TableRow key={text(row.${pk})} className="cursor-pointer" onClick={() => ${target.navigateTo(page.path, `text(row.${pk})`)}}>
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

/** The index of a board page: one column per value of the group field, native drag and drop to move cards */
function boardIndex(
  ctx: Ctx,
  list: ListOp,
  update: UpdateOp,
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
  const groupCol = entity.columns.find(c => c.name === groupBy)!;
  const values = enumValues(ctx, groupCol);
  const columns = page.columns.map(name => entity.columns.find(c => c.name === name)!).filter(c => c.name !== groupBy);
  const listIncludes = list.include.map(name => entity.relations.find(r => r.name === name)!);
  const [first, ...rest] = columns.length ? columns : [entity.columns.find(c => c.name === entity.display)!];
  const metaExpr = rest.length
    ? `[${rest.map(c => showExpr(ctx, c, "row", listIncludes, "list")).join(", ")}].filter(Boolean).join(" · ")`
    : null;
  use(ctx, "query", "useMutation");
  use(ctx, "query", "useQueryClient");
  use(ctx, "ui", "ListSkeleton");
  use(ctx, "client", "Inputs");
  use(ctx, "client", "Outputs");
  void update;
  return `const BOARD_INPUT = { page: 1, page_size: PAGE_SIZE } as Inputs[${q(R)}]["list"];
const COLUMNS = [${values.map(q).join(", ")}] as const;
type Column = (typeof COLUMNS)[number];

export function ${Comp}Index() {
  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  void user;
  const boardInput = { ...BOARD_INPUT${fixedSpread} } as Inputs[${q(R)}]["list"];
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
          ${headerExtras}
      </PaneHeader>
${actionForms.join("\n")}
${actionErrors.join("\n")}
      <ErrorNote error={move.error ?? list.error} className="m-4" />
      {list.isPending ? (
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
  const refetch = page.refresh ? `, refetchInterval: ${page.refresh * 1000}` : "";
  const gated = page.access.kind !== "public";
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
  const needsUser = gated || hasGroup || flat.some(t => usesActor(t.filter));
  const inputExpr = (tile: Flat, extra = "") => {
    const parts = [
      "page: 1",
      "page_size: 1",
      ...Object.entries(tile.filter).map(([k, v]) => `${k}: ${fixedValue(v, target, "user", idPk)}`)
    ];
    if (extra) parts.push(extra);
    return `{ ${parts.join(", ")} } as Inputs[${q(tile.resource)}]["list"]`;
  };
  const tileOpts = (tile: Flat) => `${refetch}${usesActor(tile.filter) ? ", enabled: user !== null" : ""}`;
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
  void user;
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
    return `  const recent${i} = useQuery({ queryKey: [${q(recent.resource)}, "list", ${JSON.stringify(input)}], queryFn: () => client.${recent.resource}.list(${JSON.stringify(input)} as Inputs[${q(recent.resource)}]["list"])${refetch} });`;
  });
  const recentJsx = page.recent.map((recent, i) => {
    const resource = ir.resources.find(r => r.name === recent.resource)!;
    const entity = entityByName(ir, resource.entity);
    const link = pageFor(recent.resource);
    const pk = entity.primaryKey[0];
    const item = link
      ? `<Link ${target.linkAttrs(link.path, `text(row.${pk})`)} className="hover:underline">{text(row.${entity.display}) || text(row.${pk})}</Link>`
      : `<span>{text(row.${entity.display}) || text(row.${pk})}</span>`;
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
  const needsLink = gated || page.tiles.some(t => pageFor(t.resource)) || page.recent.some(r => pageFor(r.resource));
  const userDecl = !needsUser
    ? ""
    : ir.auth
      ? `  const session = useQuery({ queryKey: ["auth", "session"], queryFn: () => client.auth.session() });
  const user = sessionUser(session.data);
  void user;`
      : `  const user: SessionUser | null = null;
  void user;`;
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
import { ${clientImports.join(", ")} } from "../client";
import { ErrorNote, ${gated ? "PaneSkeleton, " : ""}Tile, formatDateTime, text } from "../ui";
${gated ? `\n${accessGateDecl(page.access, target, idPk)}\n` : ""}${groupComponents.length ? `\n${groupComponents.join("\n\n")}\n` : ""}
export function ${Comp}Page() {
${userDecl}
${tileDecls.join("\n")}
${recentDecls.join("\n")}
  void formatDateTime;
  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">${page.title}</h1>
      ${page.tiles.length ? `<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">\n${tileJsx.join("\n")}\n      </div>` : ""}
      ${page.recent.length ? `<div className="grid gap-4 lg:grid-cols-2">\n${recentJsx.join("\n")}\n      </div>` : ""}
    </div>
  );
}
`;
  return gated ? guardExports(source, [`${Comp}Page`]) : source;
}

/** The literal of a fixed filter value for the list input; the REST contract reads booleans as "true" | "false" */
function fixedValue(value: PageFilterValue, target: WebTarget, userExpr: string, idPk: string): string {
  if (typeof value === "object") return `${userExpr}?.${idPk} ?? ""`;
  if (target.kind === "next" && typeof value === "boolean") return JSON.stringify(String(value));
  return JSON.stringify(value);
}

/** Whether a filter names the signed-in user, so its query waits for the session */
function usesActor(filter: Record<string, PageFilterValue> | undefined): boolean {
  return Object.values(filter ?? {}).some(v => typeof v === "object");
}

/** The list query options a page adds: a refetch interval, and waiting for the session when a filter names the user */
function listQueryOptions(page: PageIR): { queryOpts: string; fixedSpread: string } {
  const queryOpts = `${page.refresh ? `, refetchInterval: ${page.refresh * 1000}` : ""}${usesActor(page.filter) ? ", enabled: user !== null" : ""}`;
  return { queryOpts, fixedSpread: page.filter ? ", ...fixedFilter(user)" : "" };
}

/** `function fixedFilter(user)` for a page's fixed filter */
function fixedFilterDecl(filter: Record<string, PageFilterValue>, target: WebTarget, idPk: string): string {
  const entries = Object.entries(filter).map(([k, v]) => `${k}: ${fixedValue(v, target, "user", idPk)}`);
  return `/** Filters this page always applies */
function fixedFilter(user: SessionUser | null) {
  void user;
  return { ${entries.join(", ")} };
}`;
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
