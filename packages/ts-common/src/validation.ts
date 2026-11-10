import type { ActionIR, ColumnIR, EntityIR, IR, OperationIR, ResourceIR } from "@osl/core";
import { MONEY_PATTERN, toPascalCase } from "@osl/core";
import { cap, column, entityByName, q, singlePrimaryKey, type TsConventions } from "./conventions.js";
import {
  SHAPE_BY_SOURCE,
  SHAPE_SOURCE,
  hasShapes,
  hasShapesBy,
  shapeTypeName,
  shapeZod,
  shapesConst
} from "./shapes.js";

/** Zod expression for a column. `create` makes required columns required; `update` makes everything optional. */
export function zodForColumn(col: ColumnIR, mode: "create" | "update" | "filter"): string {
  // A filter compares an amount, it does not write one: the shape is checked, the field's bounds are not
  if (mode === "filter" && col.money) return `${moneyZod()}.optional()`;
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
  // A JSON value with a shape is held to it here; one whose shape follows an enum of its row is held by the handler
  if (col.shape) return shapeZod(col.shape);
  if (col.shapeBy) return `shaped<__SHAPE_${col.name}__>()`;
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

/** `money()`, `money("0")`, `money(undefined, "9999.99")`: the helper below, with the field's bounds */
function moneyZod(min?: string, max?: string): string {
  const args =
    max !== undefined ? [min === undefined ? "undefined" : q(min), q(max)] : min !== undefined ? [q(min)] : [];
  return `money(${args.join(", ")})`;
}

/** What generated/validation.ts carries when an input has a money field */
const MONEY_SOURCE = `const MONEY = /${MONEY_PATTERN.replace(/\//g, "\\/")}/;

/** An amount in ten-thousandths, exactly: a decimal string is never read as a float */
function moneyUnits(value: string): bigint {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const units = BigInt(whole + fraction.padEnd(4, "0"));
  return negative ? -units : units;
}

/**
 * An amount: a decimal string and nothing else. A JSON number is refused, not converted (a float has already lost
 * what was written), and so is a fifth fraction digit, which the column could only round away. Bounds are compared
 * digit by digit, and only on a value that has the shape.
 */
export function money(min?: string, max?: string) {
  return z.string().superRefine((value, ctx) => {
    if (!MONEY.test(value)) {
      ctx.addIssue({ code: "custom", message: "Expected a decimal string with at most four fraction digits" });
      return;
    }
    if (min !== undefined && moneyUnits(value) < moneyUnits(min))
      ctx.addIssue({ code: "custom", message: \`Amount must be at least \${min}\` });
    if (max !== undefined && moneyUnits(value) > moneyUnits(max))
      ctx.addIssue({ code: "custom", message: \`Amount must be at most \${max}\` });
  });
}
`;

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
    case "money":
      return moneyZod(col.money?.min, col.money?.max);
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
    case "money":
      return `${moneyZod()}.optional()`;
    case "uuid":
      return "z.string().uuid().optional()";
    default:
      return "z.string().optional()";
  }
}

export function fillEnums(expr: string, ir: IR, entity: EntityIR | null, resource?: string): string {
  // A value whose shape follows an enum: stored as the schema's type says, written as any of the shapes takes it
  expr = expr.replace(/__SHAPE_([a-z0-9_]+)__/g, (_, name: string) => {
    if (!entity) throw new Error(`shaped column ${name} has no entity to take its type from`);
    const col = column(entity, name);
    const shapes = resource ? shapesConst(resource, col) : undefined;
    return `${shapeTypeName(entity, col)}${shapes ? `, z.input<(typeof ${shapes})[keyof typeof ${shapes}]>` : ""}`;
  });
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
  const shapedTypes = new Set<string>();
  for (const resource of ir.resources) {
    const entity = entityByName(ir, resource.entity);
    out.push(`export const ${resource.name}Id = ${idZod(entity)};`);
    // The shapes of a value that follows an enum field, by the enum's value: the handlers hold a write to one
    const written = new Set(
      resource.operations.flatMap(op => (op.kind === "create" || op.kind === "update" ? op.fields : []))
    );
    for (const col of entity.columns.filter(c => c.shapeBy !== undefined && written.has(c.name))) {
      shapedTypes.add(shapeTypeName(entity, col));
      out.push(
        `/** The shape of ${resource.entity}.${col.name} for each value of ${col.shapeBy!.column} */`,
        `export const ${shapesConst(resource.name, col)} = {\n${col
          .shapeBy!.shapes.map(
            shape =>
              `  ${/^[A-Za-z_][A-Za-z0-9_]*$/.test(shape.value) ? shape.value : q(shape.value)}: ${shapeZod(shape.keys, "  ")}`
          )
          .join(",\n")}\n};`
      );
    }
    for (const op of resource.operations) {
      if (op.kind === "create" || op.kind === "update") {
        const lines = op.fields.map(
          f => `    ${f}: ${fillEnums(zodForColumn(column(entity, f), op.kind), ir, entity, resource.name)}`
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
          // An archiving entity: the archived rows instead of the live ones
          ...(entity.archive
            ? [
                options.listInput === "http"
                  ? `    archived: z.enum(["true", "false"]).transform(value => value === "true").optional()`
                  : `    archived: z.boolean().optional()`
              ]
            : []),
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
  // The amount helper, wherever the model has a money field: auth's register schema imports it too
  const amounts = [...ir.entities.flatMap(e => e.columns), ...ir.actions.flatMap(a => a.input)];
  if (amounts.some(c => c.money)) out.splice(3, 0, MONEY_SOURCE);
  // The shape helpers, wherever a JSON column has a shape: auth's register schema imports unknownKey too
  if (hasShapesBy(ir)) out.splice(3, 0, SHAPE_BY_SOURCE);
  if (hasShapes(ir)) out.splice(3, 0, SHAPE_SOURCE.replace("const unknownKey", "export const unknownKey"));
  if (shapedTypes.size) out.splice(2, 0, `import type { ${[...shapedTypes].sort().join(", ")} } from "./db/schema";`);
  return out.join("\n");
}

/**
 * The amounts an update must carry when it changes their currency: for each currency field the update writes, the
 * money columns that read it. A row's amount is not carried into another currency by leaving it out of the body.
 */
export function currencyGuards(entity: EntityIR, fields: string[]): { currency: string; amounts: string[] }[] {
  return fields
    .map(currency => ({
      currency,
      amounts: entity.columns.filter(c => c.money?.currencyField === currency).map(c => c.name)
    }))
    .filter(guard => guard.amounts.length > 0);
}

/** What the refusal says of the amounts the body left out, as a template over `name` */
export function currencyGuardMessage(currency: string, name: string): string {
  return `${currency} changes, so ${name} must be sent with it: an amount is not carried into another currency`;
}

/**
 * The lines an update handler runs once it holds the row and the parsed body: when the body changes a currency
 * field, the amounts in that currency the row has and the body does not send are `missing`, and `refuse` answers
 * 400 for them. Empty when the update writes no currency field.
 */
export function currencyGuardLines(
  entity: EntityIR,
  fields: string[],
  body: string,
  existing: string,
  refuse: (currency: string) => string,
  indent: string
): string[] {
  const lines: string[] = [];
  for (const guard of currencyGuards(entity, fields)) {
    const checks = guard.amounts.map(amount => {
      const has = column(entity, amount).nullable ? `${existing}.${amount} !== null` : "";
      const unsent = fields.includes(amount) ? `${body}.${amount} === undefined` : "";
      return `...(${[has, unsent].filter(Boolean).join(" && ") || "true"} ? [${q(amount)}] : [])`;
    });
    lines.push(
      `${indent}// An amount keeps its currency: a body that changes ${guard.currency} sends each amount that is in it`,
      `${indent}if (${body}.${guard.currency} !== undefined && ${body}.${guard.currency} !== ${existing}.${guard.currency}) {`,
      `${indent}  const missing: string[] = [${checks.join(", ")}];`,
      `${indent}  if (missing.length) ${refuse(guard.currency)}`,
      `${indent}}`
    );
  }
  return lines;
}

/** What auth's register schema imports from the validation module: the helpers its fields' Zod expressions call */
export function registerValidators(fields: ColumnIR[]): string[] {
  return [...(fields.some(c => c.money) ? ["money"] : []), ...(fields.some(c => c.shape) ? ["unknownKey"] : [])];
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
