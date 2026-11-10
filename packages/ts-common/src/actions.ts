import type { ActionIR, GeneratedFile, IR } from "@osl/core";
import { toPascalCase, userActions } from "@osl/core";
import { cap, entityByName, q, typeName } from "./conventions.js";
import type { ServerConventions } from "./server-conventions.js";
import { actionInputName } from "./validation.js";

/** `PostsPublishInput` */
export function actionInputType(action: ActionIR): string {
  return cap(actionInputName(action));
}

/** `PostsPublishResult` */
export function actionResultType(action: ActionIR): string {
  return `${toPascalCase(action.handler)}Result`;
}

/** The TS type a handler returns: the entity row, void, or the declared shape */
export function actionResultTs(ir: IR, action: ActionIR): string {
  if (action.returns.kind === "entity") return `schema.${typeName(entityByName(ir, action.entity!))}`;
  if (action.returns.kind === "none") return "void";
  return `{ ${action.returns.fields.map(f => `${f.name}: ${fieldTs(f)}`).join("; ")} }`;
}

function fieldTs(f: ActionIR["input"][number]): string {
  const t = f.type;
  let base: string;
  if (t.kind === "enum") base = (f.enumValues ?? []).map(q).join(" | ") || "string";
  else if (t.kind === "array") base = `${scalarTs(t.of)}[]`;
  else if (t.kind === "file") base = "unknown";
  else base = scalarTs(t.scalar);
  return f.nullable ? `${base} | null` : base;
}

function scalarTs(scalar: string): string {
  switch (scalar) {
    case "integer":
    case "bigint":
    case "float":
      return "number";
    case "boolean":
      return "boolean";
    case "json":
      return "unknown";
    case "datetime":
      return "Date";
    default:
      return "string";
  }
}

/** A value of the result's shape for the handler stub */
function zeroValue(f: ActionIR["input"][number]): string {
  if (f.nullable) return "null";
  const t = f.type;
  if (t.kind === "enum") return q((f.enumValues ?? [""])[0]);
  if (t.kind === "array") return "[]";
  if (t.kind === "file") return "null";
  switch (t.scalar) {
    case "integer":
    case "bigint":
    case "float":
      return "0";
    case "boolean":
      return "false";
    case "json":
      return "null";
    case "datetime":
      return "new Date()";
    case "money":
      // An amount is a decimal string; the empty string is not one
      return '"0"';
    default:
      return '""';
  }
}

/** generated/actions.ts: the handler registry, typed so a handler that returns the wrong shape fails to compile. */
export function actionsFile(ir: IR, conv: ServerConventions): string {
  const rowType = (a: ActionIR) =>
    a.scope === "row" ? `schema.${typeName(entityByName(ir, a.entity!))}` : "undefined";
  const actions = userActions(ir);
  const inputs = [...new Set(actions.map(actionInputType))].sort();
  return `${conv.header("Actions: the context handlers receive and the registry of the handlers you own in src/actions.")}
import type { Db } from "./db/client";
import type * as schema from "./db/schema";
import type { Session } from "${conv.authModule}";
${inputs.length ? `import type { ${inputs.join(", ")} } from "./validation";` : ""}
${actions.map(a => `import * as ${a.handler} from "${conv.src(`actions/${a.handler}`)}";`).join("\n")}

/** What a handler gets: the validated input, the row for row actions, the caller's session and the database */
export interface ActionContext<Input, Row = undefined> {
  input: Input;
  row: Row;
  /** null when a schedule or timer runs the action as the system */
  session: Session | null;
  db: Db;
  /** The time the request or job runs at; a timer or schedule passes the time it was due. Compare against this, not the clock. */
  now: Date;
}

${actions.map(a => `export type ${actionResultType(a)} = ${actionResultTs(ir, a)};`).join("\n")}

export const handlers = {
${actions
  .map(
    a =>
      `  ${a.handler}: ${a.handler}.handler as (ctx: ActionContext<${actionInputType(a)}, ${rowType(a)}>) => Promise<${actionResultType(a)}>`
  )
  .join(",\n")}
};
`;
}

/** src/actions/<handler>.ts, created once per action */
export function actionScaffolds(ir: IR, conv: ServerConventions): GeneratedFile[] {
  return userActions(ir).map(action => {
    const row = action.scope === "row" ? typeName(entityByName(ir, action.entity!)) : null;
    const result = actionResultTs(ir, action).replace(/schema\./g, "");
    const schemaTypes = [
      ...new Set(
        [row, action.returns.kind === "entity" ? typeName(entityByName(ir, action.entity!)) : null].filter(Boolean)
      )
    ] as string[];
    const stub =
      action.returns.kind === "entity"
        ? action.scope === "row"
          ? "  return ctx.row;"
          : `  throw new Error("return the ${row ?? "entity"} this action answers with");`
        : action.returns.kind === "none"
          ? "  void ctx;"
          : `  void ctx;\n  return { ${action.returns.fields.map(f => `${f.name}: ${zeroValue(f)}`).join(", ")} };`;
    const where =
      action.scope === "row"
        ? `POST ${action.path}: ctx.row is the ${row}; return the row to answer with it.`
        : action.scope === "collection"
          ? `POST ${action.path}, over the whole collection.`
          : `POST ${action.path}.`;
    return {
      path: `src/actions/${action.handler}.ts`,
      mode: "scaffold" as const,
      content: `${conv.scaffoldHeader(`${action.description ?? toPascalCase(action.name)}. ${where}`)}
import type { ActionContext } from "${conv.generated("actions")}";
${schemaTypes.length ? `import type { ${schemaTypes.join(", ")} } from "${conv.generated("db/schema")}";` : ""}
import type { ${actionInputType(action)} } from "${conv.generated("validation")}";

// Throw an error from "${conv.errorsModule.replace(/^\.\//, conv.generated("")).replace(/\/$/, "")}" to answer with a status; ctx.db is the Drizzle client.
export async function handler(ctx: ActionContext<${actionInputType(action)}, ${row ?? "undefined"}>): Promise<${result}> {
${stub}
}
`
    };
  });
}
