/**
 * The API: Hono hosting a tRPC router. One router per resource, routers for auth, files and global
 * actions, shared context, access rules and error mapping. Procedures keep the REST contract's
 * semantics (status codes become tRPC error codes; list returns { data, page }).
 */
import type { ActionIR, EntityIR, GeneratedFile, IR, OperationIR, RelationIR, ResourceIR, RuleIR } from "@osl/core";
import { actionsOf, globalActions, hasFieldRules, hasSealed, sealedColumns } from "@osl/core";
import {
  hasInvites,
  hasVia,
  actionInputName,
  fileSpecsLiteral,
  fillEnums,
  registerValidators,
  listRuleFilter,
  membershipType,
  membershipsLoader,
  conditionDefaults,
  needsBodyCheck,
  rowArg,
  ruleLiteral,
  ruleValuesSource,
  verdictSource,
  zodForColumn,
  ARCHIVE_DRIZZLE,
  archiveCondition,
  isMove,
  isStatementAction,
  rowActionImports,
  statementHandlerLines,
  moveSource,
  removeStatement,
  throughOf,
  throughRowParts,
  throughSource,
  withClause,
  creatorViewer,
  presentCall,
  presentMapper,
  selfSessionSource,
  takesViewer,
  currencyGuardLines,
  currencyGuardMessage,
  atRestCall,
  shapeGuardLines,
  shapesConst
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
export function trpcFile(ir?: IR): string {
  if (ir?.auth?.tenancy?.isolation)
    return `${HEADER("tRPC initialisation: every procedure runs within its caller's tenants.")}
import { initTRPC } from "@trpc/server";
import { withTenants } from "../db/client";
import type { Context } from "./context";
import { codeOf, statusOf } from "./errors";

const t = initTRPC.context<Context>().create({
  /**
   * The error's data carries the contract's code (\`invalid_transition\`, \`busy\`: what the REST backends answer as
   * \`error.code\`) beside tRPC's own, and a refusal's status, also where tRPC has no code for it (410, say)
   */
  errorFormatter({ shape, error }) {
    const status = statusOf(error);
    return {
      ...shape,
      data: { ...shape.data, ...(status === undefined ? {} : { httpStatus: status }), contractCode: codeOf(error) }
    };
  }
});

/**
 * One transaction per procedure call, bound to the session's memberships: the procedure reaches the rows of those
 * tenants, what a public-read policy shows to everyone, and nothing else. A batch runs each call in its own.
 */
const withinTenants = t.middleware(({ ctx, next }) =>
  withTenants(ctx.session?.memberships.map(m => m.tenant) ?? [], () => next())
);

export const router = t.router;
export const publicProcedure = t.procedure.use(withinTenants);
export const middleware = t.middleware;
export type { Context };
`;
  return `${HEADER("tRPC initialisation.")}
import { initTRPC } from "@trpc/server";
import type { Context } from "./context";
import { codeOf, statusOf } from "./errors";

const t = initTRPC.context<Context>().create({
  /**
   * The error's data carries the contract's code (\`invalid_transition\`, \`busy\`: what the REST backends answer as
   * \`error.code\`) beside tRPC's own, and a refusal's status, also where tRPC has no code for it (410, say)
   */
  errorFormatter({ shape, error }) {
    const status = statusOf(error);
    return {
      ...shape,
      data: { ...shape.data, ...(status === undefined ? {} : { httpStatus: status }), contractCode: codeOf(error) }
    };
  }
});

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
export function errorsFile(ir?: IR): string {
  // Under isolation: database the policy refuses a write the rules let through: answered as the rules would have
  const refused = ir?.auth?.tenancy?.isolation
    ? `\n  if (code === "42501") return new TRPCError({ code: "FORBIDDEN", message: "You cannot do that" });`
    : "";
  return `${HEADER("Error mapping: database errors, bad ids and refused requests become tRPC errors with the contract's status codes.")}
import { TRPCError, type TRPC_ERROR_CODE_KEY } from "@trpc/server";
import type { ZodTypeAny, z } from "zod";

const CODES: Record<number, TRPC_ERROR_CODE_KEY> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "NOT_FOUND"
};

/** What a refusal carries as the tRPC error's cause: the contract's status and code */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * A refusal with the contract's status and code. tRPC has no code for every status (410, say), so the status
 * travels on the error and the transport answers with it.
 */
export function refusal(status: number, code: string, message: string): TRPCError {
  const fallback = status >= 400 && status < 500 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
  return new TRPCError({ code: CODES[status] ?? fallback, message, cause: new Refusal(status, code, message) });
}

/** Refuse the request with the contract's status and code */
export function fail(status: number, code: string, message: string): never {
  throw refusal(status, code, message);
}

/** The status a refusal made with fail() carries; undefined for every other error */
export function statusOf(err: unknown): number | undefined {
  return err instanceof TRPCError && err.cause instanceof Refusal ? err.cause.status : undefined;
}

/** The contract's code of an error made without fail(): the one drizzle-next and gin-pgx answer in its place */
const CONTRACT_CODES: Partial<Record<TRPC_ERROR_CODE_KEY, string>> = {
  PARSE_ERROR: "invalid_json",
  BAD_REQUEST: "validation",
  UNAUTHORIZED: "unauthenticated",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  CONFLICT: "conflict",
  INTERNAL_SERVER_ERROR: "internal"
};

/**
 * The contract's code of an error, as the REST backends answer it in \`{ error: { code } }\`: a refusal's own, \`busy\`,
 * or the one for tRPC's code (an input tRPC refused is \`validation\`, as a body the REST backends refuse is)
 */
export function codeOf(err: TRPCError): string {
  if (err.cause instanceof Refusal) return err.cause.code;
  if (isBusy(err)) return "busy";
  return CONTRACT_CODES[err.code] ?? err.code.toLowerCase();
}

export function notFound(): TRPCError {
  return new TRPCError({ code: "NOT_FOUND", message: "Not found" });
}

/**
 * 503 busy: the statement lost to a lock another request holds and did nothing. The same request can be sent again;
 * the server does not run the procedure a second time itself. The app answers it with Retry-After.
 */
export function busy(): TRPCError {
  return new TRPCError({
    code: "SERVICE_UNAVAILABLE",
    message: "Another request is changing the same rows. Try again.",
    cause: { code: "busy" }
  });
}

/** Whether an error is that answer, and not a 503 of a hook's own */
export function isBusy(err: unknown): boolean {
  if (!(err instanceof TRPCError) || err.code !== "SERVICE_UNAVAILABLE") return false;
  return (err.cause as { code?: string } | undefined)?.code === "busy";
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
      : refusal(400, "invalid_reference", "A referenced row does not exist");
  }
  if (code === "23502") return new TRPCError({ code: "BAD_REQUEST", message: "A required value is missing" });${refused}
  if (code === "22P02") {
    return operation === "read" ? notFound() : new TRPCError({ code: "BAD_REQUEST", message: "A value has the wrong format" });
  }
  // 55P03 is a lock another request held for too long, 40P01 a deadlock PostgreSQL ended by failing this statement,
  // 40001 a serialization failure: neither the caller's fault nor the server's
  if (code === "55P03" || code === "40P01" || code === "40001") return busy();
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
${
  ir.auth?.tenancy?.isolation
    ? `
/** The error a refusal becomes, for a row the caller's tenants do not reach */
export function refused(result: { ok: false; status: 401 | 403 }): TRPCError {
  return result.status === 401
    ? new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue" })
    : new TRPCError({ code: "FORBIDDEN", message: "You cannot do that" });
}
`
    : ""
}`;
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
  // Under isolation: database the memberships come from a function, since no tenant is bound when a session is read
  const isolated = Boolean(tenancy?.isolation);
  const schemaImports = [
    `${table} as ${tableAlias}`,
    ...(membershipTable && !isolated ? [`${membershipTable} as ${membershipTable}Table`] : [])
  ];
  const fileSpecs = identity.columns.some(c => c.type.kind === "file");
  // A field with a read rule on the identity: the caller's own row is presented to the caller, as any row is
  const ruled = takesViewer(identity);
  const shownOf = (userExpr: string) =>
    ruled ? `shownUser(await sessionOf(${userExpr}))` : `present${T}(${userExpr})`;
  const shown = shownOf("user");
  const fields = hasFieldRules(ir);
  const presentImports = [
    ...(ruled ? ["SERVER"] : []),
    `present${T}`,
    `type Public${T}`,
    ...(fields ? ["visibleFields"] : [])
  ];
  const oauth = auth.providers.some(p => p.kind === "oauth");
  const invites = hasInvites(ir);
  const providerImports = [
    ...(magic ? ["issueMagicLink", "verifyMagicLink"] : []),
    ...(magic || oauth ? ["PROVIDERS"] : []),
    ...(invites ? ["acceptInvite", "lookupInvite", ...(credentials ? ["acceptWithToken"] : []), "type Accepted"] : [])
  ];
  // The account an invite creates: register's fields without the email, which the token has proven. A password is
  // required where passwords are the only way in, optional beside another provider, and refused without them.
  const acceptShape = [
    ...(credentials ? [`  password: z.string().min(8).max(200)${magic || oauth ? ".optional()" : ""}`] : []),
    ...registerFields.map(c => `  ${c.name}: ${fillEnums(zodForColumn(c, "create"), ir, identity)}`)
  ].join(",\n");
  // File fields arrive as references to uploads, as they do at registration
  const acceptFields = credentials ? "fields" : "input.data";
  const acceptSpread = fileSpecs
    ? `(await resolveFileRefs(${acceptFields}, ${fileSpecsLiteral(identity)}))`
    : acceptFields;
  const acceptValues = !credentials
    ? `{ ...${acceptSpread}, ${auth.emailColumn}: email }`
    : magic || oauth
      ? `{ ...${acceptSpread}, ${auth.emailColumn}: email, ...(password ? { ${auth.passwordColumn}: hashPassword(password) } : {}) }`
      : `{ ...${acceptSpread}, ${auth.emailColumn}: email, ${auth.passwordColumn}: hashPassword(password) }`;
  /** With invites declared a sign-in answers the user as \`data\` beside what it accepted */
  const signedIn = (userExpr: string) =>
    invites ? `{ data: ${shownOf(userExpr)}, ...(accepted.length ? { accepted } : {}) }` : shownOf(userExpr);

  return `${HEADER("Auth: cookie sessions and the auth router (passwords, magic links, sign-out, the session).")}
import { createHmac, randomBytes${credentials ? ", scryptSync" : ""}, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { eq${isolated ? ", sql" : ""} } from "drizzle-orm";
import { z } from "zod";
${registerValidators(registerFields).length ? `import { ${registerValidators(registerFields).join(", ")} } from "../validation";\n` : ""}import { db } from "../db/client";
import { ${schemaImports.join(", ")} } from "../db/schema";
import { ${invites || credentials ? "fail, " : ""}toTRPCError } from "./errors";
import { ${presentImports.join(", ")} } from "../present";
${fileSpecs ? `import { resolveFileRefs } from "../files";\n` : ""}${providerImports.length ? `import { ${providerImports.join(", ")} } from "../auth-providers";\n` : ""}import { publicProcedure, router } from "./trpc";

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

${
  ruled
    ? selfSessionSource(ir, `typeof ${tableAlias}.$inferSelect`, membershipsLoader(ir, `user.${pk}`))
    : `/** The session of a user row: the public user and their memberships */
export async function sessionOf(user: typeof ${tableAlias}.$inferSelect): Promise<Session> {
  return { user: present${T}(user), memberships: ${membershipsLoader(ir, `user.${pk}`)} };
}`
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

const loginInput = z.object({ ${auth.emailColumn}: z.string(), password: z.string()${invites ? ", invite: z.string().optional()" : ""} }).strict();
`
    : ""
}${
    invites
      ? `
const inviteAcceptInput = z
  .object({${acceptShape ? `\n${acceptShape}\n  ` : ""}})
  .strict();

/**
 * Accept an invite. A session under the invited address joins. Without a session and without an account for the
 * address, \`raw\` creates the account, and the cookie in the answer signs it in.
 */
export async function acceptInviteAs(
  session: Session | null,
  token: string,
  raw: unknown
): Promise<{ data: Public${T}; accepted: Accepted[]; cookie?: string }> {
  try {
    const result = await acceptInvite(token, session?.user.${pk} ?? null, async email => {
      const input = inviteAcceptInput.safeParse(raw ?? {});
      if (!input.success) {
        const issues = input.error.issues.map(i => (i.path.length ? i.path.map(String).join(".") + ": " : "") + i.message);
        fail(400, "validation", "Request body is invalid: " + issues.join("; "));
      }
${credentials ? "      const { password, ...fields } = input.data;\n" : ""}      const [user] = await db
        .insert(${tableAlias})
        .values(${acceptValues})
        .returning();
      return user;
    });
    const { accepted } = result;
    if (result.created) return { data: ${shownOf("result.created")}, accepted, cookie: sessionCookie(result.created.${pk}) };
    // The caller's own row as their session may read it, never the whole row the server holds
    return { data: ${ruled ? "shownUser(session!)" : "session!.user"}, accepted };
  } catch (err) {
    throw toTRPCError(err, "write");
  }
}
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
      return ${shown};
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
      fail(401, "invalid_credentials", "Email or password is wrong");
    }
${
  invites
    ? `    // A password proves the address only together with an invite's token for it; anything else joins nothing
    const accepted = input.invite ? await acceptWithToken(user, input.invite) : [];
`
    : ""
}    ctx.resHeaders.append("set-cookie", sessionCookie(user.${pk}));
    return ${signedIn("user")};
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
    const ${invites ? "{ user, accepted }" : "user"} = await verifyMagicLink(input.token);
    ctx.resHeaders.append("set-cookie", sessionCookie(user.${pk}));
    return ${signedIn("user")};
  }),
`
      : ""
  }${
    invites
      ? `
  /** What an invite offers, for its landing page. It never accepts: mail scanners open links. */
  invite: publicProcedure.input(z.object({ token: z.string() }).strict()).query(({ input }) => lookupInvite(input.token)),

  /** Accept an invite; \`data\` is read only where the call creates the account */
  invite_accept: publicProcedure
    .input(z.object({ token: z.string(), data: z.unknown().optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      const { cookie, ...reply } = await acceptInviteAs(ctx.session, input.token, input.data);
      if (cookie) ctx.resHeaders.append("set-cookie", cookie);
      return reply;
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
    return ${ruled ? "shownUser(ctx.session)" : "ctx.session.user"};
  }),

  /** The signed-in user, or null: what the web app asks on every load${fields ? ". `fields` says which fields with a read rule this caller could read on some row" : ""} */
  session: publicProcedure.query(({ ctx }) => ${
    fields
      ? `
    ctx.session
      ? { user: ${ruled ? "shownUser(ctx.session)" : "ctx.session.user"}, memberships: ctx.session.memberships, fields: visibleFields(ctx.session) }
      : null
  `
      : "ctx.session"
  }),

  /** How users may sign in, for the sign-in page */
  providers: publicProcedure.query((): { kind: string; name: string }[] => ${
    magic || oauth
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
  const isolated = Boolean(ir.auth?.tenancy?.isolation);
  const invites = hasInvites(ir);
  const restRoutes: string[] = [];
  if (isolated)
    restRoutes.push(`  // REST routes answer within their caller's tenants, as the procedures do
  app.use("/api/*", async (c, next) => {
    const session = await getSession(c.req.raw);
    await withTenants(session?.memberships.map(m => m.tenant) ?? [], () => next());
  });`);
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
    app.get("/api/osl-hooks/emails", c => c.json({ data: emailsSent({ to: c.req.query("to"), subject: c.req.query("subject") }) }));${
      isolated
        ? `
    // The two hooks of the cross-tenant walk's second pass: the rule checks switched off, and the unbound probe
    app.post("/api/osl-hooks/rules/off", c => c.json({ data: rulesSwitch(true) }));
    app.post("/api/osl-hooks/rules/on", c => c.json({ data: rulesSwitch(false) }));
    app.get("/api/osl-hooks/tenancy/unbound", async c => c.json({ data: await tenancyUnbound() }));`
        : ""
    }
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
  if (invites) {
    restRoutes.push(`  // Invites: what a token offers and its acceptance, the same two calls the auth router has
  app.get("/api/auth/invites/:token", async c => {
    try {
      return c.json({ data: await lookupInvite(c.req.param("token")) });
    } catch (err) {
      return restError(c, err);
    }
  });
  app.post("/api/auth/invites/:token/accept", async c => {
    try {
      const raw: unknown = await c.req.json().catch(() => ({}));
      const { cookie, ...reply } = await acceptInviteAs(await getSession(c.req.raw), c.req.param("token"), raw);
      if (cookie) c.header("set-cookie", cookie);
      return c.json(reply, cookie ? 201 : 200);
    } catch (err) {
      return restError(c, err);
    }
  });`);
  }
  const authProviderImports = [
    ...(oauth ? ["APP_URL", "oauthCallback", "oauthStart"] : []),
    ...(invites ? ["lookupInvite"] : [])
  ];
  const authImports = [
    ...(invites ? ["acceptInviteAs"] : []),
    ...(invites || isolated ? ["getSession"] : []),
    ...(oauth ? ["sessionCookie"] : [])
  ];
  return `${HEADER("The Hono app: tRPC at /trpc, a health check, REST routes for file bytes and OAuth, and the built web app from dist/ when it exists.")}
import { existsSync } from "node:fs";
${ir.files ? `import { Readable } from "node:stream";\n` : ""}import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { TRPCError } from "@trpc/server";
import { getHTTPStatusCodeFromError } from "@trpc/server/http";
import { Hono, type Context as HonoContext } from "hono";
${ir.files ? `import { fileContent, receiveContent } from "../files";\n` : ""}${authProviderImports.length ? `import { ${authProviderImports.join(", ")} } from "../auth-providers";\n` : ""}${authImports.length ? `import { ${authImports.join(", ")} } from "./auth";\n` : ""}${ir.jobs ? `import { startWorker } from "../jobs";\n` : ""}${isolated ? `import { withTenants } from "../db/client";\n` : ""}import { emailsSent, ${isolated ? "rulesSwitch, " : ""}schedulesRun, ${isolated ? "tenancyUnbound, " : ""}testHooksEnabled, timersRun } from "../test-hooks";
import { createContext } from "./context";
import { codeOf, isBusy, statusOf } from "./errors";
import { appRouter } from "./router";
${hasSealed(ir) ? `import { sealKey } from "../seal";\n\n// Sealed fields: the server does not start without OSL_SEAL_KEY, or with one that is not a key\nsealKey();\n` : ""}
/** Errors from the shared modules are tRPC errors; REST routes answer them in the contract's shape. */
function restError(c: HonoContext, err: unknown): Response {
  if (err instanceof TRPCError) {
    const code = codeOf(err);
    if (isBusy(err)) c.header("Retry-After", "1");
    return c.json({ error: { code, message: err.message } }, (statusOf(err) ?? getHTTPStatusCodeFromError(err)) as 400);
  }
  console.error(err);
  return c.json({ error: { code: "internal", message: "Something went wrong" } }, 500);
}

export function createApp(): Hono {
  const app = new Hono();
  app.get("/healthz", c => c.json({ ok: true }));
  app.get("/health", c => c.json({ ok: true }));
  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      createContext,
      // A single call answers with the status its refusal carries; a batch keeps tRPC's own. A busy answer (503)
      // tells the caller when to send the request again.
      responseMeta: ({ errors, paths }) => {
        const status = errors.length === 1 && paths?.length === 1 ? statusOf(errors[0]) : undefined;
        const busy = errors.some(isBusy) ? { headers: new Headers({ "Retry-After": "1" }) } : {};
        return status === undefined ? busy : { status, ...busy };
      }
    })
  );
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
  if (rel.kind === "many") return `row.${rel.name}.map(${presentMapper(target, "viewer")})`;
  return `row.${rel.name} ? ${presentCall(target, `row.${rel.name}`, "viewer")} : null`;
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
  // Under isolation: database the policy hides another tenant's row from the load: the probe tells it from a missing one
  const isolated = Boolean(tenancy?.isolation);
  const probe = entity.tenant?.exists;
  const miss = (ruleRef: string) => (probe ? `await missing(id, ${ruleRef}, ctx.session)` : "notFound()");
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
  /** withRuleValues takes the session when a rule ends in a membership relation (the caller's own row is looked up) */
  const sessionArg = ruleValues?.needsSession ? ", ctx.session" : "";
  /** Tables the module imports beyond the entity's own: the membership table of a tenant, and the ones rules reach */
  const extraTables = new Set<string>([...(listFilter?.tables ?? []), ...(ruleValues?.tables ?? [])]);
  extraTables.delete(entity.name);
  const hasConditions = Boolean(
    list && (list.filters.length > 0 || listFilter!.lines.length > 0 || list.search.length > 0 || entity.archive)
  );

  const drizzleImports = new Set<string>();
  if (get || update || remove || actions.some(a => a.scope === "row") || ruleValues) drizzleImports.add("eq");
  for (const name of ruleValues?.drizzle ?? []) drizzleImports.add(name);
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
  // Whether an operation's rows are presented to a viewer: the entity or a row it includes has a field with a read rule
  const viewed = (include: string[], throughNames: string[] | undefined) =>
    takesViewer(entity) ||
    include.some(name => takesViewer(entityByName(ir, entity.relations.find(r => r.name === name)!.target))) ||
    throughOf(entity, throughNames).some(t => takesViewer(entityByName(ir, t.target)));
  /** An event's payload is the row as the server reads it, every field with a read rule included, whoever caused it */
  const serverPresent = (expr: string) => {
    if (takesViewer(entity)) presents.add("SERVER");
    return presentCall(entity, expr, "SERVER");
  };
  const validationImports = new Set<string>([`${resource.name}Id`]);
  const errorImports = new Set<string>(["parseId", "toTRPCError"]);
  /** What a write whose value does not fit its row's shape answers: 400, with each key that does not fit by its path */
  const SHAPE_REFUSAL = `fail(400, "validation", issues.map(issue => \`\${issue.path}: \${issue.message}\`).join("; "));`;
  /** A procedure that holds a value to the shape its row's enum names imports the shapes and the helper */
  const useShapes = (fields: string[]) => {
    errorImports.add("fail");
    validationImports.add("fitShape");
    for (const c of entity.columns)
      if (c.shapeBy && fields.includes(c.name)) validationImports.add(shapesConst(resource.name, c));
  };
  const accessImports = new Set<string>(["checkRule"]);
  for (const name of listFilter?.access ?? []) accessImports.add(name);
  if (entity.hidden === "not_found") accessImports.add("verdict");
  /**
   * The checks after a row is loaded: with hidden rows answered as not found, the read rule first (a hidden row
   * answers 404), then the operation's own rule, both reading one resolution of the paths they follow.
   */
  const rowChecks = (own: RuleIR, rowVar: string, indent: string): { lines: string; arg: string } => {
    if (entity.hidden !== "not_found") return { lines: "", arg: rowArg(own, rowVar, sessionArg) };
    const via = hasVia(entity.rules.read) || hasVia(own);
    const arg = via ? `${rowVar}Values` : rowVar;
    const resolve = via ? `\n${indent}const ${arg} = await withRuleValues(${rowVar}${sessionArg});` : "";
    return { lines: `${resolve}\n${indent}if (!verdict(RULES.read, ctx.session, ${arg}).ok) throw notFound();`, arg };
  };
  const usesEmit =
    ["created", "updated", "deleted"].some(a => events(a as "created").length > 0) ||
    actions.some(a => actionEvents(a.name).length > 0);
  const needsId = Boolean(get || update || remove || actions.some(a => a.scope === "row"));

  const relationsFor = (include: string[]) => include.map(name => entity.relations.find(r => r.name === name)!);
  for (const rel of [...relationsFor(list?.include ?? []), ...relationsFor(get?.include ?? [])])
    presents.add(`present${typeName(entityByName(ir, rel.target))}`);
  // Relations through a junction: loaded after the rows, one statement per relation
  const through = throughSource(ir, entity, list?.through, get?.through, tableVar);
  for (const name of through.presents) presents.add(name);
  for (const name of through.tables) if (name !== entity.name) extraTables.add(name);
  for (const name of through.drizzle) drizzleImports.add(name);
  const move = actions.find(isMove);
  if (move || (remove && entity.order)) drizzleImports.add("sql");
  // An archiving entity: the list's own condition
  if (entity.archive && list) for (const name of ARCHIVE_DRIZZLE) drizzleImports.add(name);
  // The compiler's one-statement row actions (archive, restore, the transitions) answer 409 when nothing changed
  const statements = rowActionImports(ir, actions);

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
  if (probe && needsId) {
    accessImports.add("refused");
    accessImports.add("unreachable");
    errorImports.add("notFound");
    sections.push(`/** No row came back: another tenant's row answers as the rule answers a caller it refuses, a missing one 404 */
async function missing(id: unknown, rule: Rule, session: Session | null) {
  return (await rowExists(${q(probe)}, id)) ? refused(unreachable(rule, session)) : notFound();
}`);
  }
  if (list?.sortable.length)
    sections.push(`const SORTABLE = {\n${list.sortable.map(f => `  ${f}: ${table}.${f}`).join(",\n")}\n};`);

  const rowSection = (name: "List" | "Get", include: string[], throughNames: string[] | undefined) => {
    const rels = relationsFor(include);
    const far = throughRowParts(ir, throughOf(entity, throughNames));
    const types = [...rels.map(r => `${r.name}: ${includeType(ir, r)}`), ...far.types];
    const shown = [...rels.map(r => `${r.name}: ${includePresent(ir, r)}`), ...far.presents];
    const rowType = types.length ? `schema.${T} & { ${types.join("; ")} }` : `schema.${T}`;
    const extra = shown.length ? `, ${shown.join(", ")}` : "";
    const viewer = viewed(include, throughNames) ? ", viewer: Viewer" : "";
    if (viewer) presents.add("type Viewer");
    return `type ${name}Row = ${rowType};\nfunction present${name}Row(row: ${name}Row${viewer}) {\n  return { ...${presentCall(entity, "row", "viewer")}${extra} };\n}`;
  };
  if (list) sections.push(rowSection("List", list.include, list.through));
  if (get) sections.push(rowSection("Get", get.include, get.through));
  sections.push(...through.sections);
  if (move) sections.push(moveSource(entity, table, query));
  if (statements.length) errorImports.add("fail");

  const resolveFiles = (expr: string) => (hasFiles ? `await resolveFileRefs(${expr}, FILE_FIELDS)` : expr);
  const procedures: string[] = [];

  if (list) {
    validationImports.add(`${resource.name}ListQuery`);
    const filterLines = list.filters.map(
      f => `    if (filters.${f} !== undefined) conditions.push(eq(${table}.${f}, filters.${f}));`
    );
    filterLines.push(...listFilter!.lines);
    if (entity.archive) filterLines.push(archiveCondition(entity, table, "    "));
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
      ...(list.search.length ? ["q"] : []),
      ...(entity.archive ? ["archived"] : [])
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
${
  isolated
    ? `      // One statement at a time: both run on the procedure's transaction
      const rows = await ${query}.findMany({ where${withClause(entity, list.include)}, orderBy: ${orderBy}, limit: page_size, offset: (page - 1) * page_size });
      const [{ total }] = await db.select({ total: count() }).from(${table}).where(where);`
    : `      const [rows, [{ total }]] = await Promise.all([
        ${query}.findMany({ where${withClause(entity, list.include)}, orderBy: ${orderBy}, limit: page_size, offset: (page - 1) * page_size }),
        db.select({ total: count() }).from(${table}).where(where)
      ]);`
}
      return { data: ${through.list("rows")}.map(${viewed(list.include, list.through) ? "row => presentListRow(row, ctx.session)" : "presentListRow"}), page: { page, page_size, total } };
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
    const row = await ${query}.findFirst({ where: eq(${table}.${pk}, id)${withClause(entity, get.include)} }).catch(err => {
      throw toTRPCError(err, "read");
    });
    if (!row) throw ${miss("RULES.read")};
    ${
      entity.hidden === "not_found"
        ? `if (!verdict(RULES.read, ctx.session, ${rowArg(get.rule, "row", sessionArg)}).ok) throw notFound();`
        : `checkRule(RULES.read, ctx.session, ${rowArg(get.rule, "row", sessionArg)});`
    }
    return presentGetRow(${
      get.through?.length
        ? `await attachGet([row]).then(rows => rows[0], err => {\n      throw toTRPCError(err, "read");\n    })`
        : "row"
    }${viewed(get.include, get.through) ? ", ctx.session" : ""});
  })`);
  }

  if (create) {
    validationImports.add(`${resource.name}CreateInput`);
    const owner = create.ownerField ? `, ${create.ownerField}: ${me}` : "";
    const emitLines = events("created").map(e => `      await emit(${q(e.name)}, ${serverPresent("row")});`);
    const defaults = conditionDefaults(entity, create.rule);
    // The session is checked first: the body check reads the owner id from it and may query related rows
    const bodyCheck = needsBodyCheck(create.rule)
      ? `\n    checkRule(RULES.create, ctx.session, ${rowArg(create.rule, owner || defaults ? `{ ${defaults}...input${owner} }` : "input", sessionArg)});`
      : "";
    // Under isolation: database a new tenant is bound to the request before the insert, or its own policy would refuse the row
    const bind = isTenant && isolated;
    const insert =
      isTenant && tenancy && membershipTable
        ? `${bind ? `      const tenantId = randomUUID();\n      await bindTenant(tenantId);\n` : ""}      const row = await db.transaction(async tx => {
        const [created] = await tx.insert(${table}).values(${bind ? `{ ...values, ${pk}: tenantId }` : "values"}).returning();
        await tx.insert(${membershipTable}).values({ ${tenancy.userColumn}: ctx.session!.user.${identityPk(ir)}, ${tenancy.tenantColumn}: created.${pk}, ${tenancy.roleColumn}: ${q(tenancy.creatorRole)} });
        return created;
      });`
        : `      const [row] = await db.insert(${table}).values(values).returning();`;
    const createShape = shapeGuardLines(
      entity,
      resource.name,
      create.fields,
      "create",
      "input",
      "",
      SHAPE_REFUSAL,
      "    "
    );
    if (createShape.length) useShapes(create.fields);
    const createShapeLines = createShape.length ? `\n${createShape.join("\n")}` : "";
    // An invite is issued, not inserted: the role ceiling, the token, the mail and the row are one function
    if (create.invite) errorImports.add("fail");
    const write = create.invite
      ? `      const { row, debug } = await issue${T}(input, session, values => hooks.beforeCreate(values, hookContext));`
      : `      const values = await hooks.beforeCreate(${atRestCall(entity, `{ ...${resolveFiles("input")}${owner} }`)}, hookContext);
${insert}`;
    const presented = presentCall(
      entity,
      "row",
      isTenant && tenancy ? creatorViewer(ir, "ctx.session", `row.${pk}`) : "ctx.session"
    );
    procedures.push(`  create: publicProcedure.input(${resource.name}CreateInput).mutation(async ({ ctx, input }) => {
    checkRule(RULES.create, ctx.session);${createShapeLines}${bodyCheck}${
      create.invite
        ? `
    const session = ctx.session ?? fail(401, "unauthenticated", "Sign in to continue");`
        : ""
    }
    const hookContext: HookContext = { session: ctx.session, req: ctx.req };
    try {
${write}
${emitLines.join("\n")}${timerLine}
      await hooks.afterCreate(row, hookContext);
      return ${create.invite ? `{ data: ${presented}, ...(debug ? { debug } : {}) }` : presented};
    } catch (err) {
      throw toTRPCError(err, "write");
    }
  })`);
  }

  if (update) {
    validationImports.add(`${resource.name}UpdateInput`);
    errorImports.add("notFound");
    const emitLines = events("updated").map(e => `      await emit(${q(e.name)}, ${serverPresent("row")});`);
    const updateChecks = rowChecks(update.rule, "existing", "      ");
    const currencyGuard = currencyGuardLines(
      entity,
      update.fields,
      "input.data",
      "existing",
      currency => `fail(400, "validation", \`${currencyGuardMessage(currency, '${missing.join(", ")}')}\`);`,
      "      "
    );
    if (currencyGuard.length) errorImports.add("fail");
    const currencyLines = currencyGuard.length ? `\n${currencyGuard.join("\n")}` : "";
    const updateShape = shapeGuardLines(
      entity,
      resource.name,
      update.fields,
      "update",
      "input.data",
      "existing",
      SHAPE_REFUSAL,
      "      "
    );
    if (updateShape.length) useShapes(update.fields);
    const updateShapeLines = updateShape.length ? `\n${updateShape.join("\n")}` : "";
    procedures.push(`  update: publicProcedure
    .input(z.object({ id: ID, data: ${resource.name}UpdateInput }))
    .mutation(async ({ ctx, input }) => {
      checkRule(RULES.update, ctx.session);
      const id = parseId(${resource.name}Id, input.id);
      const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id) }).catch(err => {
        throw toTRPCError(err, "read");
      });
      if (!existing) throw ${miss("RULES.update")};${updateChecks.lines}
      checkRule(RULES.update, ctx.session, ${updateChecks.arg});${currencyLines}${updateShapeLines}
      const hookContext: HookContext = { session: ctx.session, req: ctx.req };
      try {
        const patch = await hooks.beforeUpdate(existing, ${atRestCall(entity, resolveFiles("input.data"))}, hookContext);
        if (Object.keys(patch).length === 0) return ${presentCall(entity, "existing", "ctx.session")};
        const [row] = await db.update(${table}).set(patch).where(eq(${table}.${pk}, id)).returning();
${emitLines.map(l => "  " + l).join("\n")}${timerLine}
        await hooks.afterUpdate(row, hookContext);
        return ${presentCall(entity, "row", "ctx.session")};
      } catch (err) {
        throw toTRPCError(err, "write");
      }
    })`);
  }

  if (remove) {
    errorImports.add("notFound");
    const emitLines = events("deleted").map(e => `      await emit(${q(e.name)}, ${serverPresent("existing")});`);
    const deleteChecks = rowChecks(remove.rule, "existing", "    ");
    procedures.push(`  delete: publicProcedure.input(z.object({ id: ID })).mutation(async ({ ctx, input }) => {
    checkRule(RULES.delete, ctx.session);
    const id = parseId(${resource.name}Id, input.id);
    const existing = await ${query}.findFirst({ where: eq(${table}.${pk}, id) }).catch(err => {
      throw toTRPCError(err, "read");
    });
    if (!existing) throw ${miss("RULES.delete")};${deleteChecks.lines}
    checkRule(RULES.delete, ctx.session, ${deleteChecks.arg});
    const hookContext: HookContext = { session: ctx.session, req: ctx.req };
    try {
      await hooks.beforeDelete(existing, hookContext);
      ${removeStatement(entity, "id") ?? `await db.delete(${table}).where(eq(${table}.${pk}, id));`}
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
        entity,
        serverPresent,
        actionEvents: actionEvents(action.name),
        checks: rowChecks(action.rule, "current", "    "),
        miss: miss(`ACTION_RULES.${action.name}`)
      })
    );
  }

  const imports = [
    ...(drizzleImports.size
      ? [`import { ${[...drizzleImports].sort().join(", ")}${list ? ", type SQL" : ""} } from "drizzle-orm";`]
      : []),
    ...(needsId ? [`import { z } from "zod";`] : []),
    ...(isTenant && isolated && create ? [`import { randomUUID } from "node:crypto";`] : []),
    `import { ${["db", ...(isTenant && isolated && create ? ["bindTenant"] : []), ...(accessImports.has("unreachable") ? ["rowExists"] : [])].join(", ")} } from "../../db/client";`,
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
    ...(sealedColumns(entity).length && (create || update) ? [`import { atRest } from "../../seal";`] : []),
    ...(create?.invite ? [`import { issue${T} } from "../../auth-providers";`] : []),
    `import { ${[...presents].sort().join(", ")} } from "../../present";`,
    `import { ${[...validationImports].sort().join(", ")} } from "../../validation";`,
    ...(actions.some(a => !a.builtin) ? [`import { handlers } from "../../actions";`] : []),
    ...(statements.length ? [`import { ${statements.join(", ")} } from "../../row-actions";`] : []),
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
  row: {
    table: string;
    query: string;
    pk: string;
    idName: string;
    entity: EntityIR;
    /** The row as an event's payload carries it */
    serverPresent: (expr: string) => string;
    actionEvents: IR["events"];
    /** The checks after the row is loaded (a hidden row's 404 when the entity asks for it) and the row the action's own check reads */
    checks: { lines: string; arg: string };
    /** What a row that did not come back answers: notFound(), or under isolation the probe's answer */
    miss: string;
  } | null
): string {
  const input = actionInputName(action);
  const resultExpr =
    action.returns.kind === "entity"
      ? presentCall(row!.entity, "result", "ctx.session")
      : action.returns.kind === "none"
        ? "null"
        : "result";
  const emitLines = (
    row?.actionEvents ?? ir.events.filter(e => e.kind === "action" && !e.resource && e.actionName === action.name)
  ).map(
    e =>
      `      await emit(${q(e.name)}, ${action.returns.kind === "entity" ? row!.serverPresent("result") : action.returns.kind === "none" ? "{}" : "result"});`
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
    if (!current) throw ${row.miss};${row.checks.lines}
    checkRule(${rulesRef}, ctx.session, ${row.checks.arg});
    try {
      ${
        isMove(action)
          ? `const result = await moveRow(current, input.to);\n      if (!result) throw notFound();`
          : isStatementAction(action)
            ? ["void input;", ...statementHandlerLines(ir, action, "current")].join("\n      ")
            : `const result = await handlers.${action.handler}({ input, row: current, session: ctx.session, db, now: new Date() });`
      }
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
