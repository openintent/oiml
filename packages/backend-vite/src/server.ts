/**
 * The API: Hono hosting a tRPC router. One router per resource, routers for auth, files and global
 * actions, shared context, access rules and error mapping. Procedures keep the REST contract's
 * semantics (status codes become tRPC error codes; list returns { data, page }).
 */
import type { ActionIR, EntityIR, GeneratedFile, IR, OperationIR, RelationIR, ResourceIR, RuleIR } from "@osl/core";
import { actionsOf, globalActions } from "@osl/core";
import {
  actionInputName,
  fileSpecsLiteral,
  fillEnums,
  listRuleFilter,
  membershipType,
  membershipsLoader,
  conditionDefaults,
  needsBodyCheck,
  rowArg,
  ruleLiteral,
  ruleValuesSource,
  verdictSource,
  zodForColumn
} from "@osl/ts-common";
import {
  HEADER,
  SCAFFOLD_HEADER,
  VITE,
  entityByName,
  idInputZod,
  identityPk,
  isIntegerKey,
  q,
  singlePrimaryKey,
  tableExport,
  typeName
} from "./util.js";

/** generated/server/trpc.ts */
export function trpcFile(): string {
  return `${HEADER("tRPC initialisation.")}
import { initTRPC } from "@trpc/server";
import type { Context } from "./context";

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;
export type { Context };
`;
}

/** generated/server/context.ts */
export function contextFile(): string {
  return `${HEADER("Per-request context: the request, its response headers and the session.")}
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import { getSession, type Session } from "./auth";

export type Context = {
  req: Request;
  /** Headers of the response; auth sets cookies here */
  resHeaders: Headers;
  session: Session | null;
};

export async function createContext(opts: FetchCreateContextFnOptions): Promise<Context> {
  return { req: opts.req, resHeaders: opts.resHeaders, session: await getSession(opts.req) };
}
`;
}

/** generated/server/errors.ts */
export function errorsFile(): string {
  return `${HEADER("Error mapping: database errors, bad ids and refused requests become tRPC errors with the contract's status codes.")}
import { TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import type { ZodTypeAny, z } from "zod";

const CODES: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT"
};

/** Refuse the request with the contract's status and code */
export function fail(status: number, code: string, message: string): never {
  throw new TRPCError({ code: CODES[status] ?? "INTERNAL_SERVER_ERROR", message, cause: { code } });
}

export function notFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "Not found" });
}

/** A malformed id can never match a row, so it is reported as not found. */
export function parseId<S extends ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const result = schema.safeParse(raw);
  if (!result.success) throw notFound();
  return result.data;
}

/** Drizzle wraps driver errors; the PostgreSQL code is on the cause. */
export function dbErrorCode(err: unknown): string | undefined {
  const cause = err && typeof err === "object" && "cause" in err ? (err as { cause?: unknown }).cause : err;
  if (!cause || typeof cause !== "object") return undefined;
  return (cause as { code?: string }).code;
}

/** The tRPC error for a failure inside a procedure. tRPC errors (from hooks, say) pass through. */
export function toTRPCError(err: unknown, operation: "read" | "write" | "delete"): TRPCError {
  if (err instanceof TRPCError) return err;
  const code = dbErrorCode(err);
  if (code === "23505") return new TRPCError({ code: "CONFLICT", message: "A row with the same unique value already exists" });
  // 23503 is a missing referenced row (or ON DELETE NO ACTION); 23001 is ON DELETE RESTRICT refusing the delete
  if (code === "23503" || code === "23001") {
    return operation === "delete" || code === "23001"
      ? new TRPCError({ code: "CONFLICT", message: "Other rows still reference this row" })
      : new TRPCError({ code: "BAD_REQUEST", message: "A referenced row does not exist" });
  }
  if (code === "23502") return new TRPCError({ code: "BAD_REQUEST", message: "A required value is missing" });
  if (code === "22P02") {
    return operation === "read" ? notFound() : new TRPCError({ code: "BAD_REQUEST", message: "A value has the wrong format" });
  }
  console.error(err);
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Something went wrong", cause: err });
}
`;
}

/** generated/server/access.ts */
export function accessFile(ir: IR): string {
  return `${HEADER("Access rule evaluation.")}
import { TRPCError } from "@trpc/server";
import type { Session } from "./auth";

${verdictSource(ir)}

/** Check a rule and throw when denied. */
export function checkRule(rule: Rule, session: Session | null, row?: Record<string, unknown> | null): void {
  const result = verdict(rule, session, row);
  if (result.ok) return;
  throw result.status === 401
    ? new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" })
    : new TRPCError({ code: "FORBIDDEN", message: "You cannot do that" });
}
`;
}

/** generated/server/auth.ts: sessions, passwords and the auth router. Without auth, a session query that answers null. */
export function authFile(ir: IR): string {
  if (!ir.auth) {
    return `${HEADER("Auth is not configured in the model; sessions are always empty.")}
import { publicProcedure, router } from "./trpc";

export type Session = { user: { id: never }; memberships: { tenant: string | number; role: string }[] };

export async function getSession(_request: Request): Promise<Session | null> {
  return null;
}

export const authRouter = router({
  /** The signed-in user, or null */
  session: publicProcedure.query(() => null),
  /** How users may sign in: nobody does */
  providers: publicProcedure.query((): { kind: string; name: string }[] => [])
});
`;
  }
  const auth = ir.auth;
  const identity = entityByName(ir, auth.identity);
  const T = typeName(identity);
  const table = tableExport(identity);
  const tableAlias = `${table}Table`;
  const pk = identity.primaryKey[0];
  const credentials = auth.providers.some(p => p.kind === "credentials");
  const magic = auth.providers.some(p => p.kind === "magic_link");
  const tenancy = auth.tenancy;
  const membershipTable = tenancy ? tableExport(entityByName(ir, tenancy.membership)) : null;
  const registerFields = auth.registerFields.map(name => identity.columns.find(c => c.name === name)!);
  const registerShape = [
    `  ${auth.emailColumn}: ${fillEnums(zodForColumn(identity.columns.find(c => c.name === auth.emailColumn)!, "create"), ir, identity)}`,
    `  password: z.string().min(8).max(200)`,
    ...registerFields.map(c => `  ${c.name}: ${fillEnums(zodForColumn(c, "create"), ir, identity)}`)
  ].join(",\n");
  const schemaImports = [
    `${table} as ${tableAlias}`,
    ...(membershipTable ? [`${membershipTable} as ${membershipTable}Table`] : [])
  ];
  const fileSpecs = identity.columns.some(c => c.type.kind === "file");

  return `${HEADER("Auth: cookie sessions and the auth router (passwords, magic links, sign-out, the session).")}
import { createHmac, randomBytes${credentials ? ", scryptSync" : ""}, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client";
import { ${schemaImports.join(", ")} } from "../db/schema";
import { toTRPCError } from "./errors";
import { present${T}, type Public${T} } from "../present";
${fileSpecs ? `import { resolveFileRefs } from "../files";\n` : ""}${magic ? `import { issueMagicLink, verifyMagicLink, PROVIDERS } from "../auth-providers";\n` : auth.providers.some(p => p.kind === "oauth") ? `import { PROVIDERS } from "../auth-providers";\n` : ""}import { publicProcedure, router } from "./trpc";

export type Membership = { tenant: string | number; role: string };
export type Session = { user: Public${T}; memberships: ${membershipType(ir)} };

const COOKIE = "osl_session";
const SESSION_DAYS = ${auth.sessionDays};
const SECRET = process.env.OSL_SESSION_SECRET ?? "osl-dev-secret-change-me";

if (process.env.NODE_ENV === "production" && !process.env.OSL_SESSION_SECRET) {
  throw new Error("OSL_SESSION_SECRET must be set in production");
}
${
  credentials
    ? `
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return "scrypt$" + salt + "$" + hash;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "base64url");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}
`
    : `
void randomBytes;
`
}
function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** The Set-Cookie value that signs a user in */
export function sessionCookie(userId: string | number): string {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp })).toString("base64url");
  const value = payload + "." + sign(payload);
  return COOKIE + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86_400;
}

export function clearedCookie(): string {
  return COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

function readCookie(request: Request): { uid: string | number } | null {
  const header = request.headers.get("cookie") ?? "";
  const pair = header.split(/;\\s*/).find(p => p.startsWith(COOKIE + "="));
  if (!pair) return null;
  const value = pair.slice(COOKIE.length + 1);
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  if (expected.length !== signature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as { uid: string | number; exp: number };
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return { uid: data.uid };
  } catch {
    return null;
  }
}

/** The session of a user row: the public user and their memberships */
export async function sessionOf(user: typeof ${tableAlias}.$inferSelect): Promise<Session> {
  return { user: present${T}(user), memberships: ${membershipsLoader(ir, `user.${pk}`)} };
}

/** The signed-in user, or null. Loads the user so a deleted account signs out immediately. */
export async function getSession(request: Request): Promise<Session | null> {
  const cookie = readCookie(request);
  if (!cookie) return null;
  const user = await db.query.${table}.findFirst({ where: eq(${tableAlias}.${pk}, cookie.uid as never) }).catch(() => undefined);
  return user ? sessionOf(user) : null;
}
${
  credentials
    ? `
const registerInput = z
  .object({
${registerShape}
  })
  .strict();

const loginInput = z.object({ ${auth.emailColumn}: z.string(), password: z.string() }).strict();
`
    : ""
}
export const authRouter = router({${
    credentials
      ? `
  register: publicProcedure.input(registerInput).mutation(async ({ ctx, input }) => {
    const { password, ...fields } = input;
    try {
      const [user] = await db
        .insert(${tableAlias})
        .values({ ...${fileSpecs ? `(await resolveFileRefs(fields, ${fileSpecsLiteral(identity)}))` : "fields"}, ${auth.passwordColumn}: hashPassword(password) })
        .returning();
      ctx.resHeaders.append("set-cookie", sessionCookie(user.${pk}));
      return present${T}(user);
    } catch (err) {
      throw toTRPCError(err, "write");
    }
  }),

  login: publicProcedure.input(loginInput).mutation(async ({ ctx, input }) => {
    const user = await db.query.${table}
      .findFirst({ where: eq(${tableAlias}.${auth.emailColumn}, input.${auth.emailColumn}) })
      .catch(err => {
        throw toTRPCError(err, "read");
      });
    if (!user || !verifyPassword(input.password, user.${auth.passwordColumn})) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Email or password is wrong" });
    }
    ctx.resHeaders.append("set-cookie", sessionCookie(user.${pk}));
    return present${T}(user);
  }),
`
      : ""
  }${
    magic
      ? `
  /** Email a one-time sign-in link; always answers sent so addresses cannot be probed (tests get the token when emails are captured) */
  magic_link: publicProcedure.input(z.object({ email: z.string().email() }).strict()).mutation(async ({ input }) => {
    const issued = await issueMagicLink(input.email);
    const result: { sent: boolean; debug?: { token: string; url: string } } = { sent: true };
    if (issued) result.debug = { token: issued.token, url: issued.url };
    return result;
  }),

  magic_link_verify: publicProcedure.input(z.object({ token: z.string().min(1) }).strict()).mutation(async ({ ctx, input }) => {
    const user = await verifyMagicLink(input.token);
    ctx.resHeaders.append("set-cookie", sessionCookie(user.${pk}));
    return present${T}(user);
  }),
`
      : ""
  }
  logout: publicProcedure.mutation(({ ctx }) => {
    ctx.resHeaders.append("set-cookie", clearedCookie());
    return null;
  }),

  /** The signed-in user; UNAUTHORIZED when nobody is */
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" });
    return ctx.session.user;
  }),

  /** The signed-in user, or null: what the web app asks on every load */
  session: publicProcedure.query(({ ctx }) => ctx.session),

  /** How users may sign in, for the sign-in page */
  providers: publicProcedure.query((): { kind: string; name: string }[] => ${
    magic || auth.providers.some(p => p.kind === "oauth")
      ? "PROVIDERS"
      : `[${auth.providers.map(p => `{ kind: ${q(p.kind)}, name: ${q(p.kind)} }`).join(", ")}]`
  })
});
`;
}

/** generated/server/files-router.ts */
export function filesRouterFile(ir: IR): string {
  return `${HEADER("The files router: begin an upload, mark it complete, read metadata. Bytes go through /api/files/{id}/content.")}
import { z } from "zod";
import { beginUpload, completeUpload, getFile } from "../files";
import { checkRule, type Rule } from "./access";
import { publicProcedure, router } from "./trpc";

const UPLOAD: Rule = ${JSON.stringify(ir.files!.upload)};
const READ: Rule = ${JSON.stringify(ir.files!.read)};

export const filesRouter = router({
  begin: publicProcedure
    .input(z.object({ name: z.string().min(1).max(255), type: z.string().min(1).max(255), size: z.number().int().nonnegative() }).strict())
    .mutation(async ({ ctx, input }) => {
      checkRule(UPLOAD, ctx.session);
      const { file, upload } = await beginUpload(input, ctx.session);
      return { ...file, upload };
    }),

  complete: publicProcedure.input(z.object({ id: z.string() }).strict()).mutation(({ ctx, input }) => {
    checkRule(UPLOAD, ctx.session);
    return completeUpload(input.id);
  }),

  get: publicProcedure.input(z.object({ id: z.string() }).strict()).query(({ ctx, input }) => {
    checkRule(READ, ctx.session);
    return getFile(input.id);
  })
});
`;
}

/** generated/server/router.ts */
export function routerFile(ir: IR): string {
  const resources = ir.resources.map(r => r.name);
  const extras = [
    ...(ir.files ? ["files: filesRouter"] : []),
    ...(globalActions(ir).length ? ["actions: actionsRouter"] : [])
  ];
  return `${HEADER("The app router: auth plus one router per resource.")}
import { authRouter } from "./auth";
${ir.files ? `import { filesRouter } from "./files-router";\n` : ""}${globalActions(ir).length ? `import { actionsRouter } from "./actions-router";\n` : ""}${resources.map(r => `import { ${r}Router } from "./resources/${r}";`).join("\n")}
import { router } from "./trpc";

export const appRouter = router({
  auth: authRouter${extras.map(e => `,\n  ${e}`).join("")}${resources.map(r => `,\n  ${r}: ${r}Router`).join("")}
});

export type AppRouter = typeof appRouter;
`;
}

/** generated/server/app.ts */
export function appFile(ir: IR): string {
  const oauth = ir.auth?.providers.some(p => p.kind === "oauth");
  const restRoutes: string[] = [];
  if (ir.files) {
    restRoutes.push(`  // Files: bytes in and out. Local storage streams them; S3 redirects to a signed URL.
  app.get("/api/files/:id/content", async c => {
    try {
      const content = await fileContent(c.req.param("id"));
      if (content.kind === "redirect") return c.redirect(content.url, 302);
      return new Response(Readable.toWeb(content.stream) as ReadableStream, {
        headers: {
          "content-type": content.type,
          "content-length": String(content.size),
          "content-disposition": content.disposition,
          "cache-control": "private, max-age=3600"
        }
      });
    } catch (err) {
      return restError(c, err);
    }
  });
  app.put("/api/files/:id/content", async c => {
    try {
      return c.json({ data: await receiveContent(c.req.param("id"), c.req.raw.body) });
    } catch (err) {
      return restError(c, err);
    }
  });`);
  }
  restRoutes.push(`  // Test hooks: a clock for timers and schedules, and the captured mailbox. Only with OSL_TEST_HOOKS=1.
  if (testHooksEnabled()) {
    app.post("/api/osl-hooks/timers/run", async c => c.json({ data: await timersRun(await c.req.json().catch(() => ({}))) }));
    app.post("/api/osl-hooks/schedules/run", async c => {
      const result = await schedulesRun(await c.req.json().catch(() => ({})));
      return result ? c.json({ data: result }) : c.json({ error: { code: "unknown_schedule", message: "no schedule runs that action" } }, 400);
    });
    app.get("/api/osl-hooks/emails", c => c.json({ data: emailsSent({ to: c.req.query("to"), subject: c.req.query("subject") }) }));
  }`);
  if (oauth) {
    restRoutes.push(`  // OAuth: the browser is sent to the provider and comes back signed in.
  app.get("/api/auth/oauth/:name", async c => {
    try {
      return c.redirect(await oauthStart(c.req.param("name"), c.req.query("redirect") ?? "/"), 302);
    } catch (err) {
      return restError(c, err);
    }
  });
  app.get("/api/auth/oauth/:name/callback", async c => {
    try {
      const { user, redirectTo } = await oauthCallback(c.req.param("name"), c.req.query());
      c.header("set-cookie", sessionCookie(user.${ir.auth ? entityByName(ir, ir.auth.identity).primaryKey[0] : "id"}));
      return c.redirect(APP_URL + redirectTo, 302);
    } catch (err) {
      return restError(c, err);
    }
  });`);
  }
  return `${HEADER("The Hono app: tRPC at /trpc, a health check, REST routes for file bytes and OAuth, and the built web app from dist/ when it exists.")}
import { existsSync } from "node:fs";
${ir.files ? `import { Readable } from "node:stream";\n` : ""}import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { Hono, type Context as HonoContext } from "hono";
${ir.files ? `import { fileContent, receiveContent } from "../files";\n` : ""}${oauth ? `import { APP_URL, oauthCallback, oauthStart } from "../auth-providers";\nimport { sessionCookie } from "./auth";\n` : ""}${ir.jobs ? `import { startWorker } from "../jobs";\n` : ""}import { emailsSent, schedulesRun, testHooksEnabled, timersRun } from "../test-hooks";
import { createContext } from "./context";
import { appRouter } from "./router";

/** Errors from the shared modules are tRPC errors; REST routes answer them in the contract's shape. */
function restError(c: HonoContext, err: unknown): Response {
  if (err instanceof TRPCError) {
    const code = (err.cause as { code?: string } | undefined)?.code ?? err.code.toLowerCase();
    return c.json({ error: { code, message: err.message } }, getHTTPStatusCodeFromError(err) as 400);
  }
  console.error(err);
  return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
}

export function createApp(): Hono {
  const app = new Hono();
  app.get("/healthz", c => c.json({ ok: true }));
  app.get("/health", c => c.json({ ok: true }));
  app.use("/trpc/*", trpcServer({ router: appRouter, createContext }));
${restRoutes.join("\n")}
  // After \`vite build\`, the API also serves the web app, with the SPA fallback for its routes.
  // In development Vite serves it instead and proxies /trpc and /api here.
  if (existsSync("./dist")) {
    app.use("*", serveStatic({ root: "./dist" }));
    app.get("*", serveStatic({ root: "./dist", path: "index.html" }));
  }
  return app;
}
${
  ir.jobs
    ? `
/** Start what the process's role needs besides answering requests: the job worker unless OSL_ROLE=web. */
export async function startBackground(): Promise<void> {
  await startWorker();
}
`
    : `
export async function startBackground(): Promise<void> {}
`
}`;
}

/** src/server/main.ts: the user-owned entry point */
export function serverMainScaffold(): GeneratedFile {
  return {
    path: "src/server/main.ts",
    mode: "scaffold",
    content: `${SCAFFOLD_HEADER("The API process. Add middleware or routes to the app here, or in generated/server/app.ts's caller.")}
import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";

// Variables from .env must be in place before the app loads: the database pool reads DATABASE_URL
// when its module is first imported, so the import below stays dynamic. Ones already in the
// environment win over the file.
if (existsSync(".env")) process.loadEnvFile(".env");

const { createApp, startBackground } = await import("${VITE.generated("server/app")}");

const port = Number(process.env.PORT ?? 3111);
const app = createApp();

serve({ fetch: app.fetch, port }, info => {
  console.log(\`API listening on http://localhost:\${info.port}\`);
});
// Queued events run in this process too unless OSL_ROLE=web (then run src/server/worker.ts separately).
void startBackground();
`
  };
}

/** src/server/worker.ts: a worker-only process, for deployments that split roles */
export function workerScaffold(): GeneratedFile {
  return {
    path: "src/server/worker.ts",
    mode: "scaffold",
    content: `${SCAFFOLD_HEADER("A process that only runs queued events. The API runs them itself unless OSL_ROLE=web.")}
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
process.env.OSL_ROLE = "worker";

const { startWorker } = await import("${VITE.generated("jobs")}");
await startWorker();
console.log("worker running");
`
  };
}

function includeType(ir: IR, rel: RelationIR): string {
  const target = entityByName(ir, rel.target);
  return rel.kind === "many" ? `schema.${typeName(target)}[]` : `schema.${typeName(target)} | null`;
}

function includePresent(ir: IR, rel: RelationIR): string {
  const target = entityByName(ir, rel.target);
  if (rel.kind === "many") return `row.${rel.name}.map(present${typeName(target)})`;
  return `row.${rel.name} ? present${typeName(target)}(row.${rel.name}) : null`;
}

function withClause(include: string[]): string {
  return include.length ? `, with: { ${include.map(i => `${i}: true`).join(", ")} }` : "";
}

/** The TypeScript array type of tenant ids for inArray, by the tenant key's type */
function tenantIdsCast(ir: IR): string {
  const t = ir.auth?.tenancy;
  if (!t) return "as string[]";
  const tenant = entityByName(ir, t.entity);
  return isIntegerKey(singlePrimaryKey(tenant)) ? "as number[]" : "as string[]";
}

/** generated/server/resources/<name>.ts: the resource's tRPC router */
export function resourceRouterFile(ir: IR, resource: ResourceIR): string {
  const entity = entityByName(ir, resource.entity);
  const T = typeName(entity);
  const table = `${tableExport(entity)}Table`;
  const query = `db.query.${tableExport(entity)}`;
  // A row written with a timed field set schedules the entity's timers
  const hasTimers = ir.timers.some(t => t.entity === entity.name);
  const timerLine = hasTimers ? `\n      await scheduleTimers(${q(entity.name)}, row);` : "";
  const pkColumn = singlePrimaryKey(entity);
  const pk = pkColumn.name;
  const ops = resource.operations.filter(o => o.rule.kind !== "none");
  const list = ops.find(o => o.kind === "list") as Extract<OperationIR, { kind: "list" }> | undefined;
  const get = ops.find(o => o.kind === "get") as Extract<OperationIR, { kind: "get" }> | undefined;
  const create = ops.find(o => o.kind === "create") as Extract<OperationIR, { kind: "create" }> | undefined;
  const update = ops.find(o => o.kind === "update") as Extract<OperationIR, { kind: "update" }> | undefined;
  const remove = ops.find(o => o.kind === "delete") as Extract<OperationIR, { kind: "delete" }> | undefined;
  const actions = actionsOf(ir, resource.name).filter(a => a.rule.kind !== "none");
  const events = (action: "created" | "updated" | "deleted") =>
    ir.events.filter(e => e.kind === "entity" && e.entity === entity.name && e.action === action);
  const actionEvents = (name: string) =>
    ir.events.filter(e => e.kind === "action" && e.resource === resource.name && e.actionName === name);
  const hasFiles = entity.columns.some(c => c.type.kind === "file");
  const tenancy = ir.auth?.tenancy;
  const isTenant = tenancy?.entity === entity.name;
  const membershipTable = tenancy ? `${tableExport(entityByName(ir, tenancy.membership))}Table` : null;
  const tableVar = (e: EntityIR) => `${tableExport(e)}Table`;
  const me = `ctx.session!.user.${identityPk(ir)}`;
  const listFilter = list
    ? listRuleFilter(ir, entity, list.rule, {
        ruleRef: "RULES.read",
        session: "ctx.session",
        me,
        empty: "return { data: [], page: { page, page_size, total: 0 } };",
        tableVar,
        tenantCast: tenantIdsCast(ir),
        indent: "    "
      })
    : null;
  const ruleValues = ruleValuesSource(
    ir,
    [entity.rules.read, entity.rules.create, entity.rules.update, entity.rules.delete, ...actions.map(a => a.rule)],
    tableVar
  );
  /** Tables the module imports beyond the entity's own: the membership table of a tenant, and the ones rules reach */
  const extraTables = new Set<string>([...(listFilter?.tables ?? []), ...(ruleValues?.tables ?? [])]);
  extraTables.delete(entity.name);
  const hasConditions = Boolean(
    list && (list.filters.length > 0 || listFilter!.lines.length > 0 || list.search.length > 0)
  );

  const drizzleImports = new Set<string>();
  if (get || update || remove || actions.some(a => a.scope === "row") || ruleValues) drizzleImports.add("eq");
  if (list) {
    drizzleImports.add("count");
    if (hasConditions) drizzleImports.add("and");
    if (list.filters.length) drizzleImports.add("eq");
    for (const name of listFilter!.drizzle) drizzleImports.add(name);
    if (list.search.length) {
      drizzleImports.add("ilike");
      drizzleImports.add("or");
    }
    for (const [, dir] of list.order) drizzleImports.add(dir);
    if (list.sortable.length) {
      drizzleImports.add("asc");
      drizzleImports.add("desc");
    }
  }
  const presents = new Set<string>([`present${T}`]);
  const validationImports = new Set<string>([`${resource.name}Id`]);
  const errorImports = new Set<string>(["parseId", "toTRPCError"]);
  const accessImports = new Set<string>(["checkRule"]);
  for (const name of listFilter?.access ?? []) accessImports.add(name);
  const usesEmit =
    ["created", "updated", "deleted"].some(a => events(a as "created").length > 0) ||
    actions.some(a => actionEvents(a.name).length > 0);
  const needsId = Boolean(get || update || remove || actions.some(a => a.scope === "row"));

  const relationsFor = (include: string[]) => include.map(name => entity.relations.find(r => r.name === name)!);
  for (const rel of [...relationsFor(list?.include ?? []), ...relationsFor(get?.include ?? [])])
    presents.add(`present${typeName(entityByName(ir, rel.target))}`);

  const sections: string[] = [];
  sections.push(`const RULES = {
  read: ${ruleLiteral(entity.rules.read)} as Rule,
  create: ${ruleLiteral(entity.rules.create)} as Rule,
  update: ${ruleLiteral(entity.rules.update)} as Rule,
  delete: ${ruleLiteral(entity.rules.delete)} as Rule
};`);
  if (actions.length)
    sections.push(
      `const ACTION_RULES = {\n${actions.map(a => `  ${a.name}: ${ruleLiteral(a.rule)} as Rule`).join(",\n")}\n};`
    );
  if (needsId)
    sections.push(
      `/** Ids as clients send them; parseId applies ${resource.name}Id and answers NOT_FOUND to a malformed one. */\nconst ID = ${idInputZod(pkColumn)};`
    );
  if (hasFiles)
    sections.push(`/** File fields and what they accept */\nconst FILE_FIELDS = ${fileSpecsLiteral(entity)} as const;`);
  if (ruleValues) sections.push(ruleValues.source);
  if (list?.sortable.length)
    sections.push(`const SORTABLE = {\n${list.sortable.map(f => `  ${f}: ${table}.${f}`).join(",\n")}\n};`);

  const rowSection = (name: "List" | "Get", include: string[]) => {
    const rels = relationsFor(include);
    const rowType = rels.length
      ? `schema.${T} & { ${rels.map(r => `${r.name}: ${includeType(ir, r)}`).join("; ")} }`
      : `schema.${T}`;
    const extra = rels.length ? `, ${rels.map(r => `${r.name}: ${includePresent(ir, r)}`).join(", ")}` : "";
    return `type ${name}Row = ${rowType};\nfunction present${name}Row(row: ${name}Row) {\n  return { ...present${T}(row)${extra} };\n}`;
  };
  if (list) sections.push(rowSection("List", list.include));
  if (get) sections.push(rowSection("Get", get.include));

  const resolveFiles = (expr: string) => (hasFiles ? `await resolveFileRefs(${expr}, FILE_FIELDS)` : expr);
  const procedures: string[] = [];

  if (list) {
    validationImports.add(`${resource.name}ListQuery`);
    const filterLines = list.filters.map(
      f => `    if (filters.${f} !== undefined) conditions.push(eq(${table}.${f}, filters.${f}));`
    );
    filterLines.push(...listFilter!.lines);
    if (list.search.length) {
      filterLines.push(`    if (q) {
      const pattern = "%" + q.replace(/[\\\\%_]/g, "\\\\$&") + "%";
      conditions.push(or(${list.search.map(f => `ilike(${table}.${f}, pattern)`).join(", ")})!);
    }`);
    }
    const defaultOrder = list.order.map(([col, dir]) => `${dir}(${table}.${col})`).join(", ");
    const orderBy = list.sortable.length ? `sort ? sortOrder(sort) : [${defaultOrder}]` : `[${defaultOrder}]`;
    const picks = [
      "page",
      "page_size",
      ...(list.sortable.length ? ["sort"] : []),
      ...(list.search.length ? ["q"] : [])
    ];
    const destructure = list.filters.length
      ? `const { ${picks.join(", ")}, ...filters } = input;`
      : `const { ${picks.join(", ")} } = input;`;
    const whereLines = hasConditions
      ? `    const conditions: SQL[] = [];\n${filterLines.join("\n")}\n    const where = conditions.length ? and(...conditions) : undefined;`
      : `    const where = undefined;`;
    if (list.sortable.length)
      sections.push(`function sortOrder(sort: keyof typeof SORTABLE | string): SQL[] {
  const [field, direction] = sort.split(":");
  const column = SORTABLE[field as keyof typeof SORTABLE];
  return [direction === "desc" ? desc(column) : asc(column)];
}`);
    procedures.push(`  /** ${resource.name}.list: { data, page } */
  list: publicProcedure.input(${resource.name}ListQuery).query(async ({ ctx, input }) => {
    checkRule(RULES.read, ctx.session);
    ${destructure}
${whereLines}
    try {
      const [rows, [{ total }]] = await Promise.all([
        ${query}.findMany({ where${withClause(list.include)}, orderBy: ${orderBy}, limit: page_size, offset: (page - 1) * page_size }),
        db.select({ total: count() }).from(${table}).where(where)
      ]);
      return { data: rows.map(presentListRow), page: { page, page_size, total } };
    } catch (err) {
      throw toTRPCError(err, "read");
    }
  })`);
  }

  if (get) {
    errorImports.add("notFound");
    procedures.push(`  get: publicProcedure.input(z.object({ id: ID })).query(async ({ ctx, input }) => {
    checkRule(RULES.read, ctx.session);
    const id = parseId(${resource.name}Id, input.id);
    const row = await ${query}.findFirst({ where: eq(${table}.${pk}, id)${withClause(get.include)} }).catch(err => {
      throw toTRPCError(err, "read");
    });
    if (!row) throw notFound();
    checkRule(RULES.read, ctx.session, ${rowArg(get.rule, "row")});
    return presentGetRow(row);
  })`);
  }

  if (create) {
    validationImports.add(`${resource.name}CreateInput`);
    const owner = create.ownerField ? `, ${create.ownerField}: ${me}` : "";
    const emitLines = events("created").map(e => `      await emit(${q(e.name)}, present${T}(row));`);
    const defaults = conditionDefaults(entity, create.rule);
    const bodyCheck = needsBodyCheck(create.rule)
      ? `, ${rowArg(create.rule, owner || defaults ? `{ ${defaults}...input${owner} }` : "input")}`
      : "";
    const insert =
      isTenant && tenancy && membershipTable
        ? `      const row = await db.transaction(async tx => {
        const [created] = await tx.insert(${table}).values(values).returning();
        await tx.insert(${membershipTable}).values({ ${tenancy.userColumn}: ctx.session!.user.${identityPk(ir)}, ${tenancy.tenantColumn}: created.${pk}, ${tenancy.roleColumn}: ${q(tenancy.creatorRole)} });
        return created;
      });`
        : `      const [row] = await db.insert(${table}).values(values).returning();`;
    procedures.push(`  create: publicProcedure.input(${resource.name}CreateInput).mutation(async ({ ctx, input }) => {
    checkRule(RULES.create, ctx.session${bodyCheck});
    const hookContext: HookContext = { session: ctx.session, req: ctx.req };
    try {
      const values = await hooks.beforeCreate({ ...${resolveFiles("input")}${owner} }, hookContext);
${insert}
${emitLines.join("\n")}${timerLine}
      await hooks.afterCreate(row, hookContext);
      return present${T}(row);
    } catch (err) {
      throw toTRPCError(err, "write");
    }
  })`);
  }

  if (update) {
    validationImports.add(`${resource.name}UpdateInput`);
    errorImports.add("notFound");
    const emitLines = events("updated").map(e => `      await emit(${q(e.name)}, present${T}(row));`);
    procedures.push(`  update: publicProcedure
    .input(z.object({ id: ID, data: ${resource.name}UpdateInput }))
    .mutation(async ({ ctx, input }) => {
      checkRule(RULES.update, ctx.session);
      const id = parseId(${resource.name}Id, input.id);
      const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id) }).catch(err => {
        throw toTRPCError(err, "read");
      });
      if (!existing) throw notFound();
      checkRule(RULES.update, ctx.session, ${rowArg(update.rule, "existing")});
      const hookContext: HookContext = { session: ctx.session, req: ctx.req };
      try {
        const patch = await hooks.beforeUpdate(existing, ${resolveFiles("input.data")}, hookContext);
        if (Object.keys(patch).length === 0) return present${T}(existing);
        const [row] = await db.update(${table}).set(patch).where(eq(${table}.${pk}, id)).returning();
${emitLines.map(l => "  " + l).join("\n")}${timerLine}
        await hooks.afterUpdate(row, hookContext);
        return present${T}(row);
      } catch (err) {
        throw toTRPCError(err, "write");
      }
    })`);
  }

  if (remove) {
    errorImports.add("notFound");
    const emitLines = events("deleted").map(e => `      await emit(${q(e.name)}, present${T}(existing));`);
    procedures.push(`  delete: publicProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
    checkRule(RULES.delete, ctx.session);
    const id = parseId(${resource.name}Id, input.id);
    const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id) }).catch(err => {
      throw toTRPCError(err, "read");
    });
    if (!existing) throw notFound();
    checkRule(RULES.delete, ctx.session, ${rowArg(remove.rule, "existing")});
    const hookContext: HookContext = { session: ctx.session, req: ctx.req };
    try {
      await hooks.beforeDelete(existing, hookContext);
      await db.delete(${table}).where(eq(${table}.${pk}, id));
${emitLines.join("\n")}
      await hooks.afterDelete(existing, hookContext);
      return null;
    } catch (err) {
      throw toTRPCError(err, "delete");
    }
  })`);
  }

  for (const action of actions) {
    validationImports.add(actionInputName(action));
    if (action.scope === "row") errorImports.add("notFound");
    procedures.push(
      actionProcedure(ir, action, {
        table,
        query,
        pk,
        idName: `${resource.name}Id`,
        T,
        actionEvents: actionEvents(action.name)
      })
    );
  }

  const imports = [
    ...(drizzleImports.size
      ? [`import { ${[...drizzleImports].sort().join(", ")}${list ? ", type SQL" : ""} } from "drizzle-orm";`]
      : []),
    ...(needsId ? [`import { z } from "zod";`] : []),
    `import { db } from "../../db/client";`,
    `import * as schema from "../../db/schema";`,
    `import { ${[
      `${tableExport(entity)} as ${table}`,
      ...(isTenant && membershipTable ? [`${membershipTable.replace(/Table$/, "")} as ${membershipTable}`] : []),
      ...[...extraTables]
        .filter(name => !(isTenant && tenancy && name === tenancy.membership))
        .sort()
        .map(name => `${tableExport(entityByName(ir, name))} as ${tableVar(entityByName(ir, name))}`)
    ].join(", ")} } from "../../db/schema";`,
    ...(usesEmit ? [`import { emit } from "../../events";`] : []),
    ...(hasTimers ? [`import { scheduleTimers } from "../../scheduling";`] : []),
    ...(hasFiles ? [`import { resolveFileRefs } from "../../files";`] : []),
    `import { ${[...presents].sort().join(", ")} } from "../../present";`,
    `import { ${[...validationImports].sort().join(", ")} } from "../../validation";`,
    ...(actions.length ? [`import { handlers } from "../../actions";`] : []),
    `import { ${[...accessImports].sort().join(", ")}, type Rule } from "../access";`,
    `import type { Session } from "../auth";`,
    `import { ${[...errorImports].sort().join(", ")} } from "../errors";`,
    `import { publicProcedure, router } from "../trpc";`,
    `import { hooks } from "${VITE.src(`extensions/${resource.name}`)}";`
  ];

  return `${HEADER(`tRPC router for the ${resource.name} resource (${entity.name}).`)}
${imports.join("\n")}

export type HookContext = { session: Session | null; req: Request };

${sections.join("\n\n")}

export const ${resource.name}Router = router({
${procedures.join(",\n\n")}
});
`;
}

/** A tRPC procedure for an action, inside a resource router or the global actions router */
function actionProcedure(
  ir: IR,
  action: ActionIR,
  row: { table: string; query: string; pk: string; idName: string; T: string; actionEvents: IR["events"] } | null
): string {
  const input = actionInputName(action);
  const present = action.returns.kind === "entity" ? `present${row!.T}` : null;
  const resultExpr =
    action.returns.kind === "entity" ? `${present}(result)` : action.returns.kind === "none" ? "null" : "result";
  const emitLines = (
    row?.actionEvents ?? ir.events.filter(e => e.kind === "action" && !e.resource && e.actionName === action.name)
  ).map(
    e =>
      `      await emit(${q(e.name)}, ${action.returns.kind === "entity" ? `${present}(result)` : action.returns.kind === "none" ? "{}" : "result"});`
  );
  const rulesRef = row ? `ACTION_RULES.${action.name}` : `RULES.${action.name}`;
  if (action.scope === "row" && row) {
    return `  /** POST ${action.path} */
  ${action.name}: publicProcedure.input(${input}.extend({ id: ID })).mutation(async ({ ctx, input: raw }) => {
    const { id: rawId, ...input } = raw;
    checkRule(${rulesRef}, ctx.session);
    const id = parseId(${row.idName}, rawId);
    const current = await ${row.query}.findFirst({ where: eq(${row.table}.${row.pk}, id) }).catch(err => {
      throw toTRPCError(err, "read");
    });
    if (!current) throw notFound();
    checkRule(${rulesRef}, ctx.session, ${rowArg(action.rule, "current")});
    try {
      const result = await handlers.${action.handler}({ input, row: current, session: ctx.session, db, now: new Date() });
${emitLines.join("\n")}
      return ${resultExpr};
    } catch (err) {
      throw toTRPCError(err, "write");
    }
  })`;
  }
  return `  /** POST ${action.path} */
  ${action.name}: publicProcedure.input(${input}).mutation(async ({ ctx, input }) => {
    checkRule(${rulesRef}, ctx.session);
    try {
      const result = await handlers.${action.handler}({ input, row: undefined, session: ctx.session, db, now: new Date() });
${emitLines.join("\n")}
      return ${resultExpr};
    } catch (err) {
      throw toTRPCError(err, "write");
    }
  })`;
}

/** generated/server/actions-router.ts: the actions not tied to a resource */
export function actionsRouterFile(ir: IR): string {
  const actions = globalActions(ir).filter(a => a.rule.kind !== "none");
  const usesEmit = actions.some(a =>
    ir.events.some(e => e.kind === "action" && !e.resource && e.actionName === a.name)
  );
  return `${HEADER("tRPC router for the actions not tied to a resource (POST /api/actions/<name>).")}
import { db } from "../db/client";
${usesEmit ? `import { emit } from "../events";\n` : ""}import { ${actions.map(actionInputName).sort().join(", ")} } from "../validation";
import { handlers } from "../actions";
import { checkRule, type Rule } from "./access";
import { toTRPCError } from "./errors";
import { publicProcedure, router } from "./trpc";

const RULES = {
${actions.map(a => `  ${a.name}: ${ruleLiteral(a.rule)} as Rule`).join(",\n")}
};

export const actionsRouter = router({
${actions.map(a => actionProcedure(ir, a, null)).join(",\n\n")}
});
`;
}

/** src/extensions/<resource>.ts: user-owned hooks, created once. */
export function hooksScaffold(ir: IR, resource: ResourceIR): GeneratedFile {
  const entity = entityByName(ir, resource.entity);
  const T = typeName(entity);
  return {
    path: `src/extensions/${resource.name}.ts`,
    mode: "scaffold",
    content: `${SCAFFOLD_HEADER(`Hooks around the generated ${resource.name} procedures.`)}
import type { ${T}, New${T} } from "${VITE.generated("db/schema")}";
import type { HookContext } from "${VITE.generated(`server/resources/${resource.name}`)}";

// Throw a TRPCError from "@trpc/server" in a before-hook to reject the call.
export const hooks = {
  async beforeCreate(input: New${T}, _ctx: HookContext): Promise<New${T}> {
    return input;
  },
  async afterCreate(_row: ${T}, _ctx: HookContext): Promise<void> {},
  async beforeUpdate(_existing: ${T}, patch: Partial<New${T}>, _ctx: HookContext): Promise<Partial<New${T}>> {
    return patch;
  },
  async afterUpdate(_row: ${T}, _ctx: HookContext): Promise<void> {},
  async beforeDelete(_row: ${T}, _ctx: HookContext): Promise<void> {},
  async afterDelete(_row: ${T}, _ctx: HookContext): Promise<void> {}
};
`
  };
}

export type { EntityIR };
