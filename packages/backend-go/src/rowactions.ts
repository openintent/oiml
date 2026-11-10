/**
 * generated/rowactions: the compiler's own row actions that are one statement on the row: `archive` and `restore`
 * (round B3) and the transitions of a state machine (round B4). The resource handlers call them after the rule and
 * the timers call them as the system, so the statement is written once.
 */
import type { ActionIR, EntityIR, IR } from "@osl/core";
import { statementActions, transitionOf } from "@osl/core";
import { columnsConst, scanFunc, tableConst } from "./models.js";
import {
  HEADER,
  entityByName,
  exported,
  goFile,
  q,
  quoteIdent,
  rowGoType,
  singlePrimaryKey,
  typeName
} from "./util.js";

/** Whether an action is one of the compiler's one-statement row actions */
export function isStatementAction(action: ActionIR): boolean {
  return action.builtin === "archive" || action.builtin === "restore" || action.builtin === "transition";
}

/** Whether the model has any: the package exists only then */
export function hasRowActions(ir: IR): boolean {
  return statementActions(ir).length > 0;
}

/** `SetArticleArchived` */
function archiveFunc(entity: EntityIR): string {
  return `Set${typeName(entity)}Archived`;
}

/** `TransitionArticleApprove` */
function transitionFunc(entity: EntityIR, step: string): string {
  return `Transition${typeName(entity)}${exported(step)}`;
}

/**
 * The call that runs the action's statement on the row with that id through `db`: it answers the row as it now is,
 * or nil when the statement matched none.
 */
export function statementCall(ir: IR, action: ActionIR, db: string, id: string, now: string): string {
  const entity = entityByName(ir, action.entity!);
  if (action.builtin === "transition")
    return `rowactions.${transitionFunc(entity, transitionOf(ir, action).name)}(ctx, ${db}, ${id}, ${now})`;
  return `rowactions.${archiveFunc(entity)}(ctx, ${db}, ${id}, ${action.builtin === "archive"}, ${now})`;
}

function goRaw(text: string): string {
  return "`" + text + "`";
}

/** generated/rowactions/rowactions.go */
export function rowActionsFile(ir: IR, modulePath: string): string {
  const actions = statementActions(ir);
  const archiving = new Set(actions.filter(a => a.builtin !== "transition").map(a => a.entity!));
  const moving = new Set(actions.filter(a => a.builtin === "transition").map(a => a.entity!));
  const sections: string[] = [];
  sections.push(`// Querier is what a statement runs through: the pool, a request's scope or the system's.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}`);
  for (const entity of ir.entities) {
    if (!archiving.has(entity.name) && !moving.has(entity.name)) continue;
    const T = typeName(entity);
    const pk = singlePrimaryKey(entity);
    const id = quoteIdent(pk.name);
    const table = `models.${tableConst(entity)}`;
    const columns = `models.${columnsConst(entity)}`;
    const one = `one${T}`;
    sections.push(`// ${one} reads the row a conditional update returned; nil when it matched none.
func ${one}(row pgx.Row) (*models.${T}, error) {
	result, err := models.${scanFunc(entity)}(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return result, err
}`);
    if (archiving.has(entity.name)) {
      const column = quoteIdent(entity.archive!.column);
      sections.push(`// ${archiveFunc(entity)} is archive and restore of a ${T} row: it sets ${entity.archive!.column} on a live row or clears it on an
// archived one, in one statement. Nil when there was nothing to do: the row is archived already, or is not, or went
// meanwhile.
func ${archiveFunc(entity)}(ctx context.Context, db Querier, id ${rowGoType(pk)}, archived bool, now time.Time) (*models.${T}, error) {
	if archived {
		return ${one}(db.QueryRow(ctx, ${goRaw("UPDATE ")}+${table}+${goRaw(` SET ${column} = $2 WHERE ${id} = $1 AND ${column} IS NULL RETURNING `)}+${columns}, id, now))
	}
	return ${one}(db.QueryRow(ctx, ${goRaw("UPDATE ")}+${table}+${goRaw(` SET ${column} = NULL WHERE ${id} = $1 AND ${column} IS NOT NULL RETURNING `)}+${columns}, id))
}`);
    }
    if (moving.has(entity.name)) {
      const machine = entity.transitions!;
      const column = quoteIdent(machine.column);
      for (const step of machine.steps) {
        const fn = transitionFunc(entity, step.name);
        const set = step.stamp ? `${column} = $2, ${quoteIdent(step.stamp)} = $4` : `${column} = $2`;
        const args = [`id`, q(step.to), `[]string{${step.from.map(q).join(", ")}}`, ...(step.stamp ? ["now"] : [])];
        sections.push(`// ${fn} is the ${step.name} transition of a ${T} row: ${machine.column} from ${step.from.join(" or ")} to ${step.to}${step.stamp ? `, stamping ${step.stamp}` : ""}, in one
// conditional update. Nil when the row's ${machine.column} is not one it starts from, or the row went meanwhile.
func ${fn}(ctx context.Context, db Querier, id ${rowGoType(pk)}, now time.Time) (*models.${T}, error) {${step.stamp ? "" : "\n\t_ = now"}
	return ${one}(db.QueryRow(ctx, ${goRaw("UPDATE ")}+${table}+${goRaw(` SET ${set} WHERE ${id} = $1 AND ${column}::text = ANY($3) RETURNING `)}+${columns}, ${args.join(", ")}))
}`);
      }
    }
  }
  return goFile(
    modulePath,
    HEADER(
      "The compiler's own row actions: archive, restore and the transitions. Each is one conditional update, so of two callers at once one changes the row and the other is told. Request handlers call them after the rule; timers call them as the system."
    ),
    "rowactions",
    ["context", "errors", "time", "github.com/jackc/pgx/v5", `${modulePath}/generated/models`],
    sections.join("\n\n")
  );
}
