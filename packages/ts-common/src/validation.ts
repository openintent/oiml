import type { ActionIR, ColumnIR, EntityIR, IR, OperationIR, ResourceIR } from "@osl/core";
import { toPascalCase } from "@osl/core";
import { cap, column, entityByName, q, singlePrimaryKey, type TsConventions } from "./conventions.js";

/** Zod expression for a column. `create` makes required columns required; `update` makes everything optional. */
export function zodForColumn(col: ColumnIR, mode: "create" | "update" | "filter"): string {
  let expr = baseZod(col);
  if (mode === "filter") return expr + ".optional()";
  const canBeNull = col.nullable;
  if (mode === "create") {
    const required = !col.nullable && col.default === undefined && !col.generated;
    if (!required) expr += canBeNull ? ".nullish()" : ".optional()";
    return expr;
  }
  return expr + (canBeNull ? ".nullish()" : ".optional()");
}

function baseZod(col: ColumnIR): string {
  const t = col.type;
  if (t.kind === "enum") return `z.enum([${enumValuesPlaceholder(col)}])`;
  if (t.kind === "array") return `z.array(${scalarZod(t.of, col)})`;
  // A file field takes the id of an upload; the handler swaps it for the file's snapshot
  if (t.kind === "file") return "z.string().uuid()";
  return scalarZod(t.scalar, col);
}

/** Columns with their own enum values (action fields) inline them; stored enums are filled from the IR by fillEnums */
function enumValuesPlaceholder(col: ColumnIR): string {
  if (col.enumValues) return col.enumValues.map(q).join(", ");
  return `__ENUM_${col.name}__`;
}

function scalarZod(scalar: string, col: ColumnIR): string {
  const v = col.validate ?? {};
  switch (scalar) {
    case "string": {
      let e = "z.string()";
      if (v.format === "email") e += ".email()";
      if (v.format === "url") e += ".url()";
      if (v.format === "uuid") e += ".uuid()";
      if (v.min_length !== undefined) e += `.min(${v.min_length})`;
      e += `.max(${v.max_length ?? col.maxLength ?? 255})`;
      if (v.pattern) e += `.regex(new RegExp(${q(v.pattern)}))`;
      return e;
    }
    case "text": {
      let e = "z.string()";
      if (v.min_length !== undefined) e += `.min(${v.min_length})`;
      if (v.max_length !== undefined) e += `.max(${v.max_length})`;
      if (v.pattern) e += `.regex(new RegExp(${q(v.pattern)}))`;
      return e;
    }
    case "integer":
    case "bigint": {
      let e = "z.number().int()";
      if (v.min !== undefined) e += `.min(${v.min})`;
      if (v.max !== undefined) e += `.max(${v.max})`;
      return e;
    }
    case "float": {
      let e = "z.number()";
      if (v.min !== undefined) e += `.min(${v.min})`;
      if (v.max !== undefined) e += `.max(${v.max})`;
      return e;
    }
    case "decimal": {
      let e = `z.union([z.number(), z.string().regex(/^-?\\d+(\\.\\d+)?$/)]).transform(value => String(value))`;
      if (v.min !== undefined)
        e += `.refine(value => Number(value) >= ${v.min}, { message: "Number must be greater than or equal to ${v.min}" })`;
      if (v.max !== undefined)
        e += `.refine(value => Number(value) <= ${v.max}, { message: "Number must be less than or equal to ${v.max}" })`;
      return e;
    }
    case "boolean":
      return "z.boolean()";
    case "datetime":
      return "z.string().datetime({ offset: true }).transform(value => new Date(value))";
    case "date":
      return "z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/)";
    case "time":
      return "z.string().regex(/^\\d{2}:\\d{2}(:\\d{2})?$/)";
    case "uuid":
      return "z.string().uuid()";
    case "json":
      return "z.unknown()";
    case "bytes":
      return "z.never()";
    default:
      throw new Error(`no zod for ${scalar}`);
  }
}

/** Zod for a filter value coming from the query string (always a string). */
export function filterZod(col: ColumnIR): string {
  const t = col.type;
  if (t.kind === "enum") return `z.enum([${enumValuesPlaceholder(col)}]).optional()`;
  if (t.kind === "array" || t.kind === "file") return "z.string().optional()";
  switch (t.scalar) {
    case "boolean":
      return `z.enum(["true", "false"]).transform(value => value === "true").optional()`;
    case "integer":
    case "bigint":
      return "z.coerce.number().int().optional()";
    case "float":
    case "decimal":
      return "z.coerce.number().optional()";
    case "uuid":
      return "z.string().uuid().optional()";
    default:
      return "z.string().optional()";
  }
}

export function fillEnums(expr: string, ir: IR, entity: EntityIR | null): string {
  return expr.replace(/__ENUM_([a-z0-9_]+)__/g, (_, name: string) => {
    if (!entity) throw new Error(`enum column ${name} has no entity to look its values up in`);
    const col = column(entity, name);
    if (col.type.kind !== "enum") throw new Error("enum placeholder on non-enum column");
    const values = ir.enums.find(e => e.name === (col.type as { name: string }).name)!.values;
    return values.map(q).join(", ");
  });
}

export function idZod(entity: EntityIR): string {
  const pk = singlePrimaryKey(entity);
  if (pk.type.kind === "scalar" && pk.type.scalar === "uuid") return "z.string().uuid()";
  if (pk.type.kind === "scalar" && (pk.type.scalar === "integer" || pk.type.scalar === "bigint"))
    return "z.coerce.number().int()";
  return "z.string().min(1)";
}

export interface ValidationOptions {
  /**
   * http: list queries come from a query string, so page numbers are coerced and filters parse strings.
   * typed: list input is JSON with real types (tRPC), so filters use the column's own Zod type.
   */
  listInput: "http" | "typed";
}

/** generated/validation.ts */
export function validationFile(
  ir: IR,
  conv: TsConventions,
  options: ValidationOptions = { listInput: "http" }
): string {
  const out: string[] = [conv.header("Input validation for every resource operation."), `import { z } from "zod";`, ""];
  for (const resource of ir.resources) {
    const entity = entityByName(ir, resource.entity);
    out.push(`export const ${resource.name}Id = ${idZod(entity)};`);
    for (const op of resource.operations) {
      if (op.kind === "create" || op.kind === "update") {
        const lines = op.fields.map(
          f => `    ${f}: ${fillEnums(zodForColumn(column(entity, f), op.kind), ir, entity)}`
        );
        out.push(
          `export const ${resource.name}${cap(op.kind)}Input = z\n  .object({\n${lines.join(",\n")}\n  })\n  .strict();`
        );
      }
      if (op.kind === "list") {
        const number = options.listInput === "http" ? "z.coerce.number()" : "z.number()";
        const filter = (f: string) =>
          options.listInput === "http" ? filterZod(column(entity, f)) : zodForColumn(column(entity, f), "filter");
        const lines = [
          `    page: ${number}.int().min(1).default(1)`,
          `    page_size: ${number}.int().min(1).max(200).default(${op.pageSize})`,
          ...op.filters.map(f => `    ${f}: ${fillEnums(filter(f), ir, entity)}`),
          ...(op.sortable.length
            ? [
                `    sort: z.enum([${op.sortable
                  .flatMap(f => [`${f}:asc`, `${f}:desc`])
                  .map(q)
                  .join(", ")}]).optional()`
              ]
            : []),
          ...(op.search.length ? [`    q: z.string().max(200).optional()`] : [])
        ];
        out.push(`export const ${resource.name}ListQuery = z\n  .object({\n${lines.join(",\n")}\n  })\n  .strict();`);
      }
    }
    out.push("");
  }
  for (const action of ir.actions) {
    const name = actionInputName(action);
    if (action.input.length === 0) {
      out.push(`export const ${name} = z.object({}).strict();`);
    } else {
      const lines = action.input.map(c => `    ${c.name}: ${fillEnums(zodForColumn(c, "create"), ir, null)}`);
      out.push(`export const ${name} = z\n  .object({\n${lines.join(",\n")}\n  })\n  .strict();`);
    }
    out.push(`export type ${cap(name)} = z.infer<typeof ${name}>;`, "");
  }
  return out.join("\n");
}

/** `postsPublishInput` for a resource action, `sendDigestInput` for a global one */
export function actionInputName(action: ActionIR): string {
  const base = action.resource ? `${action.resource}_${action.name}` : action.name;
  const pascal = toPascalCase(base);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}Input`;
}

export function opOf(resource: ResourceIR, kind: OperationIR["kind"]): OperationIR | undefined {
  return resource.operations.find(o => o.kind === kind);
}
