/**
 * generated/app/client.ts: the typed call surface the pages use. Both backends expose the same shape
 * (`client.posts.list(input)`, `client.posts.publish({ id, ...input })`, `client.auth.session()`), so
 * the pages are the same code; only this module differs.
 */
import type { ActionIR, EntityIR, IR, OperationIR, ResourceIR } from "@osl/core";
import { actionsOf, anonymousCouldRead, globalActions, hasFieldRules, ruledColumns } from "@osl/core";
import { entityByName, q, typeName, type TsConventions } from "../conventions.js";
import { hasInvites } from "../invites.js";
import { actionInputName } from "../validation.js";

function isIntegerKey(entity: EntityIR): boolean {
  const pk = entity.columns.find(c => c.name === entity.primaryKey[0])!;
  return pk.type.kind === "scalar" && (pk.type.scalar === "integer" || pk.type.scalar === "bigint");
}

/** The presented row type of a resource operation, with its includes */
function outputType(ir: IR, resource: ResourceIR, include: string[], through: string[] = []): string {
  const entity = entityByName(ir, resource.entity);
  const base = `Public${typeName(entity)}`;
  if (!include.length && !through.length) return base;
  const extras = include.map(name => {
    const rel = entity.relations.find(r => r.name === name)!;
    const target = `Public${typeName(entityByName(ir, rel.target))}`;
    return `${name}: ${rel.kind === "many" ? `${target}[]` : `${target} | null`}`;
  });
  // Relations through a junction: the far rows
  for (const name of through)
    extras.push(`${name}: Public${typeName(entityByName(ir, entity.through!.find(t => t.name === name)!.target))}[]`);
  return `${base} & { ${extras.join("; ")} }`;
}

function actionResult(ir: IR, action: ActionIR): string {
  if (action.returns.kind === "entity") return `Public${typeName(entityByName(ir, action.entity!))}`;
  if (action.returns.kind === "none") return "null";
  return `{ ${action.returns.fields.map(f => `${f.name}: ${fieldTs(f)}`).join("; ")} }`;
}

function fieldTs(f: ActionIR["input"][number]): string {
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

/** The tRPC-backed client (hono-trpc-vite) */
export function trpcClientFile(ir: IR, conv: TsConventions): string {
  const resources = ir.resources.map(r => {
    const ops = r.operations.filter(o => o.rule.kind !== "none");
    const lines = ops.map(op => {
      switch (op.kind) {
        case "list":
          return `    list: (input: Inputs[${q(r.name)}]["list"]) => trpc.${r.name}.list.query(input)`;
        case "get":
          return `    get: (input: Inputs[${q(r.name)}]["get"]) => trpc.${r.name}.get.query(input)`;
        case "create":
          // An invite's create answers the row beside what a test reads; the pages get the row
          return op.invite
            ? `    create: (input: Inputs[${q(r.name)}]["create"]) => trpc.${r.name}.create.mutate(input).then(reply => reply.data)`
            : `    create: (input: Inputs[${q(r.name)}]["create"]) => trpc.${r.name}.create.mutate(input)`;
        case "update":
          return `    update: (input: Inputs[${q(r.name)}]["update"]) => trpc.${r.name}.update.mutate(input)`;
        case "delete":
          return `    delete: (input: Inputs[${q(r.name)}]["delete"]) => trpc.${r.name}.delete.mutate(input)`;
      }
    });
    for (const a of actionsOf(ir, r.name).filter(a => a.rule.kind !== "none"))
      lines.push(
        `    ${a.name}: (input: Inputs[${q(r.name)}][${q(a.name)}]) => trpc.${r.name}.${a.name}.mutate(input)`
      );
    return `  ${r.name}: {\n${lines.join(",\n")}\n  }`;
  });
  const globals = globalActions(ir).filter(a => a.rule.kind !== "none");
  const auth = ir.auth;
  const authLines = [
    `    session: () => trpc.auth.session.query()`,
    `    providers: () => trpc.auth.providers.query()`,
    ...(auth
      ? [
          `    me: () => trpc.auth.me.query()`,
          `    logout: () => trpc.auth.logout.mutate()`,
          ...(auth.providers.some(p => p.kind === "credentials")
            ? [
                `    login: (input: Inputs["auth"]["login"]) => trpc.auth.login.mutate(input)`,
                `    register: (input: Inputs["auth"]["register"]) => trpc.auth.register.mutate(input)`
              ]
            : []),
          ...(auth.providers.some(p => p.kind === "magic_link")
            ? [
                `    magic_link: (input: Inputs["auth"]["magic_link"]) => trpc.auth.magic_link.mutate(input)`,
                `    magic_link_verify: (input: Inputs["auth"]["magic_link_verify"]) => trpc.auth.magic_link_verify.mutate(input)`
              ]
            : []),
          ...(hasInvites(ir)
            ? [
                `    invite: (input: Inputs["auth"]["invite"]) => trpc.auth.invite.query(input)`,
                `    invite_accept: (input: Inputs["auth"]["invite_accept"]) => trpc.auth.invite_accept.mutate(input)`
              ]
            : [])
        ]
      : [])
  ];
  return `${conv.header("The typed client the pages call. Same call surface on every backend; this one speaks tRPC.")}
import { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../server/router";
${hasFieldRules(ir) ? `import type { VisibleFields } from "../present";\n` : ""}
/** The HTTP status the API answered a failed call with, when it answered */
export function errorStatus(error: unknown): number | undefined {
  const status = (error as { data?: { httpStatus?: unknown } } | null)?.data?.httpStatus;
  return typeof status === "number" ? status : undefined;
}

/** A request the server refused as asked: the same request would fail again, so it is not retried. */
function isRefused(error: unknown): boolean {
  const status = errorStatus(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (failureCount, error) => !isRefused(error) && failureCount < 3
    }
  }
});

const trpc = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: "/trpc" })] });

export type Inputs = inferRouterInputs<AppRouter>;
export type Outputs = inferRouterOutputs<AppRouter>;
export type ApiError = { message: string };

export const client = {
  auth: {
${authLines.join(",\n")}
  },${
    ir.files
      ? `
  files: {
    begin: (input: Inputs["files"]["begin"]) => trpc.files.begin.mutate(input),
    complete: (input: Inputs["files"]["complete"]) => trpc.files.complete.mutate(input),
    get: (input: Inputs["files"]["get"]) => trpc.files.get.query(input)
  },`
      : ""
  }${
    globals.length
      ? `
  actions: {
${globals.map(a => `    ${a.name}: (input: Inputs["actions"][${q(a.name)}]) => trpc.actions.${a.name}.mutate(input)`).join(",\n")}
  },`
      : ""
  }
${resources.join(",\n")}
};

${sessionHelpers(ir)}
`;
}

/** `fieldsOf`: which fields with a read rule the viewer could read on some row, from the session or, for a visitor, from the rules */
function fieldHelpers(ir: IR): string {
  if (!hasFieldRules(ir)) return "";
  const visitor = ir.resources
    .map(r => ({ r, columns: ruledColumns(entityByName(ir, r.entity)) }))
    .filter(x => x.columns.length)
    .map(x => `  ${x.r.name}: { ${x.columns.map(c => `${c.name}: ${anonymousCouldRead(c.read!)}`).join(", ")} }`)
    .join(",\n");
  return `

/** What a visitor could read of the fields with a read rule: nobody is signed in, so the rules alone answer */
const VISITOR_FIELDS: VisibleFields = {
${visitor}
};

/**
 * Per resource, whether the viewer could read each field that has a read rule on some row. A page leaves out the
 * column and the input of a field they could not; a row still leaves out what its own rule refuses.
 */
export function fieldsOf(session: Session | undefined): VisibleFields {
  return (session as { fields?: VisibleFields } | null | undefined)?.fields ?? VISITOR_FIELDS;
}`;
}

function sessionHelpers(ir: IR): string {
  return sessionBase(ir) + fieldHelpers(ir);
}

function sessionBase(ir: IR): string {
  return ir.auth
    ? `export type Session = Outputs["auth"]["session"];
export type SessionUser = Outputs["auth"]["me"];

/** The signed-in user out of a session query's data, or null */
export function sessionUser(session: Session | undefined): SessionUser | null {
  return session?.user ?? null;
}`
    : `export type Session = Outputs["auth"]["session"];
/** Auth is not configured: there is never a signed-in user */
export type SessionUser = never;

export function sessionUser(_session: Session | undefined): SessionUser | null {
  return null;
}`;
}

/** The REST-backed client (drizzle-next) */
export function restClientFile(ir: IR, conv: TsConventions): string {
  const presentTypes = new Set<string>();
  const validationTypes = new Set<string>();
  const inputs: string[] = [];
  const outputs: string[] = [];
  const impl: string[] = [];
  const idType = (entity: EntityIR) => (isIntegerKey(entity) ? "number" : "string");

  for (const r of ir.resources) {
    const entity = entityByName(ir, r.entity);
    const T = `Public${typeName(entity)}`;
    presentTypes.add(T);
    const ops = r.operations.filter(o => o.rule.kind !== "none");
    const inLines: string[] = [];
    const outLines: string[] = [];
    const implLines: string[] = [];
    const Id = idType(entity);
    for (const op of ops) {
      switch (op.kind) {
        case "list": {
          validationTypes.add(`${r.name}ListQuery`);
          for (const inc of op.include)
            presentTypes.add(`Public${typeName(entityByName(ir, entity.relations.find(x => x.name === inc)!.target))}`);
          for (const inc of op.through ?? [])
            presentTypes.add(`Public${typeName(entityByName(ir, entity.through!.find(t => t.name === inc)!.target))}`);
          inLines.push(`    list: z.input<typeof ${r.name}ListQuery>`);
          outLines.push(`    list: { data: (${outputType(ir, r, op.include, op.through)})[]; page: Page }`);
          implLines.push(
            `    list: (input: Inputs[${q(r.name)}]["list"]) => call<Outputs[${q(r.name)}]["list"]>("GET", ${q(op.path)}, { query: input as Record<string, unknown>, whole: true })`
          );
          break;
        }
        case "get":
          for (const inc of op.include)
            presentTypes.add(`Public${typeName(entityByName(ir, entity.relations.find(x => x.name === inc)!.target))}`);
          for (const inc of op.through ?? [])
            presentTypes.add(`Public${typeName(entityByName(ir, entity.through!.find(t => t.name === inc)!.target))}`);
          inLines.push(`    get: { id: ${Id} }`);
          outLines.push(`    get: ${outputType(ir, r, op.include, op.through)}`);
          implLines.push(
            `    get: ({ id }: Inputs[${q(r.name)}]["get"]) => call<Outputs[${q(r.name)}]["get"]>("GET", ${q(r.path)} + "/" + id)`
          );
          break;
        case "create":
          validationTypes.add(`${r.name}CreateInput`);
          inLines.push(`    create: z.input<typeof ${r.name}CreateInput>`);
          outLines.push(`    create: ${T}`);
          implLines.push(
            `    create: (input: Inputs[${q(r.name)}]["create"]) => call<${T}>("POST", ${q(r.path)}, { body: input })`
          );
          break;
        case "update":
          validationTypes.add(`${r.name}UpdateInput`);
          inLines.push(`    update: { id: ${Id}; data: z.input<typeof ${r.name}UpdateInput> }`);
          outLines.push(`    update: ${T}`);
          implLines.push(
            `    update: ({ id, data }: Inputs[${q(r.name)}]["update"]) => call<${T}>("PATCH", ${q(r.path)} + "/" + id, { body: data })`
          );
          break;
        case "delete":
          inLines.push(`    delete: { id: ${Id} }`);
          outLines.push(`    delete: null`);
          implLines.push(
            `    delete: ({ id }: Inputs[${q(r.name)}]["delete"]) => call<null>("DELETE", ${q(r.path)} + "/" + id)`
          );
          break;
      }
    }
    for (const a of actionsOf(ir, r.name).filter(a => a.rule.kind !== "none")) {
      validationTypes.add(actionInputName(a));
      const result = actionResult(ir, a);
      if (a.scope === "row") {
        inLines.push(`    ${a.name}: z.input<typeof ${actionInputName(a)}> & { id: ${Id} }`);
        implLines.push(
          `    ${a.name}: ({ id, ...input }: Inputs[${q(r.name)}][${q(a.name)}]) => call<${result}>("POST", ${q(r.path)} + "/" + id + ${q("/" + a.name)}, { body: input })`
        );
      } else {
        inLines.push(`    ${a.name}: z.input<typeof ${actionInputName(a)}>`);
        implLines.push(
          `    ${a.name}: (input: Inputs[${q(r.name)}][${q(a.name)}]) => call<${result}>("POST", ${q(a.path)}, { body: input })`
        );
      }
      outLines.push(`    ${a.name}: ${result}`);
    }
    inputs.push(`  ${r.name}: {\n${inLines.join(";\n")};\n  }`);
    outputs.push(`  ${r.name}: {\n${outLines.join(";\n")};\n  }`);
    impl.push(`  ${r.name}: {\n${implLines.join(",\n")}\n  }`);
  }

  const globals = globalActions(ir).filter(a => a.rule.kind !== "none");
  for (const a of globals) validationTypes.add(actionInputName(a));
  const auth = ir.auth;
  const identity = auth ? entityByName(ir, auth.identity) : null;
  const U = identity ? `Public${typeName(identity)}` : "never";
  if (identity) presentTypes.add(U);
  const credentials = auth?.providers.some(p => p.kind === "credentials");
  const magic = auth?.providers.some(p => p.kind === "magic_link");
  const registerFields = identity ? auth!.registerFields.map(f => `${f}?: unknown`).join("; ") : "";
  // With invites a sign-in that proves the address answers what it accepted beside the user
  const invites = hasInvites(ir);
  const signedIn = invites ? `{ data: ${U}; accepted?: Accepted[] }` : U;
  const whole = invites ? ", whole: true" : "";

  return `${conv.header("The typed client the pages call. Same call surface on every backend; this one speaks the REST contract.")}
import { QueryClient } from "@tanstack/react-query";
import type { z } from "zod";
${invites ? `import type { Accepted, InviteLookup } from "../auth-providers";\n` : ""}${ir.files ? `import type { FileRecord } from "../files";\n` : ""}import type { ${[...presentTypes, ...(hasFieldRules(ir) ? ["VisibleFields"] : [])].sort().join(", ")} } from "../present";
${validationTypes.size ? `import type { ${[...validationTypes].sort().join(", ")} } from "../validation";` : ""}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** The HTTP status the API answered a failed call with, when it answered */
export function errorStatus(error: unknown): number | undefined {
  return error instanceof ApiError ? error.status : undefined;
}

/** A request the server refused as asked: the same request would fail again, so it is not retried. */
function isRefused(error: unknown): boolean {
  const status = errorStatus(error);
  return status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      retry: (failureCount, error) => !isRefused(error) && failureCount < 3
    }
  }
});

export type Page = { page: number; page_size: number; total: number };

async function call<T>(method: string, path: string, options: { query?: Record<string, unknown>; body?: unknown; whole?: boolean } = {}): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    method,
    headers: options.body !== undefined ? { "content-type": "application/json" } : {},
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });
  if (response.status === 204) return null as T;
  const json = (await response.json().catch(() => null)) as { data?: T; error?: { code: string; message: string } } | null;
  if (!response.ok) throw new ApiError(response.status, json?.error?.code ?? "error", json?.error?.message ?? response.statusText);
  return (options.whole ? json : json?.data) as T;
}

export type Inputs = {
  auth: {
    login: { ${auth?.emailColumn ?? "email"}: string; password: string${invites ? "; invite?: string" : ""} };
    register: { ${auth?.emailColumn ?? "email"}: string; password: string${registerFields ? "; " + registerFields : ""} };
    magic_link: { email: string };
    magic_link_verify: { token: string };${
      invites
        ? `
    invite: { token: string };
    invite_accept: { token: string; data?: Record<string, unknown> };`
        : ""
    }
  };${
    ir.files
      ? `
  files: {
    begin: { name: string; type: string; size: number };
    complete: { id: string };
    get: { id: string };
  };`
      : ""
  }${
    globals.length
      ? `
  actions: {
${globals.map(a => `    ${a.name}: z.input<typeof ${actionInputName(a)}>;`).join("\n")}
  };`
      : ""
  }
${inputs.join(";\n")};
};

export type Outputs = {
  auth: {
    session: { user: ${U}${auth && hasFieldRules(ir) ? "; fields: VisibleFields" : ""} } | null;
    me: ${U};
    login: ${signedIn};
    register: ${U};
    logout: null;
    magic_link: { sent: boolean; debug?: { token: string; url: string } };
    magic_link_verify: ${signedIn};
    providers: { kind: string; name: string }[];${
      invites
        ? `
    invite: InviteLookup;
    invite_accept: { data: ${U}; accepted: Accepted[] };`
        : ""
    }
  };${
    ir.files
      ? `
  files: {
    begin: FileRecord & { upload: { url: string; method: string; headers: Record<string, string> } };
    complete: FileRecord;
    get: FileRecord;
  };`
      : ""
  }${
    globals.length
      ? `
  actions: {
${globals.map(a => `    ${a.name}: ${actionResult(ir, a)};`).join("\n")}
  };`
      : ""
  }
${outputs.join(";\n")};
};

export const client = {
  auth: {
    session: async (): Promise<Outputs["auth"]["session"]> => {
      try {
${
  auth && hasFieldRules(ir)
    ? `        // The answer carries, beside the user, which fields with a read rule they could read
        const me = await call<{ data: Outputs["auth"]["me"]; fields: VisibleFields }>("GET", "/api/auth/me", { whole: true });
        return { user: me.data, fields: me.fields };`
    : `        return { user: await call<Outputs["auth"]["me"]>("GET", "/api/auth/me") };`
}
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    providers: () => call<Outputs["auth"]["providers"]>("GET", "/api/auth/providers")${
      auth
        ? `,
    me: () => call<Outputs["auth"]["me"]>("GET", "/api/auth/me"),
    logout: () => call<null>("POST", "/api/auth/logout")${
      credentials
        ? `,
    login: (input: Inputs["auth"]["login"]) => call<Outputs["auth"]["login"]>("POST", "/api/auth/login", { body: input${whole} }),
    register: (input: Inputs["auth"]["register"]) => call<Outputs["auth"]["register"]>("POST", "/api/auth/register", { body: input })`
        : ""
    }${
      magic
        ? `,
    magic_link: (input: Inputs["auth"]["magic_link"]) => call<Outputs["auth"]["magic_link"]>("POST", "/api/auth/magic-link", { body: input }),
    magic_link_verify: (input: Inputs["auth"]["magic_link_verify"]) => call<Outputs["auth"]["magic_link_verify"]>("POST", "/api/auth/magic-link/verify", { body: input${whole} })`
        : ""
    }${
      invites
        ? `,
    invite: ({ token }: Inputs["auth"]["invite"]) => call<Outputs["auth"]["invite"]>("GET", "/api/auth/invites/" + encodeURIComponent(token)),
    invite_accept: ({ token, data }: Inputs["auth"]["invite_accept"]) =>
      call<Outputs["auth"]["invite_accept"]>("POST", "/api/auth/invites/" + encodeURIComponent(token) + "/accept", { body: data ?? {}, whole: true })`
        : ""
    }`
        : ""
    }
  },${
    ir.files
      ? `
  files: {
    begin: (input: Inputs["files"]["begin"]) => call<Outputs["files"]["begin"]>("POST", "/api/files", { body: input }),
    complete: ({ id }: Inputs["files"]["complete"]) => call<Outputs["files"]["complete"]>("POST", "/api/files/" + id + "/complete"),
    get: ({ id }: Inputs["files"]["get"]) => call<Outputs["files"]["get"]>("GET", "/api/files/" + id)
  },`
      : ""
  }${
    globals.length
      ? `
  actions: {
${globals.map(a => `    ${a.name}: (input: Inputs["actions"][${q(a.name)}]) => call<${actionResult(ir, a)}>("POST", ${q(a.path)}, { body: input })`).join(",\n")}
  },`
      : ""
  }
${impl.join(",\n")}
};

${sessionHelpers(ir)}
`;
}

export type { OperationIR };
