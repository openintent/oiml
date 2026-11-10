/**
 * The compiler's own row actions that are one statement on the row: `archive` and `restore` (round B3) and the
 * transitions of a state machine (round B4). Both TypeScript backends write them into one module,
 * generated/row-actions.ts, which the resource handlers call after the rule and the timers call as the system.
 */
import type { ActionIR, EntityIR, IR } from "@osl/core";
import { statementActions, transitionOf } from "@osl/core";
import { entityByName, q, singlePrimaryKey, tableExport, typeName, type TsConventions } from "./conventions.js";

/** Whether an action is one of the compiler's one-statement row actions */
export function isStatementAction(action: ActionIR): boolean {
  return action.builtin === "archive" || action.builtin === "restore" || action.builtin === "transition";
}

/** Whether the model has any: generated/row-actions.ts exists only then */
export function hasRowActions(ir: IR): boolean {
  return statementActions(ir).length > 0;
}

/** `setArticleArchived` */
function archiveFn(entity: EntityIR): string {
  return `set${typeName(entity)}Archived`;
}

/** `articleTransitions` */
function transitionsConst(entity: EntityIR): string {
  const T = typeName(entity);
  return `${T.charAt(0).toLowerCase()}${T.slice(1)}Transitions`;
}

/** What a module imports from generated/row-actions for the actions it runs, sorted */
export function rowActionImports(ir: IR, actions: ActionIR[]): string[] {
  const names = new Set<string>();
  for (const action of actions) {
    if (!isStatementAction(action)) continue;
    const entity = entityByName(ir, action.entity!);
    names.add(action.builtin === "transition" ? transitionsConst(entity) : archiveFn(entity));
  }
  return [...names].sort();
}

/** The call that runs the action's statement on the row with that id: the row as it now is, or undefined */
export function statementCall(ir: IR, action: ActionIR, id: string, now: string): string {
  const entity = entityByName(ir, action.entity!);
  if (action.builtin === "transition") {
    const step = transitionOf(ir, action);
    return `${transitionsConst(entity)}.${step.name}(${id}${step.stamp ? `, ${now}` : ""})`;
  }
  return `${archiveFn(entity)}(${id}, ${action.builtin === "archive"}, ${now})`;
}

/**
 * The statements of a request handler for one of these actions: the update, the 409 when it changed nothing, and,
 * when the entity has timers, their scheduling: the row was written, as by an update, and a timer may wait on a stamp.
 */
export function statementHandlerLines(ir: IR, action: ActionIR, row: string): string[] {
  const entity = entityByName(ir, action.entity!);
  const pk = singlePrimaryKey(entity).name;
  const lines = [`const result = await ${statementCall(ir, action, `${row}.${pk}`, "new Date()")};`];
  if (action.builtin === "transition") {
    const step = transitionOf(ir, action);
    const column = entity.transitions!.column;
    lines.push(
      `if (!result) fail(409, "invalid_transition", \`${step.name} needs ${column} ${step.from.join(" or ")}; this row's ${column} is \${${row}.${column}}\`);`
    );
  } else {
    lines.push(
      `if (!result) fail(409, "conflict", ${q(action.builtin === "archive" ? "The row is archived already" : "The row is not archived")});`
    );
  }
  if (ir.timers.some(timer => timer.entity === action.entity))
    lines.push(`await scheduleTimers(${q(action.entity!)}, result);`);
  return lines;
}

/** A TS array literal of strings: `["draft", "in_review"]` */
function literals(values: string[]): string {
  return `[${values.map(q).join(", ")}]`;
}

/** generated/row-actions.ts */
export function rowActionsFile(ir: IR, conv: TsConventions): string {
  const actions = statementActions(ir);
  const archiving = [...new Set(actions.filter(a => a.builtin !== "transition").map(a => a.entity!))];
  const moving = [...new Set(actions.filter(a => a.builtin === "transition").map(a => a.entity!))];
  const drizzle = new Set<string>(["and", "eq"]);
  const sections: string[] = [];
  for (const entity of ir.entities) {
    const T = typeName(entity);
    const table = `schema.${tableExport(entity)}`;
    const pk = entity.primaryKey[0];
    if (archiving.includes(entity.name)) {
      const column = entity.archive!.column;
      drizzle.add("isNull");
      drizzle.add("isNotNull");
      sections.push(`/**
 * archive and restore of a ${T} row: sets ${column} on a live row or clears it on an archived one, in one statement.
 * Undefined when there was nothing to do: the row is archived already, or is not, or went meanwhile.
 */
export async function ${archiveFn(entity)}(id: schema.${T}[${q(pk)}], archived: boolean, now: Date): Promise<schema.${T} | undefined> {
  const [updated] = await db
    .update(${table})
    .set({ ${column}: archived ? now : null })
    .where(and(eq(${table}.${pk}, id), archived ? isNull(${table}.${column}) : isNotNull(${table}.${column})))
    .returning();
  return updated;
}`);
    }
    if (moving.includes(entity.name)) {
      const machine = entity.transitions!;
      const column = machine.column;
      const move = `move${T}`;
      drizzle.add("inArray");
      const steps = machine.steps.map(step => {
        const values = [`${column}: ${q(step.to)}`, ...(step.stamp ? [`${step.stamp}: now`] : [])].join(", ");
        const params = `id: schema.${T}[${q(pk)}]${step.stamp ? ", now: Date" : ""}`;
        return `  /** ${step.from.join(" or ")} to ${step.to}${step.stamp ? `, stamping ${step.stamp}` : ""} */
  ${step.name}: (${params}) => ${move}(id, ${literals(step.from)}, { ${values} })`;
      });
      sections.push(`/** One conditional update: the row moves only if its ${column} is still one of \`from\`. Undefined when it is not, or the row went meanwhile. */
async function ${move}(
  id: schema.${T}[${q(pk)}],
  from: NonNullable<schema.${T}[${q(column)}]>[],
  values: Partial<typeof ${table}.$inferInsert>
): Promise<schema.${T} | undefined> {
  const [updated] = await db
    .update(${table})
    .set(values)
    .where(and(eq(${table}.${pk}, id), inArray(${table}.${column}, from)))
    .returning();
  return updated;
}

/** The transitions of ${T}: where its ${column} may go, and from where. Each answers the row as it now is, or undefined when the row was in another state. */
export const ${transitionsConst(entity)} = {
${steps.join(",\n")}
};`);
    }
  }
  return `${conv.header("The compiler's own row actions: archive, restore and the transitions. Each is one conditional update, so of two callers at once one changes the row and the other is told. Request handlers call them after the rule; timers call them as the system.")}
import { ${[...drizzle].sort().join(", ")} } from "drizzle-orm";
import { db } from "./db/client";
import * as schema from "./db/schema";

${sections.join("\n\n")}
`;
}
