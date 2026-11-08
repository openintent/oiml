import type { ActionIR, GeneratedFile, IR } from "@osl/core";
import { entityByName, q, typeName, type TsConventions } from "./conventions.js";

/** The TS type of an event's payload, in terms of present.ts types */
function payloadType(ir: IR, name: string): string {
  const event = ir.events.find(e => e.name === name)!;
  if (event.kind === "entity") return `Public${typeName(entityByName(ir, event.entity!))}`;
  const action = ir.actions.find(a => a.name === event.actionName && a.resource === event.resource) as ActionIR;
  if (action.returns.kind === "entity") return `Public${typeName(entityByName(ir, action.entity!))}`;
  if (action.returns.kind === "none") return "Record<string, never>";
  return `{ ${action.returns.fields.map(f => `${f.name}: ${tsType(f)}`).join("; ")} }`;
}

function tsType(f: ActionIR["input"][number]): string {
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
    default:
      return "string";
  }
}

/** generated/events.ts plus one scaffold per handler under src/events. Queued events go through jobs.ts. */
export function eventFiles(ir: IR, conv: TsConventions): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const handlers = [...new Set(ir.events.map(e => e.handler))].sort();
  const byName = new Map<string, { inline: string[]; queued: string[] }>();
  for (const e of ir.events) {
    const entry = byName.get(e.name) ?? byName.set(e.name, { inline: [], queued: [] }).get(e.name)!;
    (e.delivery === "queue" ? entry.queued : entry.inline).push(e.handler);
  }
  const names = [...byName.keys()].sort();
  const queued = names.filter(n => byName.get(n)!.queued.length > 0);
  const presentTypes = [...new Set(names.map(n => payloadType(ir, n)).filter(t => t.startsWith("Public")))].sort();

  files.push({
    path: "generated/events.ts",
    content: `${conv.header("Event dispatch. Handlers live in src/events and are yours.")}
${presentTypes.length ? `import type { ${presentTypes.join(", ")} } from "./present";` : ""}
${handlers.map(h => `import * as ${h} from "${conv.src(`events/${h}`)}";`).join("\n")}
${queued.length ? `import { enqueue } from "./jobs";` : ""}

export type EventPayloads = {
${names.map(n => `  ${q(n)}: ${payloadType(ir, n)};`).join("\n")}
};

type Handler<K extends keyof EventPayloads> = (payload: EventPayloads[K]) => Promise<void> | void;

/** Handlers run in the request, before it answers */
const inline: { [K in keyof EventPayloads]: Handler<K>[] } = {
${names
  .map(
    n =>
      `  ${q(n)}: [${byName
        .get(n)!
        .inline.map(h => `${h}.handler`)
        .join(", ")}]`
  )
  .join(",\n")}
};

/** Handlers run by the worker from a job in the database, with retries */
const queued: { [K in keyof EventPayloads]: Handler<K>[] } = {
${names
  .map(
    n =>
      `  ${q(n)}: [${byName
        .get(n)!
        .queued.map(h => `${h}.handler`)
        .join(", ")}]`
  )
  .join(",\n")}
};

/** Events with at least one queued handler; the queue has one queue per name */
export const QUEUED_EVENTS: (keyof EventPayloads)[] = [${queued.map(q).join(", ")}];

/** Run the inline handlers now and enqueue the rest. Errors from inline handlers propagate to the request. */
export async function emit<K extends keyof EventPayloads>(name: K, payload: EventPayloads[K]): Promise<void> {
  for (const handler of inline[name]) await handler(payload);
  ${queued.length ? "if (queued[name].length) await enqueue(name, payload);" : "void queued;"}
}

/** Run the queued handlers of an event; the worker calls this for each job */
export async function runQueued(name: string, payload: unknown): Promise<void> {
  const handlers = (queued as Record<string, Handler<keyof EventPayloads>[]>)[name] ?? [];
  for (const handler of handlers) await handler(payload as never);
}
`
  });
  for (const handler of handlers) {
    const event = ir.events.find(e => e.handler === handler)!;
    const what = event.kind === "entity" ? `${event.entity} is ${event.action}` : `the ${event.name} action ran`;
    files.push({
      path: `src/events/${handler}.ts`,
      mode: "scaffold",
      content: `${conv.scaffoldHeader(`Handler ${handler}, run on ${event.name}${event.delivery === "queue" ? " as a background job" : ""}.`)}
import type { EventPayloads } from "${conv.generated("events")}";

export async function handler(payload: EventPayloads[${q(event.name)}]): Promise<void> {
  // Runs after ${what}. Replace this with your logic.
  void payload;
}
`
    });
  }
  return files;
}
