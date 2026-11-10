/**
 * Scenario steps checked against the compiled model: a step that expects what the model it belongs to can never do.
 * Three contradictions, each an error the proposer's retry and `osl apply` see like any other diagnostic:
 *
 * - M078, a step that expects success sends a body key the operation does not accept (bound to the session,
 *   read-only, hidden, not listed, unknown): the strict input refuses it with 400.
 * - M078, a step that expects success expects a key in the answer that the answer never carries (not a field of the
 *   output, a relation the operation does not include, a field no caller may read).
 * - M079, a step that expects 400 sends a body that every declared constraint accepts, on an operation whose 400s
 *   are all known statically.
 *
 * Each check is conservative: a false positive blocks a valid model, a miss only leaves a scenario to fail at run
 * time. A step that expects a 4xx is never held to the first two (sending a read-only key to see 400 is a correct
 * scenario), and the third skips every operation and value whose answer it cannot predict exactly.
 */
import type { ActionIR, ColumnIR, EntityIR, IR, OperationIR, ResourceIR, StepIR } from "./ir.js";
import { compileValid } from "./ir.js";
import type { Diagnostic, Model } from "./model.js";

/** The contradictions between the model's scenarios and what the model compiles to; [] when it does not compile */
export function scenarioContradictions(model: Model): Diagnostic[] {
  let ir: IR;
  try {
    ir = compileValid(model);
  } catch {
    // Another check's business: this one only reads a model that compiles
    return [];
  }
  const out: Diagnostic[] = [];
  for (const [si, scenario] of ir.examples.scenarios.entries())
    for (const [ti, step] of scenario.steps.entries()) {
      const where = `examples.scenarios[${si}].steps[${ti}]`;
      for (const message of stepProblems(ir, model, step)) out.push({ level: "error", ...message, path: where });
    }
  return out;
}

type Problem = { code: "M078" | "M079"; message: string };

function stepProblems(ir: IR, model: Model, step: StepIR): Problem[] {
  const status = step.expect.status;
  const target = targetOf(ir, step);
  if (!target) return [];
  if (status >= 200 && status < 300) return [...sentKeys(step, target), ...expectedKeys(ir, step, target)];
  if (status === 400) return refusedBody(ir, model, step, target);
  return [];
}

type Target =
  | { kind: "resource"; resource: ResourceIR; entity: EntityIR; op: OperationIR }
  | { kind: "action"; action: ActionIR; entity?: EntityIR };

function targetOf(ir: IR, step: StepIR): Target | undefined {
  if (step.kind === "resource") {
    const resource = ir.resources.find(r => r.name === step.resource);
    const op = resource?.operations.find(o => o.kind === step.operation);
    const entity = resource && ir.entities.find(e => e.name === resource.entity);
    return resource && op && entity ? { kind: "resource", resource, entity, op } : undefined;
  }
  if (step.kind === "action") {
    const action = ir.actions.find(a => a.name === step.operation && a.resource === step.resource);
    if (!action) return undefined;
    return { kind: "action", action, entity: ir.entities.find(e => e.name === action.entity) };
  }
  return undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const list = (names: string[]) => names.join(", ") || "none";

/** Check 1: a step that expects success sends only keys the operation's input accepts */
function sentKeys(step: StepIR, target: Target): Problem[] {
  if (!isObject(step.body)) return [];
  const out: Problem[] = [];
  if (target.kind === "action") {
    // A row action's id is its path; over tRPC the id rides in the input beside the body, so one there is taken
    const accepted = target.action.input.map(c => c.name);
    for (const key of Object.keys(step.body))
      if (!accepted.includes(key) && !(key === "id" && target.action.scope === "row"))
        out.push({
          code: "M078",
          message: `${step.op} takes no input ${key} (its input: ${list(accepted)}), so this step answers 400, not ${step.expect.status}: drop ${key} from the body, or add it to the action's input`
        });
    return out;
  }
  const { op, entity, resource } = target;
  if (op.kind !== "create" && op.kind !== "update") return [];
  for (const key of Object.keys(step.body)) {
    if (op.fields.includes(key)) continue;
    out.push({
      code: "M078",
      message: `${step.op} does not accept ${key}, so this step answers 400, not ${step.expect.status}: ${whyNotAccepted(resource, entity, op, key)}`
    });
  }
  return out;
}

/** Why a create or update input leaves `key` out, and what the step should do instead */
function whyNotAccepted(
  resource: ResourceIR,
  entity: EntityIR,
  op: Extract<OperationIR, { kind: "create" | "update" }>,
  key: string
): string {
  const column = entity.columns.find(c => c.name === key);
  const drop = `drop ${key} from the body`;
  if (!column) {
    const relation = entity.relations.find(r => r.name === key && r.direction === "forward");
    if (relation) return `${key} is a relation, not a field; send ${relation.column} instead`;
    return `${entity.name} has no field ${key} (${op.kind} accepts ${list(op.fields)}); ${drop}`;
  }
  if (op.kind === "create" && op.ownerField === key)
    return `the create rule binds ${key} to the session (a plain owner:${key}), so the row is the caller's and the input never takes it; ${drop}, or, if a client must name someone else, write the create rule without a plain owner:${key} part`;
  if (column.primary) return `${key} is the primary key, which the server assigns; ${drop}`;
  if (column.hidden) return `${key} is hidden: never accepted from a client nor returned; ${drop}`;
  if (column.sequence) return `${key} is a sequence the database numbers; ${drop}`;
  if (column.count) return `${key} is a count the database keeps; ${drop}`;
  if (column.position)
    return `${key} is the row's place, which ${resource.name}.move changes; ${drop}, or call the move action`;
  if (entity.archive?.column === key)
    return `${key} is set by ${resource.name}.archive and restore; ${drop}, or call the action`;
  if (entity.transitions?.column === key)
    return `${key} moves only through its transitions (${entity.transitions.steps.map(s => `${resource.name}.${s.name}`).join(", ")}); ${drop}, or call the transition`;
  if ((entity.transitions?.steps ?? []).some(s => s.stamp === key)) return `${key} is stamped by a transition; ${drop}`;
  if (column.readOnly) return `${key} is read_only: the server or a handler sets it, never a client; ${drop}`;
  if (op.kind === "update" && entity.order?.within === key)
    return `an ordered row keeps its parent ${key}, so update never takes it; ${drop}`;
  if (op.kind === "update" && (entity.sequences ?? []).some(s => s.scope.includes(key)))
    return `a numbered row keeps the scope its number was counted in, so update never takes ${key}; ${drop}`;
  if (op.kind === "update" && ruleOwnerKeptOut(entity, key))
    return `the update rule's plain owner:${key} keeps ${key} out of update, so a row is never handed to someone else; ${drop}`;
  return `${resource.name}.${op.kind}.fields does not list it (it lists ${list(op.fields)}); ${drop}, or list it there`;
}

/** Whether an update rule that is one plain owner predicate keeps its owner column out of update */
function ruleOwnerKeptOut(entity: EntityIR, key: string): boolean {
  const rule = entity.rules.update;
  return rule.kind === "owner" && !rule.via && rule.field === key;
}

interface AnswerShape {
  entity: EntityIR;
  /** The row's columns an answer carries (hidden and bytes columns never are) */
  keys: Set<string>;
  /** The relations it embeds: a get's or a list's include, and relations through a junction */
  includes: Set<string>;
  /** A list: `data` is an array of rows */
  many: boolean;
}

/** The keys a row in the answer can carry; undefined when the answer is not a row the check can read */
function answerShape(ir: IR, target: Target): AnswerShape | undefined {
  if (target.kind === "resource") {
    const { op, entity, resource } = target;
    if (op.kind === "delete") return undefined;
    // A create and an update answer the row bare, without the relations a get includes
    const includes = op.kind === "get" || op.kind === "list" ? [...op.include, ...(op.through ?? [])] : [];
    return { entity, keys: new Set(resource.outputFields), includes: new Set(includes), many: op.kind === "list" };
  }
  // A row action that returns the row presents it as an update does; fields a handler returns are the handler's
  const { action, entity } = target;
  const resource = ir.resources.find(r => r.name === action.resource);
  if (action.returns.kind !== "entity" || !entity || !resource) return undefined;
  return { entity, keys: new Set(resource.outputFields), includes: new Set(), many: false };
}

/** Check 2: a step that expects success expects only keys its answer can carry */
function expectedKeys(ir: IR, step: StepIR, target: Target): Problem[] {
  const body = step.expect.body;
  if (!isObject(body) || !("data" in body)) return [];
  const shape = answerShape(ir, target);
  if (!shape) return [];
  const rows = shape.many ? (Array.isArray(body.data) ? body.data : []) : [body.data];
  const missing = new Set<string>();
  for (const row of rows) {
    if (!isObject(row)) continue;
    for (const key of Object.keys(row)) if (!carried(shape, key)) missing.add(key);
  }
  return [...missing].map(key => ({
    code: "M078" as const,
    message: `${step.op} answers ${shape.entity.name} rows without ${key}: ${whyNotCarried(shape, target, key)}, so this step's expected body can never match`
  }));
}

function carried(shape: AnswerShape, key: string): boolean {
  if (shape.includes.has(key)) return true;
  if (!shape.keys.has(key)) return false;
  // A field whose read rule is none is in no caller's answer
  const column = shape.entity.columns.find(c => c.name === key);
  return column?.read?.kind !== "none";
}

function whyNotCarried(shape: AnswerShape, target: Target, key: string): string {
  const { entity } = shape;
  const column = entity.columns.find(c => c.name === key);
  const relation = entity.relations.find(r => r.name === key);
  const through = (entity.through ?? []).find(t => t.name === key);
  const operation = target.kind === "resource" ? target.op.kind : "action";
  const instead =
    relation?.direction === "forward" ? `expect ${relation.column} instead` : "drop it from the expected body";
  if (column?.hidden) return `${key} is hidden, never in an answer; drop it from the expected body`;
  if (column?.read?.kind === "none")
    return `${key}'s read rule is none, so no caller gets it back; drop it from the expected body`;
  if (relation || through) {
    if (target.kind === "resource" && (operation === "get" || operation === "list"))
      return `${key} is a relation that ${target.resource.name}.${operation} does not include; add it to ${operation}.include of ${target.resource.name}, or ${instead}`;
    return `a ${operation === "action" ? "row action" : operation} answers the row without its relations; ${instead}, or read it with a get that includes ${key}`;
  }
  return `${entity.name} has no field ${key}; drop it from the expected body`;
}

/**
 * Check 3: a step that expects 400 must send a body some declared constraint refuses. Held only where every 400 of the
 * operation is known statically: a resource create or update with no inline event, whose body names only fields it
 * accepts, carries every field a create requires, and holds literal values of kinds whose checks are exact (strings,
 * integers, floats, booleans, enum values). Anything else (a relation, whose row may be missing; a file; json, money,
 * dates; a pattern or format; a template; an enum a shape or a currency follows) may be refused in ways this check
 * does not predict, so the step is left alone. And only a step that names a field with a declared length or range
 * is held: one that does not may be counting on a hook of the developer's.
 */
function refusedBody(ir: IR, model: Model, step: StepIR, target: Target): Problem[] {
  if (target.kind !== "resource") return [];
  const { op, entity } = target;
  if (op.kind !== "create" && op.kind !== "update") return [];
  if (op.kind === "create" && op.invite) return [];
  const body = step.body;
  if (!isObject(body) || Object.keys(body).length === 0) return [];
  if (JSON.stringify(body).match(/\{[A-Za-z0-9_.+-]+\}/)) return [];
  const happened = op.kind === "create" ? "created" : "updated";
  if (
    ir.events.some(
      e => e.delivery === "inline" && e.kind === "entity" && e.entity === entity.name && e.action === happened
    )
  )
    return [];
  const guards = new Set([
    ...entity.columns.flatMap(c => (c.shapeBy ? [c.shapeBy.column] : [])),
    ...entity.columns.flatMap(c => (c.money?.currencyField ? [c.money.currencyField] : []))
  ]);
  const declared = model.entities[entity.name]?.fields ?? {};
  // Whether the body names a field with a declared length or range, which the step evidently means to test
  let bounded = false;
  const accepted: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (!op.fields.includes(key) || guards.has(key)) return [];
    const column = entity.columns.find(c => c.name === key);
    if (!column) return [];
    const verdict = judge(ir, column, value);
    if (verdict === "unknown" || verdict === "refused") return [];
    accepted.push(verdict);
    const field = declared[key];
    const v = field?.validate ?? {};
    if (
      field &&
      (field.max_length !== undefined ||
        v.max_length !== undefined ||
        v.min_length !== undefined ||
        v.min !== undefined ||
        v.max !== undefined)
    )
      bounded = true;
  }
  if (!bounded) return [];
  if (op.kind === "create") {
    const missing = op.fields.filter(f => {
      const c = entity.columns.find(col => col.name === f);
      return c && !c.nullable && c.default === undefined && !c.generated && !(f in body);
    });
    if (missing.length) return [];
  }
  return [
    {
      code: "M079",
      message: `this step expects 400, but ${step.op} accepts every value it sends (${accepted.join("; ")}) and nothing else in it can answer 400, so the server answers ${op.kind === "create" ? 201 : 200}: send a value its declared limit refuses, or expect the success`
    }
  ];
}

/** What a body value does against a column's declared checks: refused, accepted (with a note), or unknown */
function judge(ir: IR, column: ColumnIR, value: unknown): "unknown" | "refused" | string {
  const name = column.name;
  if (column.relation || column.sealed || column.shape || column.shapeBy || column.money) return "unknown";
  if (value === null) return column.nullable ? `${name}: null` : "refused";
  const v = column.validate ?? {};
  if (column.type.kind === "enum") {
    const enumName = column.type.name;
    const values = ir.enums.find(e => e.name === enumName)?.values ?? column.enumValues ?? [];
    return typeof value === "string" && values.includes(value) ? `${name}: ${value}, one of its values` : "refused";
  }
  if (column.type.kind !== "scalar") return "unknown";
  switch (column.type.scalar) {
    case "string":
    case "text": {
      if (typeof value !== "string") return "refused";
      // Lengths are counted alike everywhere only for ASCII; a pattern or a format is another engine's to judge
      if (!/^[\x20-\x7e]*$/.test(value) || v.pattern !== undefined || v.format !== undefined) return "unknown";
      const limits = [v.max_length, column.type.scalar === "string" ? (column.maxLength ?? 255) : undefined].filter(
        (n): n is number => n !== undefined
      );
      const max = limits.length ? Math.min(...limits) : undefined;
      if (v.min_length !== undefined && value.length < v.min_length) return "refused";
      if (max !== undefined && value.length > max) return "refused";
      // A text field's own max_length is carried in the IR but checked by no backend: only validate's is
      const unchecked =
        column.type.scalar === "text" && column.maxLength !== undefined && v.max_length === undefined
          ? " (max_length is not checked on a text field: give it validate: { max_length } instead)"
          : "";
      return `${name}: ${value.length} characters${max !== undefined ? `, within its max_length of ${max}` : ""}${v.min_length !== undefined ? ` and min_length of ${v.min_length}` : ""}${unchecked}`;
    }
    case "integer":
    case "float": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "refused";
      if (column.type.scalar === "integer" && (!Number.isInteger(value) || Math.abs(value) > 2147483647))
        return "refused";
      if ((v.min !== undefined && value < v.min) || (v.max !== undefined && value > v.max)) return "refused";
      return `${name}: ${value}${v.min !== undefined || v.max !== undefined ? `, within ${v.min ?? "-"} to ${v.max ?? "-"}` : ""}`;
    }
    case "boolean":
      return typeof value === "boolean" ? `${name}: ${value}` : "refused";
    default:
      return "unknown";
  }
}
