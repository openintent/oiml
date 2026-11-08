import type { ActionIR, EventIR, GeneratedFile, IR } from "@osl/core";
import { actionResultType } from "./actions.js";
import { publicType } from "./models.js";
import { HEADER, SCAFFOLD_HEADER, entityByName, eventIdent, goFile, packageName, q } from "./util.js";

/** Name of the dispatch function for an event: ArticleCreated, PostsPublish, ActionsSendDigest */
export function eventFunc(event: EventIR): string {
  return eventIdent(event.name);
}

/** The action an action event belongs to */
function actionOf(ir: IR, event: EventIR): ActionIR {
  const action = ir.actions.find(
    a => a.name === event.actionName && (a.resource ?? undefined) === (event.resource ?? undefined)
  );
  if (!action) throw new Error(`event ${event.name} names no action`);
  return action;
}

/** The Go type of an event's payload (the presented row, or the action's presented result), with the package it needs */
export function payloadType(ir: IR, event: EventIR): { type: string; pkg: "models" | "actions" | null } {
  if (event.kind === "entity") return { type: `models.${publicType(entityByName(ir, event.entity!))}`, pkg: "models" };
  const action = actionOf(ir, event);
  if (action.returns.kind === "entity")
    return { type: `models.${publicType(entityByName(ir, action.entity!))}`, pkg: "models" };
  if (action.returns.kind === "none") return { type: "struct{}", pkg: null };
  return { type: `actions.${actionResultType(action)}`, pkg: "actions" };
}

/** generated/events/events.go: one dispatch function per event name, inline handlers now and queued ones through a job. */
export function eventsFile(ir: IR, modulePath: string): string {
  if (ir.events.length === 0) {
    return goFile(modulePath, HEADER("Event dispatch. The model declares no events."), "events", [], "");
  }
  const names = [...new Set(ir.events.map(e => e.name))].sort();
  const handlers = [...new Set(ir.events.map(e => e.handler))].sort();
  const imports = new Set<string>(["context"]);
  for (const h of handlers) imports.add(`${packageName(h)} ${modulePath}/src/events/${h}`);
  const queuedNames = names.filter(n => ir.events.some(e => e.name === n && e.delivery === "queue"));
  if (queuedNames.length) {
    imports.add("encoding/json");
    imports.add("errors");
    imports.add(`${modulePath}/generated/jobs`);
  }
  const sections: string[] = [];
  for (const name of names) {
    const events = ir.events.filter(e => e.name === name);
    const payload = payloadType(ir, events[0]);
    if (payload.pkg) imports.add(`${modulePath}/generated/${payload.pkg}`);
    const inline = events.filter(e => e.delivery === "inline");
    const queued = events.filter(e => e.delivery === "queue");
    const calls = inline.map(
      e => `\tif err := ${packageName(e.handler)}.Handle(payload); err != nil {\n\t\treturn err\n\t}`
    );
    if (queued.length) calls.push(`\treturn jobs.Enqueue(ctx, ${q(name)}, payload)`);
    else calls.push("\treturn nil");
    sections.push(`// ${eventFunc(events[0])} runs every handler for ${name}: inline ones in the request (an error aborts it)${queued.length ? ", queued ones through a job" : ""}.
func ${eventFunc(events[0])}(ctx context.Context, payload ${payload.type}) error {
${calls.join("\n")}
}`);
  }
  if (queuedNames.length) {
    const cases = queuedNames.map(name => {
      const events = ir.events.filter(e => e.name === name && e.delivery === "queue");
      const payload = payloadType(ir, events[0]);
      const calls = events.map(
        e => `\t\tif err := ${packageName(e.handler)}.Handle(payload); err != nil {\n\t\t\treturn err\n\t\t}`
      );
      return `\tcase ${q(name)}:
		var payload ${payload.type}
		if err := json.Unmarshal(raw, &payload); err != nil {
			return err
		}
${calls.join("\n")}
		return nil`;
    });
    sections.push(`// RunQueued runs the queued handlers of an event from its stored payload; the worker calls it for each job.
func RunQueued(ctx context.Context, name string, raw json.RawMessage) error {
	_ = ctx
	switch name {
${cases.join("\n")}
	}
	return errors.New("unknown queued event " + name)
}`);
  }
  return goFile(
    modulePath,
    HEADER("Event dispatch. Handlers live in src/events and are yours."),
    "events",
    imports,
    sections.join("\n\n")
  );
}

/** src/events/<handler>/handler.go: one user-owned scaffold per handler. */
export function eventHandlerScaffolds(ir: IR, modulePath: string): GeneratedFile[] {
  const handlers = [...new Set(ir.events.map(e => e.handler))].sort();
  return handlers.map(handler => {
    const event = ir.events.find(e => e.handler === handler)!;
    const payload = payloadType(ir, event);
    const what = event.kind === "entity" ? `${event.entity} is ${event.action}` : `the ${event.name} action ran`;
    return {
      path: `src/events/${handler}/handler.go`,
      mode: "scaffold" as const,
      content: goFile(
        modulePath,
        SCAFFOLD_HEADER(
          `Handler ${handler}, run on ${event.name}${event.delivery === "queue" ? " as a background job" : ""}.`
        ),
        packageName(handler),
        payload.pkg ? [`${modulePath}/generated/${payload.pkg}`] : [],
        `// Handle runs after ${what}. Replace this with your logic.
func Handle(payload ${payload.type}) error {
	_ = payload
	return nil
}
`
      )
    };
  });
}
