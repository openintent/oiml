import type { GeneratedFile, IR, SeedStepIR, StepIR } from "@osl/core";
import { slugify } from "@osl/core";
import {
  actorsDecl,
  assertNoHiddenSource,
  bodyCheck,
  carriesImport,
  captureLines,
  hiddenColumnsDecl,
  matchersSource,
  needsProvisioning,
  provisionSource,
  stepTitle,
  vitestConfigFile as sharedVitestConfig
} from "@osl/ts-common";
import { HEADER, NEXT, q } from "./util.js";

/** generated/tests/_client.ts: an HTTP client with a cookie jar, actors and partial matching. */
export function testClientFile(ir: IR): string {
  return `${HEADER("Contract test client.")}
${needsProvisioning(ir) ? 'import { Client as PgClient } from "pg";\n' : ""}
export const BASE_URL = process.env.OSL_BASE_URL ?? "http://localhost:3000";

${hiddenColumnsDecl(ir)}

export interface Reply {
  status: number;
  body: unknown;
}

export class Client {
  cookie = "";

  async request(method: string, path: string, options: { query?: Record<string, string>; body?: unknown } = {}): Promise<Reply> {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers["cookie"] = this.cookie;
    const response = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      redirect: "manual"
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await response.text();
    let body: unknown = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    assertNoHidden(body, path);
    return { status: response.status, body };
  }

  /** The contract's files.upload: begin, PUT the bytes where told, complete. Answers the completed file, or the step that failed. */
  async upload(input: { name: string; type: string; content: string }): Promise<Reply> {
    const bytes = Buffer.from(input.content, "utf8");
    const begun = await this.request("POST", "/api/files", { body: { name: input.name, type: input.type, size: bytes.byteLength } });
    if (begun.status !== 201) return begun;
    const file = (begun.body as { data: { id: string; upload: { url: string; method: string; headers: Record<string, string> } } }).data;
    const headers: Record<string, string> = { ...file.upload.headers };
    if (this.cookie) headers["cookie"] = this.cookie;
    const put = await fetch(new URL(file.upload.url, BASE_URL), { method: file.upload.method, headers, body: bytes });
    if (!put.ok) return { status: put.status, body: { error: { code: "upload_failed", message: await put.text() } } };
    return this.request("POST", "/api/files/" + file.id + "/complete");
  }
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
  const registered = await new Client().request("POST", "/api/auth/register", {
    body: { email: definition.email, password: definition.password, ...definition.fields }
  });
  if (registered.status !== 201 && registered.status !== 409) {
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
  const login = await client.request("POST", "/api/auth/login", { body: { email: definition.email, password: definition.password } });
  if (login.status !== 200) throw new Error("could not sign in " + name + ": " + login.status + " " + JSON.stringify(login.body));
  return { client, id: pick(login.body, "data.id") };
}

${matchersSource(ir)}
`;
}

/** One vitest file per scenario. Steps run in order and share captured values. */
export function scenarioTestFiles(ir: IR): GeneratedFile[] {
  return ir.examples.scenarios.map((scenario, index) => {
    const actors = [...new Set(scenario.steps.map(s => s.as).filter((a): a is string => Boolean(a)))].sort();
    const steps = scenario.steps.map((step, i) => stepTest(step, i + 1)).join("\n\n");
    return {
      path: `generated/tests/${String(index + 1).padStart(2, "0")}_${slugify(scenario.name)}.test.ts`,
      content: `${HEADER(`Contract test for the scenario "${scenario.name}".`)}
import { beforeAll, describe, expect, it } from "vitest";
import { Client, actor, ${carriesImport(scenario.steps)}matches, pick, registerActors, resolve, type ActorSession } from "./_client";

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

/** The client call of a step, as an expression over `scope` */
function callExpr(step: SeedStepIR): string {
  if (step.kind === "file" && step.operation === "upload") {
    return `client.upload(resolve(${JSON.stringify(step.body ?? {})}, scope) as { name: string; type: string; content: string })`;
  }
  const pathExpr = step.pathTemplate
    .split(/(\{[a-z_]+\})/)
    .filter(Boolean)
    .map(part => {
      const m = part.match(/^\{([a-z_]+)\}$/);
      if (!m) return q(part);
      const raw = step.pathParams[m[1]];
      if (raw === undefined) throw new Error(`step ${step.op} needs path.${m[1]}`);
      return `encodeURIComponent(String(resolve(${q(raw)}, scope)))`;
    })
    .join(" + ");
  const options: string[] = [];
  if (Object.keys(step.query).length)
    options.push(`query: resolve(${JSON.stringify(step.query)}, scope) as Record<string, string>`);
  if (step.body !== undefined) options.push(`body: resolve(${JSON.stringify(step.body)}, scope)`);
  else if (step.kind === "action") options.push("body: {}");
  return `client.request(${q(step.method)}, ${pathExpr}, { ${options.join(", ")} })`;
}

function stepTest(step: StepIR, number: number): string {
  const who = step.as ? `actors.${step.as}` : null;
  return `  it(${q(stepTitle(step, number))}, async () => {
    const client = ${who ? `${who}.client` : "new Client()"};
    const scope = { ...vars, actor: { id: ${who ? `${who}.id` : "null"} } };
    const reply = await ${callExpr(step)};
    expect(reply.status, JSON.stringify(reply.body)).toBe(${step.expect.status});
${bodyCheck(step)}
${captureLines(step).join("\n")}
  });`;
}

/** generated/seed.ts: replays the model's seed steps against a running app (OSL_BASE_URL). */
export function seedFile(ir: IR): string {
  const steps = ir.examples.seed.map((step, i) => {
    const who = step.as ? `await session(${q(step.as)})` : null;
    const captures = Object.entries(step.capture).map(
      ([name, path]) => `    vars.${name} = pick(reply.body, ${q(path)});`
    );
    return `  {
    const client = ${who ? "(" + who + ").client" : "anonymous"};
    const scope = { ...vars, actor: { id: ${who ? `(${who}).id` : "null"} } };
    const reply = await ${callExpr(step)};
    report(${i + 1}, ${q(step.name ?? step.op)}, reply);
${captures.join("\n")}
  }`;
  });
  return `${HEADER("Seed: replays examples.seed against a running app. Rows that already exist (409) are skipped.")}
import { Client, actor, pick, resolve, type ActorSession } from "./tests/_client";

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
  void resolve;
}

await main();
`;
}

export function vitestConfigFile(): string {
  return sharedVitestConfig(NEXT);
}
