/**
 * Expectation checks: what a correct diff must leave in the model, read from the model after the diff
 * is applied (and its IR, for rules and actions after defaults). Every failure is one line a reader can act on.
 */
import type { Diff, IR, Model, RuleIR } from "@osl/core";
import { archiveOf, compile, countLink, positionOf, ruleText as coreRuleText, throughRelation } from "@osl/core";
import { Expect as ExpectSchema, type Expect } from "./cases.js";

export interface Checked {
  base: Model;
  model: Model;
  ir: IR;
  diff: Diff;
}

export interface ScenarioMetrics {
  /** Scenarios the diff adds */
  scenarios: number;
  steps: number;
  /** Steps expecting a 4xx status */
  rejections: number;
  statuses: number[];
  /** Resources and actions the diff adds, and how many of them some new scenario step calls */
  added: string[];
  touched: string[];
  seed_steps: number;
}

const alts = (name: string): string[] => name.split("|").map(s => s.trim());

/** Equal after JSON normalisation; an absent boolean equals false and null, since the schema leaves booleans optional */
function looseEqual(actual: unknown, want: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === null || v === false ? null : v);
  return JSON.stringify(norm(actual)) === JSON.stringify(norm(want));
}

/** The first alternative that exists among the candidates, or undefined */
function pick(name: string, candidates: Iterable<string>): string | undefined {
  const set = new Set(candidates);
  return alts(name).find(a => set.has(a));
}

/** "Entity.field" with alternatives on both sides, resolved against the model */
function pickField(model: Model, ref: string): { entity: string; field: string } | undefined {
  const dot = ref.indexOf(".");
  if (dot === -1) return undefined;
  const entity = pick(ref.slice(0, dot), Object.keys(model.entities));
  if (!entity) return undefined;
  const field = pick(ref.slice(dot + 1), Object.keys(model.entities[entity].fields));
  return field ? { entity, field } : undefined;
}

/** A rule as the model writes it, with alternatives in a fixed order so two spellings compare equal */
export function ruleText(rule: RuleIR): string {
  return normalizeRule(coreRuleText(rule));
}

/** Alternatives sorted, and the parts of each conjunction, so "a or b" equals "b or a" and "a and b" equals "b and a" */
export function normalizeRule(text: string): string {
  return text
    .split(" or ")
    .map(alternative =>
      alternative
        .split(" and ")
        .map(s => s.trim())
        .sort()
        .join(" and ")
    )
    .sort()
    .join(" or ");
}

/** The rule without its row conditions, so an expectation that names none still matches a rule the agent qualified */
function stripConditions(text: string): string {
  return text
    .split(" or ")
    .map(alternative =>
      alternative
        .split(" and ")
        .map(p => p.replace(/ when .*$/, ""))
        .join(" and ")
    )
    .join(" or ");
}

/**
 * Whether a rule matches one of the expected alternatives (`|`). An expectation that carries no condition
 * accepts a rule whose predicates match once their conditions are dropped: qualifying a rule is never wrong here.
 */
export function ruleMatches(want: string, actual: RuleIR): boolean {
  const options = alts(want).map(normalizeRule);
  if (options.includes(ruleText(actual))) return true;
  if (options.some(o => o.includes(" when "))) return false;
  return options.includes(normalizeRule(stripConditions(coreRuleText(actual))));
}

/** Provider labels: credentials, magic_link, oauth:github, oauth:google, oauth:oidc, plus a bare "oauth" */
function providerLabels(model: Model): string[] {
  if (!model.auth) return [];
  const list = model.auth.providers ?? [model.auth.provider ?? "credentials"];
  const out: string[] = [];
  for (const p of list) {
    if (typeof p === "string") out.push(p);
    else {
      out.push("oauth", `oauth:${p.oauth}`);
      if (p.name) out.push(`oauth:${p.name}`);
    }
  }
  return out;
}

function eventLabels(model: Model): string[] {
  return model.events.flatMap(e => [e.on, `${e.on}:${e.delivery ?? "inline"}`]);
}

export function actionLabels(model: Model): string[] {
  const out = Object.keys(model.actions).map(name => `actions.${name}`);
  for (const [resource, r] of Object.entries(model.resources))
    for (const name of Object.keys(r.actions ?? {})) out.push(`${resource}.${name}`);
  return out;
}

function stepOps(diff: Diff): string[] {
  const ops: string[] = [];
  for (const op of diff.ops) if (op.op === "add_scenario") for (const step of op.scenario.steps) ops.push(step.op);
  return ops;
}

export function scenarioMetrics(checked: Checked): ScenarioMetrics {
  const { base, model, diff } = checked;
  const baseResources = new Set(Object.keys(base.resources));
  const baseActions = new Set(actionLabels(base));
  const added = [
    ...Object.keys(model.resources).filter(r => !baseResources.has(r)),
    ...actionLabels(model).filter(a => !baseActions.has(a))
  ];
  let scenarios = 0;
  let steps = 0;
  let rejections = 0;
  const statuses = new Set<number>();
  const calls = new Set<string>();
  for (const op of diff.ops) {
    if (op.op !== "add_scenario") continue;
    scenarios++;
    for (const step of op.scenario.steps) {
      steps++;
      statuses.add(step.expect.status);
      if (step.expect.status >= 400) rejections++;
      calls.add(step.op);
      calls.add(step.op.split(".")[0]);
    }
  }
  const touched = added.filter(a => calls.has(a) || calls.has(a.split(".")[0]));
  const seed = diff.ops.filter(op => op.op === "set_seed").reduce((n, op) => n + op.seed.length, 0);
  return {
    scenarios,
    steps,
    rejections,
    statuses: [...statuses].sort((a, b) => a - b),
    added,
    touched,
    seed_steps: seed
  };
}

/**
 * The IR whose rules are the ones the model writes. Under isolation: database the compiler adds the membership of
 * the row's tenant to the rules of tenant tables; expectations name the rules as a diff declares them, so they are
 * read from the same model compiled without the key.
 */
function declaredIr(checked: Checked): IR {
  const tenancy = checked.model.auth?.tenancy;
  if (!checked.model.auth || !tenancy || tenancy.isolation !== "database") return checked.ir;
  const { isolation: _isolation, ...plain } = tenancy;
  return compile({ ...checked.model, auth: { ...checked.model.auth, tenancy: plain } });
}

export function checkExpectations(expect: Expect, checked: Checked): string[] {
  const { model, diff } = checked;
  const ir = declaredIr(checked);
  const failures: string[] = [];
  const fail = (line: string) => failures.push(line);
  const entities = Object.keys(model.entities);
  const resources = Object.keys(model.resources);

  for (const name of expect.entities ?? []) if (!pick(name, entities)) fail(`entity ${name} missing`);
  for (const name of expect.absent_entities ?? []) if (pick(name, entities)) fail(`entity ${name} should be gone`);

  for (const [entityName, fields] of Object.entries(expect.fields ?? {})) {
    const entity = pick(entityName, entities);
    if (!entity) {
      fail(`entity ${entityName} missing (for fields ${fields.join(", ")})`);
      continue;
    }
    const have = Object.keys(model.entities[entity].fields);
    for (const f of fields) if (!pick(f, have)) fail(`field ${entity}.${f} missing`);
  }
  for (const [entityName, fields] of Object.entries(expect.absent_fields ?? {})) {
    const entity = pick(entityName, entities);
    if (!entity) continue;
    const have = Object.keys(model.entities[entity].fields);
    for (const f of fields) if (pick(f, have)) fail(`field ${entity}.${f} should be gone`);
  }

  for (const [ref, type] of Object.entries(expect.types ?? {})) {
    const hit = pickField(model, ref);
    if (!hit) {
      fail(`field ${ref} missing (expected type ${type})`);
      continue;
    }
    const actual = model.entities[hit.entity].fields[hit.field].type;
    if (!alts(type).includes(actual)) fail(`field ${hit.entity}.${hit.field} is ${actual}, expected ${type}`);
  }

  for (const [ref, props] of Object.entries(expect.field_props ?? {})) {
    const hit = pickField(model, ref);
    if (!hit) {
      fail(`field ${ref} missing (expected ${JSON.stringify(props)})`);
      continue;
    }
    const field = model.entities[hit.entity].fields[hit.field] as Record<string, unknown>;
    for (const [key, want] of Object.entries(props))
      if (!looseEqual(field[key], want))
        fail(
          `field ${hit.entity}.${hit.field}.${key} is ${JSON.stringify(field[key] ?? null)}, expected ${JSON.stringify(want)}`
        );
  }

  for (const spec of expect.relations ?? []) {
    const m = spec.match(/^\s*(.+?)\s*->\s*([A-Za-z|]+)(?::(\w+))?\s*$/);
    if (!m) {
      fail(`bad relation expectation ${spec}`);
      continue;
    }
    const [, left, targetAlts, onDelete] = m;
    const dot = left.indexOf(".");
    const entity = pick(left.slice(0, dot), entities);
    if (!entity) {
      fail(`entity ${left.slice(0, dot)} missing (for relation ${spec})`);
      continue;
    }
    const fieldSpec = left.slice(dot + 1);
    const fields = model.entities[entity].fields;
    const candidates = Object.entries(fields).filter(
      ([name, f]) => f.relation && (fieldSpec === "*" || alts(fieldSpec).includes(name))
    );
    const hit = candidates.find(([, f]) => alts(targetAlts).includes(f.relation!.entity));
    if (!hit) {
      fail(`relation ${spec} missing`);
      continue;
    }
    if (onDelete && (hit[1].relation!.on_delete ?? "restrict") !== onDelete)
      fail(
        `relation ${entity}.${hit[0]} has on_delete ${hit[1].relation!.on_delete ?? "restrict"}, expected ${onDelete}`
      );
  }

  for (const [entityName, fields] of Object.entries(expect.unique_together ?? {})) {
    const entity = pick(entityName, entities);
    if (!entity) {
      fail(`entity ${entityName} missing (for unique ${fields.join("+")})`);
      continue;
    }
    const e = model.entities[entity];
    const have = Object.keys(e.fields);
    const wanted = fields.map(f => pick(f, have));
    if (wanted.some(f => !f)) {
      fail(`unique ${entity}(${fields.join(", ")}): a field is missing`);
      continue;
    }
    const sets = [
      ...(e.unique ?? []),
      ...(e.indexes ?? []).filter(i => i.unique).map(i => i.fields),
      // a junction's composite primary key is unique too
      ...(Object.entries(e.fields).filter(([, f]) => f.primary).length > 1
        ? [
            Object.entries(e.fields)
              .filter(([, f]) => f.primary)
              .map(([n]) => n)
          ]
        : [])
    ];
    const ok = sets.some(set => wanted.every(f => set.includes(f!)) && set.length === wanted.length);
    if (!ok) fail(`unique ${entity}(${wanted.join(", ")}) missing`);
  }

  for (const [a, b] of expect.junction ?? []) {
    const ea = pick(a, entities);
    const eb = pick(b, entities);
    const found =
      ea &&
      eb &&
      Object.values(model.entities).some(e => {
        const links = Object.entries(e.fields).filter(([, f]) => f.relation);
        const toA = links.find(([, f]) => f.relation!.entity === ea);
        const toB = links.find(([, f]) => f.relation!.entity === eb && f !== toA?.[1]);
        if (!toA || !toB) return false;
        if (toA[1].primary && toB[1].primary) return true;
        const pair = [toA[0], toB[0]];
        const uniques = [...(e.unique ?? []), ...(e.indexes ?? []).filter(i => i.unique).map(i => i.fields)];
        return uniques.some(set => set.length === 2 && pair.every(f => set.includes(f)));
      });
    if (!found) fail(`junction between ${a} and ${b} missing`);
  }

  for (const spec of expect.through ?? []) {
    const [left, targetAlts] = spec.split("->").map(s => s.trim());
    const dot = left.indexOf(".");
    const entity = pick(left.slice(0, dot), entities);
    if (!entity) {
      fail(`entity ${left.slice(0, dot)} missing (for the relation ${spec})`);
      continue;
    }
    const nameSpec = left.slice(dot + 1);
    const hit = Object.keys(model.entities[entity].relations ?? {}).some(name => {
      if (nameSpec !== "*" && !alts(nameSpec).includes(name)) return false;
      const link = throughRelation(model, entity, name);
      return Boolean(link && !("problem" in link) && alts(targetAlts).includes(link.target));
    });
    if (!hit) fail(`relation through a junction ${spec} missing`);
  }

  for (const [entityName, within] of Object.entries(expect.ordered ?? {})) {
    const entity = pick(entityName, entities);
    const position = entity ? positionOf(model.entities[entity]) : undefined;
    if (!entity) fail(`entity ${entityName} missing (for its order)`);
    else if (!position) fail(`${entity} has no position field`);
    else if (within !== "*" && !alts(within).includes(position.within))
      fail(`${entity} is ordered within ${position.within}, expected ${within}`);
  }

  for (const entityName of expect.archive ?? []) {
    const entity = pick(entityName, entities);
    if (!entity) fail(`entity ${entityName} missing (for its archive)`);
    else if (!archiveOf(model.entities[entity])) fail(`${entity} does not archive (no archive: on the entity)`);
  }

  for (const spec of expect.counts ?? []) {
    const [left, countedAlts] = spec.split("->").map(s => s.trim());
    const dot = left.indexOf(".");
    const entity = pick(left.slice(0, dot), entities);
    if (!entity) {
      fail(`entity ${left.slice(0, dot)} missing (for the count ${spec})`);
      continue;
    }
    const nameSpec = left.slice(dot + 1);
    const hit = Object.entries(model.entities[entity].fields).some(([name, field]) => {
      if (nameSpec !== "*" && !alts(nameSpec).includes(name)) return false;
      const link = countLink(model, entity, field);
      return Boolean(link && !("problem" in link) && alts(countedAlts).includes(link.entity));
    });
    if (!hit) fail(`count ${spec} missing (a count_of field)`);
  }

  for (const [entityName, rules] of Object.entries(expect.rules ?? {})) {
    const entity = pick(entityName, entities);
    const irEntity = entity && ir.entities.find(e => e.name === entity);
    if (!irEntity) {
      fail(`entity ${entityName} missing (for rules)`);
      continue;
    }
    for (const [op, want] of Object.entries(rules)) {
      if (op === "hidden") {
        if (!want.split("|").includes(irEntity.hidden))
          fail(`${entity}.rules.hidden is ${irEntity.hidden}, expected ${want}`);
        continue;
      }
      const rule = irEntity.rules[op as keyof typeof irEntity.rules];
      if (!ruleMatches(want, rule)) fail(`${entity}.rules.${op} is ${ruleText(rule)}, expected ${want}`);
    }
  }

  for (const name of expect.resources ?? []) if (!pick(name, resources)) fail(`resource ${name} missing`);
  for (const name of expect.absent_resources ?? []) if (pick(name, resources)) fail(`resource ${name} should be gone`);

  for (const [name, ops] of Object.entries(expect.operations ?? {})) {
    const resource = pick(name, resources);
    if (!resource) {
      fail(`resource ${name} missing (for operations ${ops.join(", ")})`);
      continue;
    }
    for (const op of ops)
      if (!model.resources[resource].operations.includes(op as never)) fail(`resource ${resource} lacks ${op}`);
  }
  for (const [name, ops] of Object.entries(expect.absent_operations ?? {})) {
    const resource = pick(name, resources);
    if (!resource) continue;
    for (const op of ops)
      if (model.resources[resource].operations.includes(op as never))
        fail(`resource ${resource} should not offer ${op}`);
  }

  for (const [name, want] of Object.entries(expect.list ?? {})) {
    const resource = pick(name, resources);
    if (!resource) {
      fail(`resource ${name} missing (for list options)`);
      continue;
    }
    const list = model.resources[resource].list;
    if (!list) {
      fail(`resource ${resource} has no list options`);
      continue;
    }
    for (const key of ["filters", "sortable", "search", "include"] as const)
      for (const f of want[key] ?? [])
        if (!pick(f, list[key] ?? [])) fail(`resource ${resource} list.${key} lacks ${f}`);
    if (want.page_size !== undefined && list.page_size !== want.page_size)
      fail(`resource ${resource} list.page_size is ${list.page_size}, expected ${want.page_size}`);
  }

  const actions = actionLabels(model);
  for (const name of expect.actions ?? []) if (!pick(name, actions)) fail(`action ${name} missing`);
  for (const [where, want] of Object.entries(expect.actions_on ?? {})) {
    const candidates = ir.actions.filter(a =>
      where === "actions" ? a.scope === "global" : alts(where).includes(a.resource ?? "")
    );
    const match = candidates.find(a => {
      if (want.rule && !ruleMatches(want.rule, a.rule)) return false;
      if (want.scope && a.scope !== want.scope) return false;
      if (want.returns && a.returns.kind !== want.returns) return false;
      if (
        want.input &&
        !want.input.every(f =>
          pick(
            f,
            a.input.map(c => c.name)
          )
        )
      )
        return false;
      return true;
    });
    if (!match) {
      const have = candidates.map(
        a =>
          `${a.name}(${a.scope}, ${ruleText(a.rule)}, returns ${a.returns.kind}, input ${a.input.map(c => c.name).join("/") || "-"})`
      );
      fail(`no action on ${where} matching ${JSON.stringify(want)}; have ${have.join(", ") || "none"}`);
    }
  }

  if (expect.auth) {
    const want = expect.auth;
    if (want.none && model.auth) fail("auth should not be configured");
    if (!want.none && !model.auth && (want.identity || want.providers || want.tenancy)) fail("auth missing");
    if (model.auth) {
      if (want.identity && !alts(want.identity).includes(model.auth.identity))
        fail(`auth.identity is ${model.auth.identity}, expected ${want.identity}`);
      const labels = providerLabels(model);
      for (const p of want.providers ?? []) if (!pick(p, labels)) fail(`auth provider ${p} missing`);
      for (const p of want.absent_providers ?? []) if (pick(p, labels)) fail(`auth provider ${p} should be gone`);
      if (want.tenancy) {
        if (!model.auth.tenancy) fail("auth.tenancy missing");
        else {
          if (want.tenancy.entity && !alts(want.tenancy.entity).includes(model.auth.tenancy.entity))
            fail(`tenancy entity is ${model.auth.tenancy.entity}, expected ${want.tenancy.entity}`);
          if (want.tenancy.membership && !alts(want.tenancy.membership).includes(model.auth.tenancy.membership))
            fail(`tenancy membership is ${model.auth.tenancy.membership}, expected ${want.tenancy.membership}`);
          const isolation = model.auth.tenancy.isolation ?? "none";
          if (want.tenancy.isolation && want.tenancy.isolation !== isolation)
            fail(`tenancy isolation is ${isolation}, expected ${want.tenancy.isolation}`);
        }
      }
    }
  }

  const events = eventLabels(model);
  for (const e of expect.events ?? []) if (!pick(e, events)) fail(`event ${e} missing`);
  for (const e of expect.absent_events ?? []) if (pick(e, events)) fail(`event ${e} should be gone`);

  for (const [name, want] of Object.entries(expect.pages ?? {})) {
    const pageName = pick(name, Object.keys(model.app?.pages ?? {}));
    const page = pageName && ir.app?.pages.find(p => p.name === pageName);
    if (!page) {
      fail(`page ${name} missing`);
      continue;
    }
    if (want.kind && page.kind !== want.kind) fail(`page ${pageName} is ${page.kind}, expected ${want.kind}`);
    if (want.layout && page.layout !== want.layout)
      fail(`page ${pageName} layout is ${page.layout ?? "none"}, expected ${want.layout}`);
    if (want.group_by && !alts(want.group_by).includes(page.groupBy ?? ""))
      fail(`page ${pageName} group_by is ${page.groupBy ?? "none"}, expected ${want.group_by}`);
    if (want.resource && !alts(want.resource).includes(page.resource ?? ""))
      fail(`page ${pageName} resource is ${page.resource ?? "none"}, expected ${want.resource}`);
    if (want.tiles_min !== undefined && page.tiles.length < want.tiles_min)
      fail(`page ${pageName} has ${page.tiles.length} tiles, expected at least ${want.tiles_min}`);
    if (want.access && !alts(want.access).includes(ruleText(page.access)))
      fail(`page ${pageName} access is ${ruleText(page.access)}, expected ${want.access}`);
    if (want.path && page.path !== want.path) fail(`page ${pageName} path is ${page.path}, expected ${want.path}`);
    for (const key of want.filter ?? [])
      if (!pick(key, Object.keys(page.filter ?? {}))) fail(`page ${pageName} lacks filter ${key}`);
    if (want.refresh && !page.refresh) fail(`page ${pageName} has no refresh`);
  }
  if (expect.sidebar) {
    const items = (model.app?.sidebar?.items ?? []).map(i => i.page);
    for (const name of expect.sidebar) if (!pick(name, items)) fail(`sidebar lacks page ${name}`);
  }
  for (const want of expect.schedules ?? [])
    if (!model.schedules.some(s => alts(want).includes(s.run))) fail(`no schedule runs ${want}`);
  for (const spec of expect.timers ?? []) {
    const [field, run] = spec.split("->").map(s => s.trim());
    const dot = field.indexOf(".");
    const entityAlts = alts(field.slice(0, dot));
    const fieldAlts = alts(field.slice(dot + 1));
    const hit = model.timers.some(
      t => entityAlts.includes(t.on) && fieldAlts.includes(t.at) && (!run || alts(run).includes(t.run))
    );
    if (!hit) fail(`no timer on ${spec}`);
  }

  if (expect.files) {
    const have = ir.files ?? { upload: { kind: model.auth ? "authenticated" : "public" }, read: { kind: "public" } };
    if (expect.files.read && !ruleMatches(expect.files.read, have.read))
      fail(`files.read is ${ruleText(have.read)}, expected ${expect.files.read}`);
    if (expect.files.upload && !ruleMatches(expect.files.upload, have.upload))
      fail(`files.upload is ${ruleText(have.upload)}, expected ${expect.files.upload}`);
  }
  for (const [ref, accept] of Object.entries(expect.file_accept ?? {})) {
    const hit = pickField(model, ref);
    const field = hit && model.entities[hit.entity].fields[hit.field];
    if (!field || field.type !== "file") {
      fail(`file field ${ref} missing`);
      continue;
    }
    const list = field.file?.accept ?? [];
    if (list.length === 0 || !list.every(a => a.includes(accept)))
      fail(`file field ${hit.entity}.${hit.field} accepts ${list.join(", ") || "anything"}, expected only ${accept}*`);
  }

  const metrics = scenarioMetrics(checked);
  if (expect.seed_min !== undefined && metrics.seed_steps < expect.seed_min)
    fail(`seed has ${metrics.seed_steps} steps, expected at least ${expect.seed_min}`);
  if (expect.scenarios) {
    if (metrics.scenarios < expect.scenarios.min)
      fail(`diff adds ${metrics.scenarios} scenarios, expected at least ${expect.scenarios.min}`);
    if (metrics.rejections < expect.scenarios.rejections)
      fail(`scenarios have ${metrics.rejections} rejection steps, expected at least ${expect.scenarios.rejections}`);
    for (const s of expect.scenarios.statuses ?? [])
      if (!metrics.statuses.includes(s)) fail(`no scenario step expects status ${s}`);
  }
  if (expect.touches) {
    const calls = new Set(stepOps(diff).flatMap(op => [op, op.split(".")[0]]));
    for (const t of expect.touches) if (!alts(t).some(a => calls.has(a))) fail(`no scenario step calls ${t}`);
  }
  if (expect.actor_fields) {
    const want = Object.entries(expect.actor_fields);
    const actors = Object.values(model.examples?.actors ?? {});
    if (!actors.some(a => want.every(([field, value]) => alts(value).includes(String(a[field])))))
      fail(`no actor sets ${want.map(([field, value]) => `${field}: ${value}`).join(", ")}`);
  }

  if (expect.any_of) {
    const results = expect.any_of.map(alt => checkExpectations(ExpectSchema.parse(alt), checked));
    if (!results.some(r => r.length === 0))
      fail(`no alternative matched: ${results.map((r, i) => `[${i + 1}] ${r.join("; ")}`).join(" | ")}`);
  }

  if (expect.ops) {
    const kinds = diff.ops.map(op => op.op);
    if (expect.ops.max !== undefined && kinds.length > expect.ops.max)
      fail(`diff has ${kinds.length} ops, expected at most ${expect.ops.max}`);
    for (const k of expect.ops.require ?? [])
      if (!alts(k).some(a => kinds.includes(a as never))) fail(`diff lacks a ${k} op`);
    for (const k of expect.ops.forbid ?? []) if (kinds.includes(k as never)) fail(`diff uses a forbidden ${k} op`);
  }

  return failures;
}
