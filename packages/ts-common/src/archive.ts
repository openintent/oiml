/**
 * What the TypeScript resource modules share for an archiving entity (round B3): the condition a list carries, and
 * the function behind the compiler's `archive` and `restore`. Both backends write the same Drizzle statements; only
 * how a handler answers differs.
 */
import type { ActionIR, EntityIR, IR } from "@osl/core";
import { singlePrimaryKey, typeName } from "./conventions.js";

/** Whether an action is the compiler's own `archive` or `restore` */
export function isArchive(action: ActionIR): boolean {
  return action.builtin === "archive" || action.builtin === "restore";
}

/** The list's own condition: live rows, or the archived ones when the caller asks with `archived: true` */
export function archiveCondition(entity: EntityIR, table: string, indent: string): string {
  const column = `${table}.${entity.archive!.column}`;
  return `${indent}conditions.push(archived ? isNotNull(${column}) : isNull(${column}));`;
}

/** What Drizzle the two pieces above need */
export const ARCHIVE_DRIZZLE = ["and", "eq", "isNotNull", "isNull"];

/**
 * The module-level function behind `archive` and `restore`: one conditional update, so two callers at once cannot
 * both archive a row. Undefined when no row matched: it is archived already, or is not, or went meanwhile.
 */
export function archiveSource(entity: EntityIR, table: string): string {
  const T = typeName(entity);
  const pk = singlePrimaryKey(entity).name;
  const column = entity.archive!.column;
  return `/** archive and restore: sets ${column} on a live row or clears it on an archived one, in one statement; undefined when there was nothing to do */
async function setArchived(row: schema.${T}, archived: boolean): Promise<schema.${T} | undefined> {
  const [updated] = await db
    .update(${table})
    .set({ ${column}: archived ? new Date() : null })
    .where(and(eq(${table}.${pk}, row.${pk}), archived ? isNull(${table}.${column}) : isNotNull(${table}.${column})))
    .returning();
  return updated;
}`;
}

/**
 * The statements of a handler for `archive` or `restore`: the update, the 409 when it changed nothing, and, when the
 * entity has timers, their scheduling: the row was written, as by an update, and a timer may wait on the stamp.
 */
export function archiveCall(ir: IR, action: ActionIR, row: string): string[] {
  const archiving = action.builtin === "archive";
  const lines = [
    `const result = await setArchived(${row}, ${archiving});`,
    `if (!result) fail(409, "conflict", ${JSON.stringify(archiving ? "The row is archived already" : "The row is not archived")});`
  ];
  if (ir.timers.some(timer => timer.entity === action.entity))
    lines.push(`await scheduleTimers(${JSON.stringify(action.entity)}, result);`);
  return lines;
}
