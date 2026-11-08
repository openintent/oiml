/**
 * A model diff is the reviewed artifact of an intent: a list of typed operations
 * that `osl apply` folds into `.osl/model.yaml`. Applying is a pure function.
 */
import { z } from "zod";
import {
  Action,
  Actor,
  App,
  Auth,
  Entity,
  Event,
  Field,
  Files,
  Index,
  Model,
  Page,
  Resource,
  Rules,
  Scenario,
  SeedStep,
  Sidebar,
  type Model as ModelType
} from "./model.js";

const Identifier = z.string().regex(/^[a-z][a-z0-9_]*$/);
const EntityName = z.string().regex(/^[A-Z][A-Za-z0-9]*$/);

export const DiffOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_description"), description: z.string() }).strict(),
  z.object({ op: z.literal("add_entity"), name: EntityName, entity: Entity }).strict(),
  z.object({ op: z.literal("remove_entity"), name: EntityName }).strict(),
  z.object({ op: z.literal("rename_entity"), from: EntityName, to: EntityName }).strict(),
  z.object({ op: z.literal("add_field"), entity: EntityName, name: Identifier, field: Field }).strict(),
  z.object({ op: z.literal("update_field"), entity: EntityName, name: Identifier, field: Field }).strict(),
  z.object({ op: z.literal("remove_field"), entity: EntityName, name: Identifier }).strict(),
  z.object({ op: z.literal("rename_field"), entity: EntityName, from: Identifier, to: Identifier }).strict(),
  z.object({ op: z.literal("set_rules"), entity: EntityName, rules: Rules }).strict(),
  z
    .object({
      op: z.literal("set_indexes"),
      entity: EntityName,
      indexes: z.array(Index).optional(),
      unique: z.array(z.array(Identifier).min(1)).optional()
    })
    .strict(),
  z.object({ op: z.literal("add_resource"), name: Identifier, resource: Resource }).strict(),
  z.object({ op: z.literal("update_resource"), name: Identifier, resource: Resource }).strict(),
  z.object({ op: z.literal("remove_resource"), name: Identifier }).strict(),
  z.object({ op: z.literal("set_auth"), auth: Auth }).strict(),
  z.object({ op: z.literal("remove_auth") }).strict(),
  z.object({ op: z.literal("add_event"), event: Event }).strict(),
  z.object({ op: z.literal("remove_event"), on: z.string(), handler: Identifier }).strict(),
  z.object({ op: z.literal("set_actors"), actors: z.record(Identifier, Actor) }).strict(),
  z.object({ op: z.literal("add_scenario"), scenario: Scenario }).strict(),
  z.object({ op: z.literal("remove_scenario"), name: z.string() }).strict(),
  z.object({ op: z.literal("set_app"), app: App }).strict(),
  z.object({ op: z.literal("remove_app") }).strict(),
  z.object({ op: z.literal("add_page"), name: Identifier, page: Page }).strict(),
  z.object({ op: z.literal("update_page"), name: Identifier, page: Page }).strict(),
  z.object({ op: z.literal("remove_page"), name: Identifier }).strict(),
  z.object({ op: z.literal("set_sidebar"), sidebar: Sidebar }).strict(),
  /** resource: a resource's action; omitted: a global one */
  z.object({ op: z.literal("add_action"), resource: Identifier.optional(), name: Identifier, action: Action }).strict(),
  z
    .object({ op: z.literal("update_action"), resource: Identifier.optional(), name: Identifier, action: Action })
    .strict(),
  z.object({ op: z.literal("remove_action"), resource: Identifier.optional(), name: Identifier }).strict(),
  z.object({ op: z.literal("set_seed"), seed: z.array(SeedStep) }).strict(),
  z.object({ op: z.literal("set_files"), files: Files }).strict(),
  z.object({ op: z.literal("remove_files") }).strict()
]);
export type DiffOp = z.infer<typeof DiffOp>;

export const Diff = z
  .object({
    osl: z.literal("1.0"),
    /** One line on what the change does, shown in reviews */
    summary: z.string().optional(),
    ops: z.array(DiffOp).min(1)
  })
  .strict();
export type Diff = z.infer<typeof Diff>;

/** Renames recorded for a revision so migrations emit RENAME instead of DROP and ADD. */
export interface Renames {
  entities: Record<string, string>;
  /** keyed by the entity's name after the revision */
  fields: Record<string, Record<string, string>>;
}

export class DiffError extends Error {
  constructor(
    message: string,
    public readonly opIndex: number
  ) {
    super(message);
    this.name = "DiffError";
  }
}

export interface ApplyResult {
  model: ModelType;
  renames: Renames;
}

/** Fold a diff into a model. Returns a new model; neither the input model nor the diff is mutated. */
export function applyDiff(input: ModelType, diff: Diff): ApplyResult {
  const model: ModelType = structuredClone(input);
  const renames: Renames = { entities: {}, fields: {} };
  // Ops are installed into the model by reference (add_entity, update_resource...), and later ops write
  // through them (add_action fills a resource's actions), so work on a copy or the diff changes as it applies
  const ops = structuredClone(diff.ops);

  ops.forEach((op, index) => {
    const fail = (message: string): never => {
      throw new DiffError(`op ${index} ${op.op}: ${message}`, index);
    };
    const entityOf = (name: string): Entity => model.entities[name] ?? fail(`entity ${name} does not exist`);

    switch (op.op) {
      case "set_description":
        model.description = op.description;
        break;

      case "add_entity":
        if (model.entities[op.name]) fail(`entity ${op.name} already exists`);
        model.entities[op.name] = op.entity;
        break;

      case "remove_entity": {
        entityOf(op.name);
        for (const [otherName, other] of Object.entries(model.entities)) {
          if (otherName === op.name) continue;
          for (const [fieldName, field] of Object.entries(other.fields)) {
            if (field.relation?.entity === op.name)
              fail(`${otherName}.${fieldName} still references ${op.name}; remove that field first`);
          }
        }
        for (const [resourceName, resource] of Object.entries(model.resources)) {
          if (resource.entity === op.name) fail(`resource ${resourceName} still uses ${op.name}; remove it first`);
        }
        if (model.auth?.identity === op.name) fail(`${op.name} is the auth identity; remove auth first`);
        model.events = model.events.filter(e => e.on.split(".")[0] !== op.name);
        delete model.entities[op.name];
        break;
      }

      case "rename_entity": {
        const entity = entityOf(op.from);
        if (model.entities[op.to]) fail(`entity ${op.to} already exists`);
        const rebuilt: Record<string, Entity> = {};
        for (const [name, value] of Object.entries(model.entities)) rebuilt[name === op.from ? op.to : name] = value;
        model.entities = rebuilt;
        void entity;
        for (const other of Object.values(model.entities)) {
          for (const field of Object.values(other.fields))
            if (field.relation?.entity === op.from) field.relation.entity = op.to;
        }
        for (const resource of Object.values(model.resources)) if (resource.entity === op.from) resource.entity = op.to;
        for (const event of model.events) {
          const [entityName, action] = event.on.split(".");
          if (entityName === op.from) event.on = `${op.to}.${action}`;
        }
        if (model.auth?.identity === op.from) model.auth.identity = op.to;
        const previous = Object.entries(renames.entities).find(([, to]) => to === op.from);
        if (previous) {
          renames.entities[previous[0]] = op.to;
        } else renames.entities[op.from] = op.to;
        if (renames.fields[op.from]) {
          renames.fields[op.to] = renames.fields[op.from];
          delete renames.fields[op.from];
        }
        break;
      }

      case "add_field": {
        const entity = entityOf(op.entity);
        if (entity.fields[op.name]) fail(`field ${op.entity}.${op.name} already exists`);
        entity.fields[op.name] = op.field;
        break;
      }

      case "update_field": {
        const entity = entityOf(op.entity);
        if (!entity.fields[op.name]) fail(`field ${op.entity}.${op.name} does not exist`);
        entity.fields[op.name] = op.field;
        break;
      }

      case "remove_field": {
        const entity = entityOf(op.entity);
        if (!entity.fields[op.name]) fail(`field ${op.entity}.${op.name} does not exist`);
        if (entity.fields[op.name].primary) fail(`cannot remove primary key field ${op.name}`);
        delete entity.fields[op.name];
        entity.indexes = entity.indexes?.filter(i => !i.fields.includes(op.name));
        entity.unique = entity.unique?.filter(cols => !cols.includes(op.name));
        for (const action of ["read", "create", "update", "delete"] as const) {
          if (entity.rules?.[action] === `owner:${op.name}`)
            fail(`rule ${action} still uses owner:${op.name}; change the rules first`);
        }
        for (const [resourceName, resource] of Object.entries(model.resources)) {
          if (resource.entity !== op.entity) continue;
          if (resource.list?.filters) resource.list.filters = resource.list.filters.filter(f => f !== op.name);
          if (resource.list?.order) resource.list.order = resource.list.order.filter(([f]) => f !== op.name);
          if (resource.create?.fields) resource.create.fields = resource.create.fields.filter(f => f !== op.name);
          if (resource.update?.fields) resource.update.fields = resource.update.fields.filter(f => f !== op.name);
          void resourceName;
        }
        for (const page of pagesOver(model, op.entity)) {
          if (page.columns) page.columns = page.columns.filter(f => f !== op.name);
          if (page.fields) page.fields = page.fields.filter(f => f !== op.name);
        }
        break;
      }

      case "rename_field": {
        const entity = entityOf(op.entity);
        if (!entity.fields[op.from]) fail(`field ${op.entity}.${op.from} does not exist`);
        if (entity.fields[op.to]) fail(`field ${op.entity}.${op.to} already exists`);
        const rebuilt: Record<string, Field> = {};
        for (const [name, value] of Object.entries(entity.fields)) rebuilt[name === op.from ? op.to : name] = value;
        entity.fields = rebuilt;
        const swap = (name: string) => (name === op.from ? op.to : name);
        entity.indexes = entity.indexes?.map(i => ({ ...i, fields: i.fields.map(swap) }));
        entity.unique = entity.unique?.map(cols => cols.map(swap));
        if (entity.rules) {
          for (const action of ["read", "create", "update", "delete"] as const) {
            if (entity.rules[action] === `owner:${op.from}`) entity.rules[action] = `owner:${op.to}`;
          }
        }
        for (const resource of Object.values(model.resources)) {
          if (resource.entity !== op.entity) continue;
          if (resource.list?.filters) resource.list.filters = resource.list.filters.map(swap);
          if (resource.list?.order) resource.list.order = resource.list.order.map(([f, d]) => [swap(f), d]);
          if (resource.create?.fields) resource.create.fields = resource.create.fields.map(swap);
          if (resource.update?.fields) resource.update.fields = resource.update.fields.map(swap);
        }
        for (const page of pagesOver(model, op.entity)) {
          if (page.columns) page.columns = page.columns.map(swap);
          if (page.fields) page.fields = page.fields.map(swap);
        }
        if (model.auth?.identity === op.entity && model.auth.email_field === op.from) model.auth.email_field = op.to;
        const forEntity = (renames.fields[op.entity] ??= {});
        const previous = Object.entries(forEntity).find(([, to]) => to === op.from);
        if (previous) forEntity[previous[0]] = op.to;
        else forEntity[op.from] = op.to;
        break;
      }

      case "set_rules":
        entityOf(op.entity).rules = op.rules;
        break;

      case "set_indexes": {
        const entity = entityOf(op.entity);
        entity.indexes = op.indexes;
        entity.unique = op.unique;
        break;
      }

      case "add_resource":
        if (model.resources[op.name]) fail(`resource ${op.name} already exists`);
        model.resources[op.name] = op.resource;
        break;

      case "update_resource":
        if (!model.resources[op.name]) fail(`resource ${op.name} does not exist`);
        model.resources[op.name] = op.resource;
        break;

      case "remove_resource": {
        if (!model.resources[op.name]) fail(`resource ${op.name} does not exist`);
        for (const [pageName, page] of Object.entries(model.app?.pages ?? {})) {
          if (page.resource === op.name) fail(`page ${pageName} still shows ${op.name}; remove the page first`);
        }
        delete model.resources[op.name];
        model.events = model.events.filter(e => !e.on.startsWith(`${op.name}.`));
        if (model.examples) {
          model.examples.scenarios = model.examples.scenarios.filter(
            s => !s.steps.some(step => step.op.startsWith(`${op.name}.`))
          );
          model.examples.seed = model.examples.seed.filter(step => !step.op.startsWith(`${op.name}.`));
        }
        break;
      }

      case "set_auth":
        model.auth = op.auth;
        break;

      case "remove_auth":
        delete model.auth;
        break;

      case "add_event":
        if (model.events.some(e => e.on === op.event.on && e.handler === op.event.handler))
          fail(`event already declared`);
        model.events.push(op.event);
        break;

      case "remove_event": {
        const before = model.events.length;
        model.events = model.events.filter(e => !(e.on === op.on && e.handler === op.handler));
        if (model.events.length === before) fail(`event ${op.on} -> ${op.handler} does not exist`);
        break;
      }

      case "set_actors":
        model.examples ??= { scenarios: [], seed: [] };
        model.examples.actors = op.actors;
        break;

      case "add_scenario":
        model.examples ??= { scenarios: [], seed: [] };
        if (model.examples.scenarios.some(s => s.name === op.scenario.name))
          fail(`scenario ${op.scenario.name} already exists`);
        model.examples.scenarios.push(op.scenario);
        break;

      case "remove_scenario": {
        if (!model.examples) fail(`no scenarios`);
        const before = model.examples!.scenarios.length;
        model.examples!.scenarios = model.examples!.scenarios.filter(s => s.name !== op.name);
        if (model.examples!.scenarios.length === before) fail(`scenario ${op.name} does not exist`);
        break;
      }

      case "set_app":
        model.app = op.app;
        break;

      case "remove_app":
        delete model.app;
        break;

      case "add_page":
        model.app ??= { pages: {} };
        if (model.app.pages[op.name]) fail(`page ${op.name} already exists`);
        model.app.pages[op.name] = op.page;
        break;

      case "update_page":
        if (!model.app?.pages[op.name]) fail(`page ${op.name} does not exist`);
        model.app!.pages[op.name] = op.page;
        break;

      case "remove_page": {
        if (!model.app?.pages[op.name]) fail(`page ${op.name} does not exist`);
        delete model.app!.pages[op.name];
        if (model.app!.sidebar) model.app!.sidebar.items = model.app!.sidebar.items.filter(i => i.page !== op.name);
        break;
      }

      case "set_sidebar":
        model.app ??= { pages: {} };
        model.app.sidebar = op.sidebar;
        break;

      case "add_action": {
        const actions = actionsOf(op.resource);
        if (actions[op.name]) fail(`action ${op.resource ? op.resource + "." : ""}${op.name} already exists`);
        actions[op.name] = op.action;
        break;
      }

      case "update_action": {
        const actions = actionsOf(op.resource);
        if (!actions[op.name]) fail(`action ${op.resource ? op.resource + "." : ""}${op.name} does not exist`);
        actions[op.name] = op.action;
        break;
      }

      case "remove_action": {
        const actions = actionsOf(op.resource);
        if (!actions[op.name]) fail(`action ${op.resource ? op.resource + "." : ""}${op.name} does not exist`);
        delete actions[op.name];
        const eventName = `${op.resource ?? "actions"}.${op.name}`;
        model.events = model.events.filter(e => e.on !== eventName);
        if (model.examples) {
          model.examples.scenarios = model.examples.scenarios.filter(s => !s.steps.some(step => step.op === eventName));
          model.examples.seed = model.examples.seed.filter(step => step.op !== eventName);
        }
        break;
      }

      case "set_seed":
        model.examples ??= { scenarios: [], seed: [] };
        model.examples.seed = op.seed;
        break;

      case "set_files":
        model.files = op.files;
        break;

      case "remove_files":
        delete model.files;
        break;
    }

    /** The map holding a resource's actions (created on demand) or the global ones */
    function actionsOf(resource: string | undefined): Record<string, Action> {
      if (!resource) return model.actions;
      const target = model.resources[resource] ?? fail(`resource ${resource} does not exist`);
      return (target.actions ??= {});
    }
  });

  // Re-parse so defaults are filled and the result is a valid Model shape
  return { model: Model.parse(model), renames };
}

/** Resource pages whose resource is over the entity */
function pagesOver(model: ModelType, entityName: string): Page[] {
  return Object.values(model.app?.pages ?? {}).filter(
    page => page.resource && model.resources[page.resource]?.entity === entityName
  );
}

export function parseDiff(input: unknown): Diff {
  return Diff.parse(input);
}
