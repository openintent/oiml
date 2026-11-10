import type { ColumnIR, EntityIR, IR, ShapeKeyIR } from "@osl/core";
import { shapedColumns, toPascalCase } from "@osl/core";
import { q, typeName } from "./conventions.js";

/** `IntegrationOptions`: the type of a JSON column's value, exported from the schema */
export function shapeTypeName(entity: EntityIR, col: ColumnIR): string {
  return `${typeName(entity)}${toPascalCase(col.name)}`;
}

/** `integrationsConfigShapes`: the Zod objects of a column with a shape per enum value, by value */
export function shapesConst(resource: string, col: ColumnIR): string {
  const pascal = toPascalCase(`${resource}_${col.name}`);
  return `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}Shapes`;
}

function scalarTs(kind: string): string {
  switch (kind) {
    case "integer":
    case "float":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

/** A shape as a TypeScript type: a key is always there when it is required or has a default */
export function shapeTsType(keys: ShapeKeyIR[]): string {
  if (!keys.length) return "Record<string, never>";
  const parts = keys.map(key => {
    const type =
      key.kind === "object"
        ? shapeTsType(key.keys ?? [])
        : key.kind === "enum"
          ? (key.values ?? []).map(q).join(" | ")
          : key.kind === "array"
            ? `${scalarTs(key.of ?? "string")}[]`
            : scalarTs(key.kind);
    return `${key.name}${key.required || key.default !== undefined ? "" : "?"}: ${type}`;
  });
  return `{ ${parts.join("; ")} }`;
}

/** The value types the schema exports for an entity's shaped JSON columns */
export function shapeTypeLines(entity: EntityIR): string[] {
  return shapedColumns(entity).flatMap(col => {
    const name = shapeTypeName(entity, col);
    if (col.shape)
      return [
        `/** What ${entity.name}.${col.name} holds: its declared shape */`,
        `export type ${name} = ${shapeTsType(col.shape)};`
      ];
    const by = col.shapeBy!;
    return [
      `/** What ${entity.name}.${col.name} holds: the shape its row's ${by.column} names */`,
      `export type ${name} = ${by.shapes.map(s => shapeTsType(s.keys)).join(" | ") || "never"};`
    ];
  });
}

function scalarZod(kind: string, key: ShapeKeyIR): string {
  const v = key.validate ?? {};
  switch (kind) {
    case "string":
    case "text": {
      let e = "z.string()";
      if (v.format === "email") e += ".email()";
      if (v.format === "url") e += ".url()";
      if (v.format === "uuid") e += ".uuid()";
      if (v.min_length !== undefined) e += `.min(${v.min_length})`;
      const max = v.max_length ?? key.maxLength;
      if (max !== undefined) e += `.max(${max})`;
      if (v.pattern) e += `.regex(new RegExp(${q(v.pattern)}))`;
      return e;
    }
    case "integer":
    case "float": {
      let e = kind === "integer" ? "z.number().int()" : "z.number()";
      if (v.min !== undefined) e += `.min(${v.min})`;
      if (v.max !== undefined) e += `.max(${v.max})`;
      return e;
    }
    case "boolean":
      return "z.boolean()";
    case "date":
      return "z.string().regex(/^\\d{4}-\\d{2}-\\d{2}$/)";
    case "datetime":
      // Kept as written: a JSON value holds the string, not a Date
      return "z.string().datetime({ offset: true })";
    case "uuid":
      return "z.string().uuid()";
    default:
      throw new Error(`no zod for a shape key of kind ${kind}`);
  }
}

function keyZod(key: ShapeKeyIR, indent: string): string {
  let expr: string;
  if (key.kind === "object") expr = shapeZod(key.keys ?? [], indent);
  else if (key.kind === "enum") expr = `z.enum([${(key.values ?? []).map(q).join(", ")}])`;
  else if (key.kind === "array") expr = `z.array(${scalarZod(key.of ?? "string", key)})`;
  else expr = scalarZod(key.kind, key);
  if (key.default !== undefined) return `${expr}.default(${JSON.stringify(key.default)})`;
  return key.required ? expr : `${expr}.optional()`;
}

/**
 * The Zod object of a shape. A key the shape does not name is refused under its own path (`catchall`), where
 * `.strict()` would report it under the object's; null is no value of a key.
 */
export function shapeZod(keys: ShapeKeyIR[], indent = "    "): string {
  if (!keys.length) return "z.object({}).catchall(unknownKey)";
  const inner = `${indent}  `;
  return `z\n${inner}.object({\n${keys.map(key => `${inner}  ${key.name}: ${keyZod(key, `${inner}  `)}`).join(",\n")}\n${inner}})\n${inner}.catchall(unknownKey)`;
}

/** What generated/validation.ts carries when a JSON column has a shape */
export const SHAPE_SOURCE = `/** A key a shape does not name: refused under its own path */
const unknownKey = z.unknown().superRefine((_value, ctx) => {
  ctx.addIssue({ code: "custom", message: "Unrecognized key" });
});
`;

/** What it carries beside that when a column has a shape per enum value */
export const SHAPE_BY_SOURCE = `/** A value whose shape follows an enum field of its row: anything but nothing here, held to the row's shape by the handler */
function shaped<Stored, Written = Stored>() {
  return z.custom<Stored>(value => value !== undefined && value !== null, "Required") as unknown as z.ZodType<
    Stored,
    z.ZodTypeDef,
    Written
  >;
}

/** A value held to one shape: the value as it is stored, defaults filled in, or what does not fit under the field's path */
export function fitShape<T>(
  shape: z.ZodTypeAny,
  field: string,
  value: T
): { ok: true; value: T } | { ok: false; issues: { path: string; message: string }[] } {
  const result = shape.safeParse(value);
  if (result.success) return { ok: true, value: result.data as T };
  return {
    ok: false,
    issues: result.error.issues.map(issue => ({ path: [field, ...issue.path.map(String)].join("."), message: issue.message }))
  };
}
`;

/** Whether the model has a JSON column with a shape, one or one per enum value */
export function hasShapes(ir: IR): boolean {
  return ir.entities.some(e => shapedColumns(e).length > 0);
}

/** Whether the model has a JSON column with a shape per enum value */
export function hasShapesBy(ir: IR): boolean {
  return ir.entities.some(e => e.columns.some(c => c.shapeBy !== undefined));
}

/** A shape-per-value column a create or an update must hold to its row, with what the handler needs to do it */
export interface ShapeGuard {
  /** The JSON column and the enum column its shape follows */
  column: ColumnIR;
  by: ColumnIR;
  /** Whether the body may carry each */
  sendsValue: boolean;
  sendsBy: boolean;
}

/**
 * The shape-per-value columns an operation touches: the body may carry the value, the enum its shape follows, or
 * both. A create that leaves the value out has nothing to hold; an update that changes the enum does.
 */
export function shapeGuards(entity: EntityIR, fields: string[], mode: "create" | "update"): ShapeGuard[] {
  return entity.columns
    .filter(c => c.shapeBy !== undefined)
    .map(column => ({
      column,
      by: entity.columns.find(c => c.name === column.shapeBy!.column)!,
      sendsValue: fields.includes(column.name),
      sendsBy: fields.includes(column.shapeBy!.column)
    }))
    .filter(guard => (mode === "create" ? guard.sendsValue : guard.sendsValue || guard.sendsBy));
}

/** What the refusal says when the enum changes and the value was not sent with it */
export function shapeGuardMessage(guard: ShapeGuard): string {
  return `${guard.by.name} changes, so ${guard.column.name} must be sent with it: a value fits the shape of one ${guard.by.name}`;
}

/**
 * The lines a create or an update handler runs once it holds the parsed body (and, for an update, the row): the
 * value is held to the shape of the enum value the row will have, and an update that changes the enum without
 * sending the value is refused when the row has one. `refuse` answers 400 with the issues in `issues`.
 */
export function shapeGuardLines(
  entity: EntityIR,
  resource: string,
  fields: string[],
  mode: "create" | "update",
  body: string,
  existing: string,
  refuse: string,
  indent: string
): string[] {
  const lines: string[] = [];
  for (const guard of shapeGuards(entity, fields, mode)) {
    const { column, by } = guard;
    const value = `${body}.${column.name}`;
    const fallback =
      mode === "update"
        ? `${existing}.${by.name}`
        : by.default?.kind === "literal"
          ? q(String(by.default.value))
          : undefined;
    const kind = guard.sendsBy ? (fallback ? `${body}.${by.name} ?? ${fallback}` : `${body}.${by.name}`) : fallback;
    if (kind === undefined) continue;
    lines.push(
      `${indent}// ${column.name} follows ${by.name}: a written value is held to the shape of the ${by.name} its row will have`
    );
    if (guard.sendsValue) {
      lines.push(
        `${indent}if (${value} !== undefined && ${value} !== null) {`,
        `${indent}  const fit = fitShape(${shapesConst(resource, column)}[${kind}], ${q(column.name)}, ${value});`,
        `${indent}  if (!fit.ok) {`,
        `${indent}    const issues = fit.issues;`,
        `${indent}    ${refuse}`,
        `${indent}  }`,
        `${indent}  ${value} = fit.value;`,
        `${indent}}`
      );
    }
    if (mode === "update" && guard.sendsBy) {
      const unsent = guard.sendsValue ? `${value} === undefined && ` : "";
      const has = column.nullable ? ` && ${existing}.${column.name} !== null` : "";
      // The second branch of the same statement when the value may be sent: `} else if (...) {`
      const opening = guard.sendsValue ? `${lines.pop()} else ` : indent;
      lines.push(
        `${opening}if (${unsent}${body}.${by.name} !== undefined && ${body}.${by.name} !== ${existing}.${by.name}${has}) {`,
        `${indent}  const issues = [{ path: ${q(column.name)}, message: ${q(shapeGuardMessage(guard))} }];`,
        `${indent}  ${refuse}`,
        `${indent}}`
      );
    }
  }
  return lines;
}
