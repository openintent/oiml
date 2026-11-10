/**
 * The harness's own client for a running app, one per transport: REST for drizzle-next and gin-pgx, tRPC's HTTP
 * transport for hono-trpc-vite. It speaks the contract the generated test clients speak (a cookie jar, the same
 * paths and procedure names, errors as `{ error: { code, message } }`) so the walks can call any operation of
 * any backend from one description, and every reply passes through a listener for the leak walk.
 */
import type { ActionIR, ColumnIR, IR, OperationIR, ResourceIR } from "@osl/core";

export interface Reply {
  status: number;
  body: unknown;
}

/** Told of every reply before the caller goes on; `client` is the cookie jar that made the call */
export type Listener = (label: string, reply: Reply, client: HarnessClient) => void | Promise<void>;

export interface ResourceCall {
  resource: ResourceIR;
  op: OperationIR;
  id?: unknown;
  body?: unknown;
  query?: Record<string, string>;
}

export interface ActionCall {
  action: ActionIR;
  id?: unknown;
  body?: unknown;
}

export type AuthKind = "register" | "login" | "logout" | "me";

export interface HarnessClient {
  resource(call: ResourceCall): Promise<Reply>;
  action(call: ActionCall): Promise<Reply>;
  auth(kind: AuthKind, body?: unknown): Promise<Reply>;
  /** What the session is told of the fields with a read rule (`fields` beside the user), or null without a session */
  fields(): Promise<unknown>;
  /** A request as the transport spells it, for probes the typed calls cannot express */
  raw(method: string, path: string, body?: unknown, query?: Record<string, string>): Promise<Reply>;
  /** A client with its own cookie jar */
  fresh(): HarnessClient;
}

/** A call that did not answer within the deadline */
export class WalkTimeout extends Error {}

const DEADLINE_MS = 10_000;

export function makeClient(ir: IR, backend: string, baseUrl: string, listen: Listener): HarnessClient {
  return backend === "hono-trpc-vite" ? new TrpcClient(ir, baseUrl, listen) : new RestClient(ir, baseUrl, listen);
}

/** The label a reply is recorded under: the operation or procedure and who called it is added by the walk */
export function callLabel(call: ResourceCall | ActionCall): string {
  return "action" in call
    ? `${call.action.resource ?? "actions"}.${call.action.name}`
    : `${call.resource.name}.${call.op.kind}`;
}

abstract class BaseClient implements HarnessClient {
  protected cookie = "";

  constructor(
    protected readonly ir: IR,
    protected readonly baseUrl: string,
    protected readonly listen: Listener
  ) {}

  abstract resource(call: ResourceCall): Promise<Reply>;
  abstract action(call: ActionCall): Promise<Reply>;
  abstract auth(kind: AuthKind, body?: unknown): Promise<Reply>;
  abstract fields(): Promise<unknown>;
  abstract fresh(): HarnessClient;

  async raw(method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<Reply> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return this.send(`${method} ${path}`, url, method, body);
  }

  /** One HTTP exchange with the cookie jar and the deadline; the body parsed as JSON when it is JSON */
  protected async send(label: string, url: URL, method: string, body?: unknown): Promise<Reply> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers["cookie"] = this.cookie;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(DEADLINE_MS)
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError")
        throw new WalkTimeout(`${label} did not answer within ${DEADLINE_MS / 1000}s`);
      throw error;
    }
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    const reply = { status: response.status, body: parsed };
    await this.listen(label, reply, this);
    return reply;
  }
}

/** drizzle-next and gin-pgx: the paths of the IR, PATCH for update, 201 and 204 as the contract says */
class RestClient extends BaseClient {
  fresh(): HarnessClient {
    return new RestClient(this.ir, this.baseUrl, this.listen);
  }

  async resource(call: ResourceCall): Promise<Reply> {
    const url = new URL(withId(call.op.path, call.id), this.baseUrl);
    for (const [key, value] of Object.entries(call.query ?? {})) url.searchParams.set(key, value);
    const body = call.op.kind === "create" || call.op.kind === "update" ? (call.body ?? {}) : undefined;
    return this.send(callLabel(call), url, call.op.method, body);
  }

  async action(call: ActionCall): Promise<Reply> {
    const url = new URL(withId(call.action.path, call.id), this.baseUrl);
    return this.send(callLabel(call), url, "POST", call.body ?? {});
  }

  async auth(kind: AuthKind, body?: unknown): Promise<Reply> {
    const url = new URL(`/api/auth/${kind}`, this.baseUrl);
    return this.send(`auth.${kind}`, url, kind === "me" ? "GET" : "POST", kind === "me" ? undefined : (body ?? {}));
  }

  async fields(): Promise<unknown> {
    const reply = await this.auth("me");
    return (reply.body as { fields?: unknown } | null)?.fields ?? null;
  }
}

/** hono-trpc-vite: procedures over tRPC's HTTP transport, answered in the REST contract's terms */
class TrpcClient extends BaseClient {
  fresh(): HarnessClient {
    return new TrpcClient(this.ir, this.baseUrl, this.listen);
  }

  async resource(call: ResourceCall): Promise<Reply> {
    const procedure = `${call.resource.name}.${call.op.kind}`;
    switch (call.op.kind) {
      case "list":
        return this.call(procedure, this.coerceQuery(call), "query", "list");
      case "get":
        return this.call(procedure, { id: call.id }, "query", "data");
      case "create":
        return this.call(procedure, call.body ?? {}, "mutation", "data");
      case "update":
        return this.call(procedure, { id: call.id, data: call.body ?? {} }, "mutation", "data");
      case "delete":
        return this.call(procedure, { id: call.id }, "mutation", "none");
    }
  }

  async action(call: ActionCall): Promise<Reply> {
    const { action } = call;
    const procedure = `${action.resource ?? "actions"}.${action.name}`;
    const body = (call.body ?? {}) as object;
    const input = action.scope === "row" ? { ...body, id: call.id } : body;
    return this.call(procedure, input, "mutation", action.returns.kind === "none" ? "none" : "data");
  }

  async auth(kind: AuthKind, body?: unknown): Promise<Reply> {
    if (kind === "me") return this.call("auth.me", undefined, "query", "data");
    if (kind === "logout") return this.call("auth.logout", undefined, "mutation", "none");
    return this.call(`auth.${kind}`, body ?? {}, "mutation", "data");
  }

  /** Under tRPC the answer is on the session the web app asks for */
  async fields(): Promise<unknown> {
    const reply = await this.call("auth.session", undefined, "query", "data");
    return (reply.body as { data?: { fields?: unknown } | null } | null)?.data?.fields ?? null;
  }

  /** A scenario's query-string values as the typed input the list expects, as the generated client coerces them */
  private coerceQuery(call: ResourceCall): Record<string, unknown> {
    const entity = this.ir.entities.find(e => e.name === call.resource.entity)!;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(call.query ?? {})) {
      const column = entity.columns.find(c => c.name === key);
      const how =
        key === "page" || key === "page_size"
          ? "int"
          : key === "archived" && entity.archive
            ? "boolean"
            : coercion(column);
      if (how === "int" || how === "number") out[key] = numeric(raw) ? Number(raw) : raw;
      else if (how === "boolean") out[key] = raw === "true" ? true : raw === "false" ? false : raw;
      else out[key] = raw;
    }
    return out;
  }

  private async call(
    procedure: string,
    input: unknown,
    kind: "query" | "mutation",
    shape: "list" | "data" | "none"
  ): Promise<Reply> {
    const url = new URL(`/trpc/${procedure}`, this.baseUrl);
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
    let response: Response;
    try {
      response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(DEADLINE_MS) });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError")
        throw new WalkTimeout(`${procedure} did not answer within ${DEADLINE_MS / 1000}s`);
      throw error;
    }
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
    let reply: Reply;
    if (!response.ok) {
      const error = (json as { error?: { message?: string; data?: { code?: string } } } | null)?.error;
      reply = {
        status: response.status,
        body: { error: { code: String(error?.data?.code ?? "error").toLowerCase(), message: error?.message ?? text } }
      };
    } else {
      const data = (json as { result?: { data?: unknown } } | null)?.result?.data;
      reply = { status: response.status, body: shape === "list" ? data : shape === "data" ? { data } : null };
    }
    await this.listen(procedure, reply, this);
    return reply;
  }
}

function withId(path: string, id: unknown): string {
  return path.replace("{id}", encodeURIComponent(String(id ?? "")));
}

function coercion(column: ColumnIR | undefined): "int" | "number" | "boolean" | "string" {
  if (!column || column.type.kind !== "scalar") return "string";
  switch (column.type.scalar) {
    case "integer":
    case "bigint":
      return "int";
    case "float":
    case "decimal":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

function numeric(raw: string): boolean {
  return raw.trim() !== "" && !Number.isNaN(Number(raw));
}
