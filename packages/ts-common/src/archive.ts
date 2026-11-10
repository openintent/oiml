/**
 * What the TypeScript resource modules share for an archiving entity (round B3): the condition a list carries. The
 * statement behind the compiler's `archive` and `restore` is in generated/row-actions.ts (row-actions.ts here), with
 * the transitions, where the timers reach it too.
 */
import type { EntityIR } from "@osl/core";

/** The list's own condition: live rows, or the archived ones when the caller asks with `archived: true` */
export function archiveCondition(entity: EntityIR, table: string, indent: string): string {
  const column = `${table}.${entity.archive!.column}`;
  return `${indent}conditions.push(archived ? isNotNull(${column}) : isNull(${column}));`;
}

/** What Drizzle the list condition needs */
export const ARCHIVE_DRIZZLE = ["isNotNull", "isNull"];
