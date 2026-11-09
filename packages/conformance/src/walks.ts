/**
 * The conformance walks: five checks the harness runs over a fixture on a running app without a scenario naming
 * them, each a function of the IR, the app's base URL and the actors' sessions.
 *
 * - rule: for every operation and action, every actor and an anonymous caller, what the IR's rule predicts
 *   against the answer, on rows the walk created (one per actor allowed to create) or found.
 * - tenant: with tenancy, a member of another team reaches nothing of the first team's rows.
 * - leak: no response body of the walks carries a hidden column, a hash column or a raw key.
 * - fuzz: wrong shapes, types, lengths, extra keys and bad ids answer 4xx, never 5xx or 2xx.
 * - contract: every breaking change between consecutive revisions' OpenAPI documents is explained by a diff op.
 */
import pg from "pg";
import {
  diffOpenApi,
  explainedBy,
  loadProject,
  openapiDocument,
  planMigration,
  readIntent,
  type ActionIR,
  type ActorIR,
  type ColumnIR,
  type EntityIR,
  type ForeignKeyIR,
  type IR,
  type MigrationStep,
  type OperationIR,
  type ResourceIR,
  type RuleIR
} from "@osl/core";
import { callLabel, makeClient, WalkTimeout, type HarnessClient, type Reply } from "./client.js";
import { badIds, invalidProbes, Rng, validBody, validValue, wrongValue, type BodyContext } from "./bodies.js";
import { createOp, precheck, Resolver, rowOp, same, verdict, type Expect, type Row, type Session } from "./rules.js";

export const WALKS = ["rule", "tenant", "leak", "fuzz", "contract"] as const;
export type WalkName = (typeof WALKS)[number];

export interface WalkContext {
  ir: IR;
  backend: string;
  baseUrl: string;
  databaseUrl: string;
  /** The generated project, for the lock and the intents the contract walk reads */
  projectDir: string;
  /** The seed of the fuzz walk's generator, kept in the fixture so a failure replays */
  seed: number;
  log?: (line: string) => void;
}

export interface WalkResult {
  name: WalkName;
  ok: boolean;
  detail: string;
  ms: number;
}

interface Caller {
  name: string;
  client: HarnessClient;
  session: Session | null;
  actor?: ActorIR;
}

interface Walkable {
  entity: EntityIR;
  resource: ResourceIR;
}

interface WalkRow {
  entity: EntityIR;
  resource: ResourceIR;
  id: unknown;
  creator: Caller | null;
}

/** What the walks share: the callers, the rows the rule walk made, and what it could not walk */
interface State {
  callers: Caller[];
  actors: Caller[];
  anonymous: Caller;
  walkable: Walkable[];
  rows: Map<string, WalkRow[]>;
  notes: string[];
  calls: number;
  /** How often the rules predicted each outcome, so the detail shows what the walk exercised */
  predicted: Map<string, number>;
}

const ACCEPTED_4XX = new Set([400, 401, 403, 404, 409, 410]);
const MAX_FINDINGS = 40;

export async function runWalks(ctx: WalkContext, which: ReadonlySet<string> = new Set(WALKS)): Promise<WalkResult[]> {
  const { ir } = ctx;
  const results = new Map<WalkName, WalkResult>();
  const captured: { label: string; body: unknown }[] = [];
  const listen = (label: string, reply: Reply) => {
    if (captured.length < 50_000) captured.push({ label, body: reply.body });
  };
  const db = new pg.Client({ connectionString: ctx.databaseUrl });
  await db.connect();
  const resolver = new Resolver(db, ir);
  const roles = ir.auth?.tenancy?.roles ?? [];
  let counter = 0;
  const bodies: BodyContext = {
    ir,
    rng: new Rng(ctx.seed),
    next: () => ++counter,
    relatedId: () => undefined
  };
  const timed = async (name: WalkName, fn: () => Promise<string>, findings: string[] = []): Promise<void> => {
    const started = Date.now();
    try {
      const detail = await fn();
      results.set(name, {
        name,
        ok: findings.length === 0,
        detail: findings.length ? findings.slice(0, MAX_FINDINGS).join("\n") : detail,
        ms: Date.now() - started
      });
    } catch (error) {
      results.set(name, {
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
        ms: Date.now() - started
      });
    }
  };

  try {
    const anonymous: Caller = {
      name: "anonymous",
      client: makeClient(ir, ctx.backend, ctx.baseUrl, listen),
      session: null
    };
    const state: State = {
      callers: [anonymous],
      actors: [],
      anonymous,
      walkable: walkableEntities(ir),
      rows: new Map(),
      notes: [],
      calls: 0,
      predicted: new Map()
    };
    const needsWalks = which.has("rule") || which.has("tenant") || which.has("fuzz") || which.has("leak");
    if (needsWalks) {
      state.actors = await signIn(ctx, listen, resolver, state.notes);
      state.callers = [...state.actors, anonymous];
    }
    const ruleFindings: string[] = [];
    const ruleStarted = Date.now();
    if (which.has("rule") || which.has("tenant") || which.has("fuzz")) {
      // The rule walk's first phase makes the rows every other walk uses, so it runs even when only they were asked
      await createRows(ctx, state, resolver, roles, bodies, which.has("rule") ? ruleFindings : []);
    }
    if (which.has("rule")) await readWalk(ctx, state, resolver, roles, bodies, ruleFindings);
    if (which.has("tenant")) {
      const findings: string[] = [];
      await timed("tenant", () => tenantWalk(ctx, state, resolver, db, listen, bodies, findings), findings);
    }
    if (which.has("fuzz")) {
      const findings: string[] = [];
      await timed("fuzz", () => fuzzWalk(ctx, state, resolver, bodies, findings), findings);
    }
    if (which.has("rule")) {
      await deleteWalk(ctx, state, resolver, roles, ruleFindings);
      const ms = Date.now() - ruleStarted;
      const entities = state.walkable.length;
      const walked = [...state.rows.values()].filter(r => r.length).length;
      const outcomes = [...state.predicted.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n} ${k}`)
        .join(", ");
      const detail = `${state.calls} calls over ${walked} of ${entities} entities, ${state.callers.length} callers (${outcomes})${
        state.notes.length ? `; ${state.notes.join("; ")}` : ""
      }`;
      results.set("rule", {
        name: "rule",
        ok: ruleFindings.length === 0,
        detail: ruleFindings.length ? ruleFindings.slice(0, MAX_FINDINGS).join("\n") : detail,
        ms
      });
    }
    if (which.has("leak")) {
      const findings: string[] = [];
      await timed("leak", async () => leakWalk(ir, captured, findings), findings);
    }
    if (which.has("contract")) {
      const findings: string[] = [];
      await timed("contract", () => contractWalk(ctx, findings), findings);
    }
  } finally {
    await db.end();
  }
  return WALKS.filter(w => results.has(w)).map(w => results.get(w)!);
}

/** Entities with a resource, parents before children by their required relations */
function walkableEntities(ir: IR): Walkable[] {
  const all = ir.entities
    .filter(e => !e.system)
    .flatMap(entity => {
      const resource = ir.resources.find(r => r.entity === entity.name);
      return resource ? [{ entity, resource }] : [];
    });
  const names = new Set(all.map(w => w.entity.name));
  const deps = (w: Walkable) =>
    w.entity.foreignKeys
      .filter(fk => fk.targetEntity !== w.entity.name && names.has(fk.targetEntity))
      .filter(fk => !w.entity.columns.find(c => c.name === fk.column)?.nullable)
      .map(fk => fk.targetEntity);
  const ordered: Walkable[] = [];
  const placed = new Set<string>();
  let remaining = [...all];
  while (remaining.length) {
    const ready = remaining.filter(w => deps(w).every(d => placed.has(d)));
    const batch = ready.length ? ready : [remaining[0]];
    for (const w of batch) {
      ordered.push(w);
      placed.add(w.entity.name);
    }
    remaining = remaining.filter(w => !placed.has(w.entity.name));
  }
  return ordered;
}

/** Registers, provisions and signs in every actor of the fixture; none when the identity has no password sign-in */
async function signIn(
  ctx: WalkContext,
  listen: (label: string, reply: Reply) => void,
  resolver: Resolver,
  notes: string[]
): Promise<Caller[]> {
  const { ir } = ctx;
  const actors = Object.entries(ir.examples.actors);
  if (!ir.auth || actors.length === 0) return [];
  if (!ir.auth.providers.some(p => p.kind === "credentials")) {
    notes.push("actors cannot sign in with a password, so only the anonymous caller walked");
    return [];
  }
  const out: Caller[] = [];
  for (const [name, actor] of actors) {
    const client = makeClient(ir, ctx.backend, ctx.baseUrl, listen);
    const registered = await client.auth("register", { email: actor.email, password: actor.password, ...actor.fields });
    if (![200, 201, 409].includes(registered.status))
      throw new Error(`could not register ${name}: ${registered.status} ${JSON.stringify(registered.body)}`);
    await resolver.provision(actor);
    const login = await client.fresh();
    const reply = await login.auth("login", { email: actor.email, password: actor.password });
    if (reply.status !== 200)
      throw new Error(`could not sign in ${name}: ${reply.status} ${JSON.stringify(reply.body)}`);
    const user = (reply.body as { data: Row }).data;
    out.push({
      name,
      client: login,
      session: { id: user[ir.auth.identity ? identityPk(ir) : "id"], user, memberships: [] },
      actor
    });
  }
  for (const caller of out) await refresh(caller, resolver);
  return out;
}

function identityPk(ir: IR): string {
  return ir.entities.find(e => e.name === ir.auth!.identity)!.primaryKey[0];
}

/** Memberships change as the walk creates tenants, so a session is refreshed before every prediction */
async function refresh(caller: Caller, resolver: Resolver): Promise<void> {
  if (caller.session) caller.session.memberships = await resolver.memberships(caller.session.id);
}

function label(
  call: { resource: ResourceIR; op: OperationIR } | { action: ActionIR },
  caller: Caller,
  row?: WalkRow
): string {
  const who = row
    ? `${caller.name} on ${row.creator ? `${row.creator.name}'s` : "an existing"} ${row.entity.name}`
    : caller.name;
  return `${callLabel(call)} as ${who}`;
}

/** Record a mismatch between what the rule predicted and what the app answered */
function compare(
  findings: string[],
  what: string,
  expect: Expect,
  reply: Reply,
  allowedOk: (status: number) => boolean,
  state?: State
): boolean {
  if (state) {
    const key = expect.allow ? "allowed" : String(expect.status);
    state.predicted.set(key, (state.predicted.get(key) ?? 0) + 1);
  }
  if (expect.allow) {
    if (allowedOk(reply.status)) return true;
    findings.push(`${what}: the rule allows, got ${reply.status} ${message(reply)}`);
    return false;
  }
  if (reply.status === expect.status) return true;
  findings.push(`${what}: expected ${expect.status}, got ${reply.status} ${message(reply)}`);
  return false;
}

function message(reply: Reply): string {
  const body = reply.body as { error?: { code?: string; message?: string } } | null;
  const text = body?.error ? `${body.error.code ?? ""} ${body.error.message ?? ""}`.trim() : "";
  return text ? `(${text.slice(0, 120)})` : "";
}

const success = (status: number) => status < 300;
/** An action's handler may answer 400 or 409 on its own; the rule let it through unless it answered a refusal */
const notRefused = (status: number) => ![401, 403, 404].includes(status);

function idOf(body: unknown, pk: string): unknown {
  return (body as { data?: Row } | null)?.data?.[pk];
}

/** The first phase of the rule walk: one row per actor the create rule allows, and the refused creates tested too */
async function createRows(
  ctx: WalkContext,
  state: State,
  resolver: Resolver,
  roles: string[],
  bodies: BodyContext,
  findings: string[]
): Promise<void> {
  const { ir } = ctx;
  for (const w of state.walkable) {
    const { entity, resource } = w;
    const create = resource.operations.find((o): o is Extract<OperationIR, { kind: "create" }> => o.kind === "create");
    const rows: WalkRow[] = [];
    let generatorFailed: string | null = null;
    if (create && create.rule.kind !== "none") {
      for (const caller of state.callers) {
        await refresh(caller, resolver);
        const built = buildCreateBody(ir, entity, create, caller, state, bodies);
        if (built.missing.length) {
          generatorFailed = `cannot fill ${built.missing.join(", ")}`;
          break;
        }
        const predicted = { ...built.body };
        if (create.ownerField && caller.session) predicted[create.ownerField] = caller.session.id;
        const resolved = await resolver.resolve(entity, predicted, [create.rule]);
        const expect = createOp(create.rule, caller.session, resolved, roles);
        let body = built.body;
        let reply = await caller.client.resource({ resource, op: create, body });
        state.calls++;
        const what = `${resource.name}.create as ${caller.name}`;
        if (expect.allow && reply.status === 400) {
          generatorFailed = `create answered 400 ${message(reply)}`;
          break;
        }
        // A conflict on an allowed create is the data, not the rule: a membership the caller already holds. Try
        // the other actors as the related user before giving up on the row.
        if (expect.allow && reply.status === 409) {
          const userColumns = ir.auth
            ? entity.foreignKeys.filter(f => f.targetEntity === ir.auth!.identity && f.column in body)
            : [];
          for (const other of state.actors) {
            if (other === caller || !userColumns.length || reply.status !== 409) continue;
            body = { ...body };
            for (const fk of userColumns) body[fk.column] = other.session!.id;
            reply = await caller.client.resource({ resource, op: create, body });
            state.calls++;
          }
          if (reply.status === 409) {
            state.notes.push(`${what}: every create conflicted ${message(reply)}`);
            continue;
          }
        }
        compare(findings, what, expect, reply, success, state);
        if (reply.status < 300)
          rows.push({ entity, resource, id: idOf(reply.body, entity.primaryKey[0]), creator: caller });
      }
    }
    if (rows.length === 0) {
      const existing = await resolver.firstRow(entity);
      if (existing) rows.push({ entity, resource, id: existing[entity.primaryKey[0]], creator: null });
      const why = generatorFailed ?? (create ? "no caller may create" : "no create operation");
      state.notes.push(`${entity.name} walked ${existing ? "on an existing row" : "without a row"} (${why})`);
    }
    state.rows.set(entity.name, rows);
  }
}

/** A create body for a caller: required fields filled, relations pointing at the caller's own rows where it has any */
function buildCreateBody(
  ir: IR,
  entity: EntityIR,
  create: Extract<OperationIR, { kind: "create" }>,
  caller: Caller,
  state: State,
  bodies: BodyContext
): { body: Record<string, unknown>; missing: string[] } {
  const exclude = new Set<string>();
  if (create.ownerField) exclude.add(create.ownerField);
  const ctx: BodyContext = {
    ...bodies,
    relatedId: (target, column) => {
      if (ir.auth && target === ir.auth.identity) return caller.session?.id ?? state.actors[0]?.session?.id;
      const candidates = state.rows.get(target) ?? [];
      const own = candidates.find(r => r.creator === caller);
      const tenancy = ir.auth?.tenancy;
      if (tenancy && target === tenancy.entity && caller.session) {
        const mine = candidates.find(r => caller.session!.memberships.some(m => same(m.tenant, r.id)));
        if (mine) return mine.id;
        const membership = caller.session.memberships[0];
        if (membership) return membership.tenant;
      }
      void column;
      return (own ?? candidates[0])?.id;
    }
  };
  return validBody(entity, create.fields, ctx, exclude);
}

/** The second phase: get, list and update on every row as every caller, then every action */
async function readWalk(
  ctx: WalkContext,
  state: State,
  resolver: Resolver,
  roles: string[],
  bodies: BodyContext,
  findings: string[]
): Promise<void> {
  const { ir } = ctx;
  const pageSize = "200";
  for (const w of state.walkable) {
    const { entity, resource } = w;
    const get = resource.operations.find(o => o.kind === "get");
    const list = resource.operations.find((o): o is Extract<OperationIR, { kind: "list" }> => o.kind === "list");
    const update = resource.operations.find((o): o is Extract<OperationIR, { kind: "update" }> => o.kind === "update");
    const rowActions = ir.actions.filter(a => a.resource === resource.name && a.scope === "row");
    const rules = [entity.rules.read, entity.rules.update, ...rowActions.map(a => a.rule)];
    const isIdentity = ir.auth?.identity === entity.name;
    if (isIdentity && rowActions.length)
      state.notes.push(`row actions on ${entity.name} skipped: its rows are the actors`);
    for (const row of state.rows.get(entity.name) ?? []) {
      for (const caller of state.callers) {
        await refresh(caller, resolver);
        const fresh = await resolver.fresh(entity, row.id);
        if (!fresh) break;
        const resolved = await resolver.resolve(entity, fresh, rules);
        if (get && get.rule.kind !== "none") {
          const expect = rowOp(get.rule, entity, caller.session, resolved, roles, true);
          const reply = await caller.client.resource({ resource, op: get, id: row.id });
          state.calls++;
          compare(findings, label({ resource, op: get }, caller, row), expect, reply, success, state);
        }
        if (list && list.rule.kind !== "none") {
          const expect = precheck(list.rule, caller.session, roles);
          const reply = await caller.client.resource({ resource, op: list, query: { page_size: pageSize } });
          state.calls++;
          const what = label({ resource, op: list }, caller, row);
          if (compare(findings, what, expect, reply, success, state) && expect.allow) {
            const body = reply.body as { data?: Row[]; page?: { total?: number } } | null;
            const total = body?.page?.total ?? 0;
            if (total <= Number(pageSize)) {
              const visible = verdict(entity.rules.read, caller.session, resolved, roles).ok;
              const present = (body?.data ?? []).some(r => same(r[entity.primaryKey[0]], row.id));
              if (visible !== present)
                findings.push(
                  `${what}: the row should be ${visible ? "listed" : "hidden"} but is ${present ? "listed" : "missing"}`
                );
            }
          }
        }
        if (update && update.rule.kind !== "none") {
          const body = updateBody(entity, update, fresh, bodies);
          if (body) {
            const expect = rowOp(update.rule, entity, caller.session, resolved, roles, false);
            const reply = await caller.client.resource({ resource, op: update, id: row.id, body });
            state.calls++;
            const what = label({ resource, op: update }, caller, row);
            if (expect.allow && reply.status === 400)
              state.notes.push(`${what}: the walk's update body was refused ${message(reply)}`);
            else compare(findings, what, expect, reply, success, state);
          }
        }
      }
      if (!isIdentity)
        for (const action of rowActions) {
          if (action.rule.kind === "none") continue;
          // Refused callers first, so an allowed call that changes the row comes last
          const order = await sortByExpectation(state.callers, resolver, async caller => {
            const fresh = await resolver.fresh(entity, row.id);
            if (!fresh) return { allow: false, status: 404 };
            return rowOp(
              action.rule,
              entity,
              caller.session,
              await resolver.resolve(entity, fresh, rules),
              roles,
              false
            );
          });
          for (const caller of order) {
            await refresh(caller, resolver);
            const fresh = await resolver.fresh(entity, row.id);
            if (!fresh) break;
            const resolved = await resolver.resolve(entity, fresh, rules);
            const expect = rowOp(action.rule, entity, caller.session, resolved, roles, false);
            const body = actionInput(action, bodies);
            const reply = await caller.client.action({ action, id: row.id, body });
            state.calls++;
            compare(findings, label({ action }, caller, row), expect, reply, notRefused, state);
          }
        }
    }
  }
  for (const action of ir.actions.filter(a => a.scope !== "row" && a.rule.kind !== "none")) {
    const order = await sortByExpectation(state.callers, resolver, async caller =>
      precheck(action.rule, caller.session, roles)
    );
    for (const caller of order) {
      await refresh(caller, resolver);
      const expect = precheck(action.rule, caller.session, roles);
      const reply = await caller.client.action({ action, body: actionInput(action, bodies) });
      state.calls++;
      compare(findings, label({ action }, caller), expect, reply, notRefused, state);
    }
  }
}

async function sortByExpectation(
  callers: Caller[],
  resolver: Resolver,
  expectation: (caller: Caller) => Promise<Expect>
): Promise<Caller[]> {
  const scored: { caller: Caller; allow: boolean }[] = [];
  for (const caller of callers) {
    await refresh(caller, resolver);
    scored.push({ caller, allow: (await expectation(caller)).allow });
  }
  return scored.sort((a, b) => Number(a.allow) - Number(b.allow)).map(s => s.caller);
}

/** One writable field with its current value, so an allowed update changes nothing the walk relies on */
function updateBody(
  entity: EntityIR,
  update: Extract<OperationIR, { kind: "update" }>,
  row: Row,
  bodies: BodyContext
): Record<string, unknown> | null {
  for (const name of update.fields) {
    const column = entity.columns.find(c => c.name === name);
    if (!column || column.type.kind === "file" || entity.foreignKeys.some(f => f.column === name)) continue;
    if (column.type.kind === "scalar" && ["bytes", "json", "datetime", "date", "time"].includes(column.type.scalar))
      continue;
    const current = row[name];
    if (current !== null && current !== undefined) return { [name]: current };
    const value = validValue(column, bodies);
    if (value !== undefined) return { [name]: value };
  }
  return null;
}

function actionInput(action: ActionIR, bodies: BodyContext): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const column of action.input) {
    const required = !column.nullable && column.default === undefined;
    if (!required) continue;
    const value = validValue(column, bodies);
    if (value !== undefined) body[column.name] = value;
  }
  return body;
}

/** The last phase: deletes, children before parents, refused callers first and one allowed caller last */
async function deleteWalk(
  ctx: WalkContext,
  state: State,
  resolver: Resolver,
  roles: string[],
  findings: string[]
): Promise<void> {
  for (const w of [...state.walkable].reverse()) {
    const { entity, resource } = w;
    const del = resource.operations.find(o => o.kind === "delete");
    if (!del || del.rule.kind === "none") continue;
    for (const row of state.rows.get(entity.name) ?? []) {
      const rules = [entity.rules.read, del.rule];
      const order = await sortByExpectation(state.callers, resolver, async caller => {
        const fresh = await resolver.fresh(entity, row.id);
        if (!fresh) return { allow: false, status: 404 };
        return rowOp(del.rule, entity, caller.session, await resolver.resolve(entity, fresh, rules), roles, false);
      });
      for (const caller of order) {
        await refresh(caller, resolver);
        const fresh = await resolver.fresh(entity, row.id);
        if (!fresh) break;
        const resolved = await resolver.resolve(entity, fresh, rules);
        const expect = rowOp(del.rule, entity, caller.session, resolved, roles, false);
        const reply = await caller.client.resource({ resource, op: del, id: row.id });
        state.calls++;
        compare(findings, label({ resource, op: del }, caller, row), expect, reply, notRefused, state);
        if (expect.allow) break;
      }
    }
  }
}

/** With tenancy: the chain of required relations from an entity to the tenant, or null when it never reaches it */
function tenantChain(ir: IR, entity: EntityIR, seen = new Set<string>()): ForeignKeyIR[] | null {
  const tenancy = ir.auth!.tenancy!;
  if (entity.name === tenancy.entity) return [];
  seen.add(entity.name);
  for (const fk of entity.foreignKeys) {
    const column = entity.columns.find(c => c.name === fk.column);
    if (!column || column.nullable || seen.has(fk.targetEntity)) continue;
    if (fk.targetEntity === tenancy.entity) return [fk];
    const target = ir.entities.find(e => e.name === fk.targetEntity);
    if (!target) continue;
    const rest = tenantChain(ir, target, new Set(seen));
    if (rest) return [fk, ...rest];
  }
  return null;
}

async function tenantWalk(
  ctx: WalkContext,
  state: State,
  resolver: Resolver,
  db: pg.Client,
  listen: (label: string, reply: Reply) => void,
  bodies: BodyContext,
  findings: string[]
): Promise<string> {
  const { ir } = ctx;
  const tenancy = ir.auth?.tenancy;
  if (!tenancy) return "no tenancy: nothing to walk";
  const tenantRows = (state.rows.get(tenancy.entity) ?? []).filter(r => r.creator);
  if (tenantRows.length === 0) return "no tenant row made by an actor: nothing to walk";
  const home = tenantRows[0];
  // A member of another team: an actor outside the home team, or a user the walk registers
  let outsider: Caller | undefined;
  for (const caller of state.actors) {
    await refresh(caller, resolver);
    if (!caller.session!.memberships.some(m => same(m.tenant, home.id))) {
      outsider = caller;
      break;
    }
  }
  if (!outsider) {
    if (!ir.auth!.providers.some(p => p.kind === "credentials"))
      return "every actor is a member of the home team and no outsider can register: nothing to walk";
    const client = makeClient(ir, ctx.backend, ctx.baseUrl, listen);
    const email = `walk-outsider-${ctx.seed}@example.com`;
    const fields: Record<string, unknown> = {};
    for (const name of ir.auth!.registerFields) {
      const column = ir.entities.find(e => e.name === ir.auth!.identity)!.columns.find(c => c.name === name)!;
      if (!column.nullable && column.default === undefined) fields[name] = validValue(column, bodies);
    }
    const registered = await client.auth("register", { email, password: "walk-outsider-1", ...fields });
    if (![200, 201, 409].includes(registered.status))
      throw new Error(`could not register an outsider: ${registered.status} ${JSON.stringify(registered.body)}`);
    const login = await client.auth("login", { email, password: "walk-outsider-1" });
    if (login.status !== 200) throw new Error(`could not sign in the outsider: ${login.status}`);
    const user = (login.body as { data: Row }).data;
    outsider = { name: "outsider", client, session: { id: user[identityPk(ir)], user, memberships: [] } };
  }
  // Give the outsider a team of their own when they may make one, so their creates are refused by the rule, not for want of any team
  const tenantEntity = ir.entities.find(e => e.name === tenancy.entity)!;
  const tenantResource = ir.resources.find(r => r.entity === tenancy.entity);
  const tenantCreate = tenantResource?.operations.find(
    (o): o is Extract<OperationIR, { kind: "create" }> => o.kind === "create"
  );
  if (tenantResource && tenantCreate && tenantCreate.rule.kind !== "none") {
    const built = validBody(
      tenantEntity,
      tenantCreate.fields,
      bodies,
      new Set(tenantCreate.ownerField ? [tenantCreate.ownerField] : [])
    );
    if (!built.missing.length)
      await outsider.client.resource({ resource: tenantResource, op: tenantCreate, body: built.body });
  }
  await refresh(outsider, resolver);
  let checked = 0;
  const lookup = async (table: string, column: string, value: unknown): Promise<Row | null> => {
    const { rows } = await db.query(`select * from "${table}" where "${column}" = $1`, [value]);
    return (rows[0] as Row | undefined) ?? null;
  };
  for (const w of state.walkable) {
    const { entity, resource } = w;
    const chain = tenantChain(ir, entity);
    if (!chain) continue;
    for (const row of state.rows.get(entity.name) ?? []) {
      const fresh = await resolver.fresh(entity, row.id);
      if (!fresh) continue;
      // Follow the chain to the tenant this row belongs to
      let current: Row | null = fresh;
      let tenantId: unknown = entity.name === tenancy.entity ? fresh[entity.primaryKey[0]] : undefined;
      for (const fk of chain) {
        const value: unknown = current?.[fk.column];
        if (fk.targetEntity === tenancy.entity) {
          tenantId = value;
          break;
        }
        current = value == null ? null : await lookup(fk.targetTable, fk.targetColumn, value);
      }
      if (!same(tenantId, home.id)) continue;
      checked++;
      const before = JSON.stringify(fresh);
      const who = `outsider on the home team's ${entity.name}`;
      for (const op of resource.operations) {
        if (op.rule.kind === "none") continue;
        if (op.kind === "list") {
          const reply = await outsider.client.resource({ resource, op, query: { page_size: "200" } });
          const body = reply.body as { data?: Row[] } | null;
          if (reply.status < 300 && (body?.data ?? []).some(r => same(r[entity.primaryKey[0]], row.id)))
            findings.push(`${resource.name}.list as ${who}: the row is listed`);
          continue;
        }
        if (op.kind === "create") continue;
        const body = op.kind === "update" ? (updateBody(entity, op, fresh, bodies) ?? {}) : undefined;
        const reply = await outsider.client.resource({ resource, op, id: row.id, body });
        if (reply.status < 300 || ![401, 403, 404].includes(reply.status))
          findings.push(`${resource.name}.${op.kind} as ${who}: ${reply.status} ${message(reply)}`);
      }
      for (const action of ir.actions.filter(
        a => a.resource === resource.name && a.scope === "row" && a.rule.kind !== "none"
      )) {
        const reply = await outsider.client.action({ action, id: row.id, body: actionInput(action, bodies) });
        if (![401, 403, 404].includes(reply.status))
          findings.push(`${callLabel({ action })} as ${who}: ${reply.status} ${message(reply)}`);
      }
      const after = JSON.stringify(await resolver.fresh(entity, row.id));
      if (after !== before) findings.push(`${entity.name} row of the home team changed after the outsider's calls`);
      // A create naming the home team's parent
      const create = resource.operations.find(
        (o): o is Extract<OperationIR, { kind: "create" }> => o.kind === "create"
      );
      if (create && create.rule.kind !== "none" && chain.length) {
        const parent = chain[0];
        const ctxBodies: BodyContext = {
          ...bodies,
          relatedId: (target, column) => {
            if (target === parent.targetEntity && column.name === parent.column) return fresh[parent.column];
            if (ir.auth && target === ir.auth.identity) return outsider!.session!.id;
            return (state.rows.get(target) ?? [])[0]?.id;
          }
        };
        const built = validBody(
          entity,
          create.fields,
          ctxBodies,
          new Set(create.ownerField ? [create.ownerField] : [])
        );
        if (!built.missing.length) {
          const reply = await outsider.client.resource({ resource, op: create, body: built.body });
          if (![401, 403, 404].includes(reply.status))
            findings.push(
              `${resource.name}.create as outsider naming the home team's ${parent.targetEntity}: ${reply.status} ${message(reply)}`
            );
        }
      }
    }
  }
  return `${checked} rows of the home team checked against ${outsider.name}`;
}

async function fuzzWalk(
  ctx: WalkContext,
  state: State,
  resolver: Resolver,
  bodies: BodyContext,
  findings: string[]
): Promise<string> {
  const { ir } = ctx;
  let probes = 0;
  const judge = (what: string, reply: Reply | WalkTimeout, invalid: boolean): void => {
    probes++;
    if (reply instanceof WalkTimeout) {
      findings.push(`${what}: ${reply.message}`);
      return;
    }
    if (reply.status >= 500) findings.push(`${what}: ${reply.status} ${message(reply)}`);
    else if (reply.status < 300 && invalid) findings.push(`${what}: accepted with ${reply.status}`);
    else if (reply.status >= 300 && !ACCEPTED_4XX.has(reply.status))
      findings.push(`${what}: unexpected ${reply.status}`);
  };
  const attempt = async (what: string, invalid: boolean, call: () => Promise<Reply>): Promise<void> => {
    try {
      judge(what, await call(), invalid);
    } catch (error) {
      if (error instanceof WalkTimeout) judge(what, error, invalid);
      else throw error;
    }
  };
  for (const w of state.walkable) {
    const { entity, resource } = w;
    const pk = entity.columns.find(c => c.name === entity.primaryKey[0])!;
    const rows = state.rows.get(entity.name) ?? [];
    for (const op of resource.operations) {
      if (op.rule.kind === "none") continue;
      for (const caller of state.callers) {
        const who = `${resource.name}.${op.kind} as ${caller.name}`;
        switch (op.kind) {
          case "list": {
            const queries: Record<string, string>[] = [
              { page_size: "201" },
              { page_size: "0" },
              { page: "0" },
              { page: "abc" }
            ];
            if (op.sortable.length) queries.push({ sort: "nope:asc" }, { sort: `${op.sortable[0]}:sideways` });
            for (const f of op.filters) {
              const column = entity.columns.find(c => c.name === f)!;
              if (column.type.kind === "scalar" && (column.type.scalar === "string" || column.type.scalar === "text"))
                continue;
              queries.push({ [f]: String(wrongValue(column, bodies)) });
            }
            for (const query of queries)
              await attempt(`${who} with ${JSON.stringify(query)}`, true, () =>
                caller.client.resource({ resource, op, query })
              );
            break;
          }
          case "get":
          case "delete":
            for (const bad of badIds(pk, bodies))
              await attempt(`${who} with ${bad.name}`, bad.shape === "wrong", () =>
                caller.client.resource({ resource, op, id: bad.id })
              );
            break;
          case "update": {
            for (const bad of badIds(pk, bodies))
              await attempt(`${who} with ${bad.name}`, bad.shape === "wrong", () =>
                caller.client.resource({ resource, op, id: bad.id, body: {} })
              );
            const row = rows.find(r => r.creator === caller) ?? rows[0];
            if (!row) break;
            const fresh = await resolver.fresh(entity, row.id);
            if (!fresh) break;
            const valid = updateBody(entity, op, fresh, bodies) ?? {};
            for (const probe of invalidProbes(entity.columns, op.fields, valid, bodies, true))
              await attempt(`${who} with ${probe.name}`, true, () =>
                caller.client.resource({ resource, op, id: row.id, body: probe.body })
              );
            break;
          }
          case "create": {
            const built = buildCreateBody(ir, entity, op, caller, state, bodies);
            if (built.missing.length) break;
            for (const probe of invalidProbes(entity.columns, op.fields, built.body, bodies))
              await attempt(`${who} with ${probe.name}`, true, () =>
                caller.client.resource({ resource, op, body: probe.body })
              );
            break;
          }
        }
      }
    }
    for (const action of ir.actions.filter(a => a.resource === resource.name && a.rule.kind !== "none")) {
      const isIdentity = ir.auth?.identity === entity.name;
      for (const caller of state.callers) {
        const who = `${callLabel({ action })} as ${caller.name}`;
        if (action.scope === "row") {
          for (const bad of badIds(pk, bodies))
            await attempt(`${who} with ${bad.name}`, bad.shape === "wrong", () =>
              caller.client.action({ action, id: bad.id, body: actionInput(action, bodies) })
            );
          if (isIdentity || !action.input.length) continue;
          const row = rows[0];
          if (!row) continue;
          for (const probe of invalidProbes(
            action.input,
            action.input.map(c => c.name),
            actionInput(action, bodies),
            bodies
          ))
            await attempt(`${who} with ${probe.name}`, true, () =>
              caller.client.action({ action, id: row.id, body: probe.body })
            );
        } else if (action.input.length) {
          for (const probe of invalidProbes(
            action.input,
            action.input.map(c => c.name),
            actionInput(action, bodies),
            bodies
          ))
            await attempt(`${who} with ${probe.name}`, true, () => caller.client.action({ action, body: probe.body }));
        }
      }
    }
  }
  for (const action of ir.actions.filter(a => a.scope === "global" && a.rule.kind !== "none" && a.input.length))
    for (const caller of state.callers)
      for (const probe of invalidProbes(
        action.input,
        action.input.map(c => c.name),
        actionInput(action, bodies),
        bodies
      ))
        await attempt(`${callLabel({ action })} as ${caller.name} with ${probe.name}`, true, () =>
          caller.client.action({ action, body: probe.body })
        );
  return `${probes} probes with seed ${ctx.seed}, none answered 5xx or accepted an invalid input`;
}

/** Keys no response may carry, and the shape of a raw key */
function leakWalk(ir: IR, captured: { label: string; body: unknown }[], findings: string[]): string {
  const forbidden = new Set<string>(["password_hash", "key_hash", "token_hash"]);
  if (ir.auth?.passwordColumn) forbidden.add(ir.auth.passwordColumn);
  for (const entity of ir.entities) for (const column of entity.columns) if (column.hidden) forbidden.add(column.name);
  const rawKey = /\bosl_[a-z0-9]+_[A-Za-z0-9]{24,}\b/;
  const scan = (value: unknown, path: string, label: string): void => {
    if (findings.length >= MAX_FINDINGS) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => scan(item, `${path}[${i}]`, label));
      return;
    }
    if (typeof value === "string") {
      if (rawKey.test(value)) findings.push(`${label}: ${path} carries what looks like a raw key`);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) findings.push(`${label}: ${path ? `${path}.` : ""}${key} must never be in a response`);
      scan(child, path ? `${path}.${key}` : key, label);
    }
  };
  for (const { label, body } of captured) scan(body, "", label);
  return `${captured.length} bodies scanned for ${forbidden.size} forbidden keys`;
}

/** Every breaking change between consecutive revisions is explained by an op of the revision's diff */
async function contractWalk(ctx: WalkContext, findings: string[]): Promise<string> {
  const project = await loadProject(ctx.projectDir);
  const revisions = project.lock.revisions;
  let changes = 0;
  const rewrites: string[] = [];
  for (let i = 1; i < revisions.length; i++) {
    const prev = revisions[i - 1];
    const next = revisions[i];
    const breaking = diffOpenApi(openapiDocument(prev.ir), openapiDocument(next.ir));
    changes += breaking.length;
    const intent = await readIntent(ctx.projectDir, next.intent);
    const ops = intent.diff?.ops ?? [];
    for (const change of breaking)
      if (!explainedBy(change, ops, prev.ir))
        findings.push(`${next.intent}: ${change.detail}, which no op of its diff explains`);
    for (const step of planMigration(prev.ir, next.ir, next.renames).rewrites)
      rewrites.push(`${next.intent}: ${describeStep(step)}`);
  }
  return `${revisions.length} revisions, ${changes} breaking changes, all explained${rewrites.length ? `; table rewrites: ${rewrites.join(", ")}` : ""}`;
}

function describeStep(step: MigrationStep): string {
  switch (step.kind) {
    case "alter_column_type":
      return `${step.table}.${step.column.name} changes type`;
    case "set_not_null":
      return `${step.table}.${step.column} becomes NOT NULL`;
    default:
      return step.kind;
  }
}

export type { ColumnIR };
