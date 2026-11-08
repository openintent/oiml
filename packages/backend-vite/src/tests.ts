/**
 * Contract tests over tRPC's HTTP transport. The scenarios are written against the REST-shaped
 * contract (status codes, { data } bodies), so the client speaks that contract: it calls
 * procedures, unwraps results into the contract's shape, and reports tRPC errors as statuses.
 */
import type { GeneratedFile, IR, OperationIR, SeedStepIR, StepIR } from "@osl/core";
import { slugify } from "@osl/core";
import {
  actorsDecl,
  assertNoHiddenSource,
  bodyCheck,
  captureLines,
  hiddenColumnsDecl,
  matchersSource,
  needsProvisioning,
  provisionSource,
  stepTitle,
  vitestConfigFile as sharedVitestConfig
} from "@osl/ts-common";
import { HEADER, VITE, column, entityByName, q } from "./util.js";

type Coercion = "int" | "number" | "boolean" | "string";

/** How each list filter sent as a query-string value in a scenario becomes a typed input. */
function coercions(ir: IR): Record<string, Record<string, Coercion>> {
  const out: Record<string, Record<string, Coercion>> = {};
  for (const resource of ir.resources) {
    const list = resource.operations.find(o => o.kind === "list") as Extract<OperationIR, { kind: "list" }> | undefined;
    if (!list) continue;
    const entity = entityByName(ir, resource.entity);
    const map: Record<string, Coercion> = { page: "int", page_size: "int" };
    for (const f of list.filters) {
      const t = column(entity, f).type;
      if (t.kind === "scalar" && (t.scalar === "integer" || t.scalar === "bigint")) map[f] = "int";
      else if (t.kind === "scalar" && (t.scalar === "float" || t.scalar === "decimal")) map[f] = "number";
      else if (t.kind === "scalar" && t.scalar === "boolean") map[f] = "boolean";
      else map[f] = "string";
    }
    out[`${resource.name}.list`] = map;
  }
  return out;
}

/** generated/tests/_client.ts */
export function testClientFile(ir: IR): string {
  return `${HEADER("Contract test client over tRPC's HTTP transport.")}
${needsProvisioning(ir) ? 'import { Client as PgClient } from "pg";\n' : ""}
export const BASE_URL = process.env.OSL_BASE_URL ?? "http://localhost:3111";

${hiddenColumnsDecl(ir)}

/** Query-string values a scenario sends to a list, by the type its filter expects */
const COERCE: Record<string, Record<string, "int" | "number" | "boolean" | "string">> = ${JSON.stringify(coercions(ir), null, 2)};

export interface Reply {
  status: number;
  body: unknown;
}

/** What the contract's body looks like for a procedure's result */
export type Shape = "list" | "data" | "none";

export class Client {
  cookie = "";

  /**
   * Call a procedure and answer in the REST contract's terms: a successful call is a 200 whose body is
   * { data } (or the list's { data, page }), a failed one carries tRPC's HTTP status and { error }.
   */
  async call(procedure: string, input: unknown, kind: "query" | "mutation", shape: Shape): Promise<Reply> {
    const url = new URL("/trpc/" + procedure, BASE_URL);
    const headers: Record<string, string> = {};
    if (this.cookie) headers["cookie"] = this.cookie;
    let init: RequestInit;
    if (kind === "query") {
      if (input !== undefined) url.searchParams.set("input", JSON.stringify(input));
      init = { method: "GET", headers };
    } else {
      if (input !== undefined) headers["content-type"] = "application/json";
      init = { method: "POST", headers, body: input !== undefined ? JSON.stringify(input) : undefined };
    }
    const response = await fetch(url, { ...init, redirect: "manual" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!response.ok) {
      const error = (json as { error?: { message?: string; data?: { code?: string } } } | null)?.error;
      return {
        status: response.status,
        body: { error: { code: String(error?.data?.code ?? "error").toLowerCase(), message: error?.message ?? text } }
      };
    }
    const data = (json as { result?: { data?: unknown } } | null)?.result?.data;
    assertNoHidden(data, procedure);
    const body = shape === "list" ? data : shape === "data" ? { data } : null;
    return { status: response.status, body };
  }

  /** The contract's files.upload: begin, PUT the bytes where told, complete. Answers the completed file, or the step that failed. */
  async upload(input: { name: string; type: string; content: string }): Promise<Reply> {
    const bytes = Buffer.from(input.content, "utf8");
    const begun = await this.call("files.begin", { name: input.name, type: input.type, size: bytes.byteLength }, "mutation", "data");
    if (begun.status !== 200) return begun;
    const file = (begun.body as { data: { id: string; upload: { url: string; method: string; headers: Record<string, string> } } }).data;
    const headers: Record<string, string> = { ...file.upload.headers };
    if (this.cookie) headers["cookie"] = this.cookie;
    const put = await fetch(new URL(file.upload.url, BASE_URL), { method: file.upload.method, headers, body: bytes });
    if (!put.ok) return { status: put.status, body: { error: { code: "upload_failed", message: await put.text() } } };
    return this.call("files.complete", { id: file.id }, "mutation", "data");
  }
}

/** Turn a scenario's query-string values into the typed input a list expects. */
export function coerce(procedure: string, query: Record<string, unknown>): Record<string, unknown> {
  const map = COERCE[procedure] ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(query)) {
    const how = map[key] ?? "string";
    if (how === "int" || how === "number") out[key] = typeof raw === "number" ? raw : Number(raw);
    else if (how === "boolean") out[key] = raw === true || raw === "true";
    else out[key] = typeof raw === "string" ? raw : String(raw);
  }
  return out;
}

${assertNoHiddenSource()}

${actorsDecl(ir)}

${provisionSource(ir)}

export interface ActorSession {
  client: Client;
  id: unknown;
}

/** Registers an actor; an account that already exists is fine. */
async function register(name: string): Promise<void> {
  const definition = ACTORS[name];
  if (!definition) throw new Error("unknown actor " + name);
  const registered = await new Client().call(
    "auth.register",
    { email: definition.email, password: definition.password, ...definition.fields },
    "mutation",
    "data"
  );
  if (registered.status !== 200 && registered.status !== 409) {
    throw new Error("could not register " + name + ": " + registered.status + " " + JSON.stringify(registered.body));
  }
  await provision(name);
}

/** Registers every actor, so a scenario may sign one in explicitly before acting as it. */
export async function registerActors(): Promise<void> {
  for (const name of Object.keys(ACTORS)) await register(name);
}

/** Registers the actor if needed, then signs in. */
export async function actor(name: string): Promise<ActorSession> {
  const definition = ACTORS[name];
  if (!definition) throw new Error("unknown actor " + name);
  await register(name);
  const client = new Client();
  const login = await client.call("auth.login", { email: definition.email, password: definition.password }, "mutation", "data");
  if (login.status !== 200) throw new Error("could not sign in " + name + ": " + login.status + " " + JSON.stringify(login.body));
  return { client, id: pick(login.body, "data.id") };
}

${matchersSource()}
`;
}

/** One vitest file per scenario. Steps run in order and share captured values. */
export function scenarioTestFiles(ir: IR): GeneratedFile[] {
  return ir.examples.scenarios.map((scenario, index) => {
    const actors = [...new Set(scenario.steps.map(s => s.as).filter((a): a is string => Boolean(a)))].sort();
    const steps = scenario.steps.map((step, i) => stepTest(ir, step, i + 1)).join("\n\n");
    return {
      path: `generated/tests/${String(index + 1).padStart(2, "0")}_${slugify(scenario.name)}.test.ts`,
      content: `${HEADER(`Contract test for the scenario "${scenario.name}".`)}
import { beforeAll, describe, expect, it } from "vitest";
import { Client, actor, coerce, matches, pick, registerActors, resolve, type ActorSession } from "./_client";

describe(${q(scenario.name)}, () => {
  const actors: Record<string, ActorSession> = {};
  const vars: Record<string, unknown> = {};

  beforeAll(async () => {
    await registerActors();
${actors.map(a => `    actors.${a} = await actor(${q(a)});`).join("\n")}
  });

${steps}
});
`
    };
  });
}

/** The client call of a step: `client.call(...)` or `client.upload(...)`, as an expression over `scope` */
function callExpr(ir: IR, step: SeedStepIR): string {
  const idExpr = () => {
    const raw = step.pathParams.id;
    if (raw === undefined) throw new Error(`step ${step.op} needs path.id`);
    return `resolve(${q(raw)}, scope)`;
  };
  const body = step.body === undefined ? "{}" : `resolve(${JSON.stringify(step.body)}, scope)`;
  const call = (procedure: string, input: string, kind: "query" | "mutation", shape: "list" | "data" | "none") =>
    `client.call(${q(procedure)}, ${input}, ${q(kind)}, ${q(shape)})`;
  switch (step.kind) {
    case "resource": {
      const procedure = `${step.resource}.${step.operation}`;
      switch (step.operation) {
        case "list":
          return call(
            procedure,
            Object.keys(step.query).length
              ? `coerce(${q(procedure)}, resolve(${JSON.stringify(step.query)}, scope) as Record<string, unknown>)`
              : "{}",
            "query",
            "list"
          );
        case "get":
          return call(procedure, `{ id: ${idExpr()} }`, "query", "data");
        case "create":
          return call(procedure, body, "mutation", "data");
        case "update":
          return call(procedure, `{ id: ${idExpr()}, data: ${body} }`, "mutation", "data");
        case "delete":
          return call(procedure, `{ id: ${idExpr()} }`, "mutation", "none");
      }
      break;
    }
    case "action": {
      const action = ir.actions.find(a => a.name === step.operation && a.resource === step.resource)!;
      const procedure = step.resource ? `${step.resource}.${step.operation}` : `actions.${step.operation}`;
      const shape = action.returns.kind === "none" ? "none" : "data";
      const input = action.scope === "row" ? `{ ...(${body} as object), id: ${idExpr()} }` : body;
      return call(procedure, input, "mutation", shape);
    }
    case "auth":
      switch (step.operation) {
        case "register":
        case "login":
        case "magic_link":
        case "magic_link_verify":
          return call(`auth.${step.operation}`, body, "mutation", "data");
        case "logout":
          return call("auth.logout", "undefined", "mutation", "none");
        case "me":
          return call("auth.me", "undefined", "query", "data");
      }
      break;
    case "file":
      if (step.operation === "upload")
        return `client.upload(${body} as { name: string; type: string; content: string })`;
      return call("files.get", `{ id: ${idExpr()} }`, "query", "data");
  }
  throw new Error(`unsupported step ${step.op}`);
}

/** Successes are plain 200s over tRPC; the contract's 201 and 204 are the same outcome. */
function expectedStatus(step: StepIR): number {
  return step.expect.status === 201 || step.expect.status === 204 ? 200 : step.expect.status;
}

function stepTest(ir: IR, step: StepIR, number: number): string {
  const who = step.as ? `actors.${step.as}` : null;
  return `  it(${q(stepTitle(step, number))}, async () => {
    const client = ${who ? `${who}.client` : "new Client()"};
    const scope = { ...vars, actor: { id: ${who ? `${who}.id` : "null"} } };
    const reply = await ${callExpr(ir, step)};
    expect(reply.status, JSON.stringify(reply.body)).toBe(${expectedStatus(step)});
${bodyCheck(step)}
${captureLines(step).join("\n")}
  });`;
}

/** generated/seed.ts: replays the model's seed steps against a running API (OSL_BASE_URL). */
export function seedFile(ir: IR): string {
  const steps = ir.examples.seed.map((step, i) => {
    const who = step.as ? `await session(${q(step.as)})` : null;
    const captures = Object.entries(step.capture).map(
      ([name, path]) => `    vars.${name} = pick(reply.body, ${q(path)});`
    );
    return `  {
    const client = ${who ? "(" + who + ").client" : "anonymous"};
    const scope = { ...vars, actor: { id: ${who ? `(${who}).id` : "null"} } };
    const reply = await ${callExpr(ir, step)};
    report(${i + 1}, ${q(step.name ?? step.op)}, reply);
${captures.join("\n")}
  }`;
  });
  return `${HEADER("Seed: replays examples.seed against a running API. Rows that already exist (409) are skipped.")}
import { Client, actor, coerce, pick, resolve, type ActorSession } from "./tests/_client";

const anonymous = new Client();
const actors: Record<string, ActorSession> = {};
const vars: Record<string, unknown> = {};

async function session(name: string): Promise<ActorSession> {
  return (actors[name] ??= await actor(name));
}

function report(step: number, name: string, reply: { status: number; body: unknown }): void {
  if (reply.status === 409) console.log("skip " + step + " " + name + " (already there)");
  else if (reply.status >= 400) {
    console.error("fail " + step + " " + name + ": " + reply.status + " " + JSON.stringify(reply.body));
    process.exitCode = 1;
  } else console.log("ok   " + step + " " + name);
}

async function main(): Promise<void> {
${steps.join("\n")}
  void coerce;
  void resolve;
}

await main();
`;
}

export function vitestConfigFile(): string {
  return sharedVitestConfig(VITE);
}
