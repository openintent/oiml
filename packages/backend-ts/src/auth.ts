import type { GeneratedFile, IR } from "@osl/core";
import { fileSpecsLiteral, fillEnums, membershipType, membershipsLoader, zodForColumn } from "@osl/ts-common";
import { HEADER, entityByName, q, tableExport, typeName } from "./util.js";

/** generated/auth.ts: sessions, passwords and the auth handlers. Without auth, a stub. */
export function authFile(ir: IR): string {
  if (!ir.auth) {
    return `${HEADER("Auth is not configured in the model; sessions are always empty.")}
export type Session = { user: { id: never }; memberships: { tenant: string | number; role: string }[] };

export async function getSession(_request: Request): Promise<Session | null> {
  return null;
}
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
  const oauth = auth.providers.some(p => p.kind === "oauth");
  const tenancy = auth.tenancy;
  const membershipTable = tenancy ? tableExport(entityByName(ir, tenancy.membership)) : null;
  const registerFields = auth.registerFields.map(name => identity.columns.find(c => c.name === name)!);
  const registerShape = [
    `  ${auth.emailColumn}: ${fillEnums(zodForColumn(identity.columns.find(c => c.name === auth.emailColumn)!, "create"), ir, identity)}`,
    `  password: z.string().min(8).max(200)`,
    ...registerFields.map(c => `  ${c.name}: ${fillEnums(zodForColumn(c, "create"), ir, identity)}`)
  ].join(",\n");
  // Under isolation: database the memberships come from a function (no tenant is bound yet) and requests run in a tenant scope
  const isolated = Boolean(tenancy?.isolation);
  const schemaImports = [
    `${table} as ${tableAlias}`,
    ...(membershipTable && !isolated ? [`${membershipTable} as ${membershipTable}Table`] : [])
  ];
  const fileSpecs = identity.columns.some(c => c.type.kind === "file");
  const providerImports = [
    ...(magic ? ["issueMagicLink", "verifyMagicLink"] : []),
    ...(oauth ? ["APP_URL", "oauthCallback", "oauthStart"] : []),
    ...(magic || oauth ? ["PROVIDERS"] : [])
  ];

  return `${HEADER("Auth: cookie sessions and the auth handlers (passwords, magic links, OAuth, sign-out, me).")}
import { createHmac, randomBytes${credentials ? ", scryptSync" : ""}, timingSafeEqual } from "node:crypto";
import { eq${isolated ? ", sql" : ""} } from "drizzle-orm";
import { z } from "zod";
import { db${isolated ? ", withTenants" : ""} } from "./db/client";
import { ${schemaImports.join(", ")} } from "./db/schema";
import { created, error, handleError, noContent, ok, parseBody } from "./http";
import { present${T}, type Public${T} } from "./present";
${fileSpecs ? `import { resolveFileRefs } from "./files";\n` : ""}${providerImports.length ? `import { ${providerImports.sort().join(", ")} } from "./auth-providers";\n` : ""}
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

function sessionCookie(userId: string | number): string {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp })).toString("base64url");
  const value = payload + "." + sign(payload);
  return COOKIE + "=" + value + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86_400;
}

function clearedCookie(): string {
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

${
  isolated
    ? `const SESSIONS = new WeakMap<Request, Promise<Session | null>>();

/** The signed-in user, or null, read once per request. Loads the user so a deleted account signs out immediately. */
export function getSession(request: Request): Promise<Session | null> {
  let session = SESSIONS.get(request);
  if (!session) {
    session = loadSession(request);
    SESSIONS.set(request, session);
  }
  return session;
}

async function loadSession(request: Request): Promise<Session | null> {
  const cookie = readCookie(request);
  if (!cookie) return null;
  const user = await db.query.${table}.findFirst({ where: eq(${tableAlias}.${pk}, cookie.uid as never) }).catch(() => undefined);
  return user ? sessionOf(user) : null;
}

/**
 * Answer a request within its caller's tenants: the session is read first (the identity is shared and the
 * memberships come from a function), then the handler runs in one transaction that reaches only the rows of those
 * tenants. Every generated route goes through here; a path that does not reads no tenant row at all.
 */
export async function withRequest(request: Request, handler: () => Promise<Response>): Promise<Response> {
  const session = await getSession(request);
  return withTenants(session?.memberships.map(m => m.tenant) ?? [], handler);
}
`
    : `/** The signed-in user, or null. Loads the user so a deleted account signs out immediately. */
export async function getSession(request: Request): Promise<Session | null> {
  const cookie = readCookie(request);
  if (!cookie) return null;
  const user = await db.query.${table}.findFirst({ where: eq(${tableAlias}.${pk}, cookie.uid as never) }).catch(() => undefined);
  return user ? sessionOf(user) : null;
}
`
}${
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
  }${magic ? `\nconst magicLinkInput = z.object({ email: z.string().email() }).strict();\nconst magicLinkVerifyInput = z.object({ token: z.string().min(1) }).strict();\n` : ""}
function withCookie(response: Response, cookie: string): Response {
  const headers = new Headers(response.headers);
  headers.append("set-cookie", cookie);
  return new Response(response.body, { status: response.status, headers });
}

export const auth = {${
    credentials
      ? `
  async register(request: Request): Promise<Response> {
    try {
      const body = await parseBody(registerInput, request);
      if (!body.ok) return body.response;
      const { password, ...fields } = body.data;
      const [user] = await db
        .insert(${tableAlias})
        .values({ ...${fileSpecs ? `(await resolveFileRefs(fields, ${fileSpecsLiteral(identity)} as const))` : "fields"}, ${auth.passwordColumn}: hashPassword(password) })
        .returning();
      return withCookie(created(present${T}(user)), sessionCookie(user.${pk}));
    } catch (err) {
      return handleError(err, "write");
    }
  },

  async login(request: Request): Promise<Response> {
    try {
      const body = await parseBody(loginInput, request);
      if (!body.ok) return body.response;
      const user = await db.query.${table}.findFirst({ where: eq(${tableAlias}.${auth.emailColumn}, body.data.${auth.emailColumn}) });
      if (!user || !verifyPassword(body.data.password, user.${auth.passwordColumn})) {
        return error(401, "invalid_credentials", "Email or password is wrong");
      }
      return withCookie(ok(present${T}(user)), sessionCookie(user.${pk}));
    } catch (err) {
      return handleError(err, "read");
    }
  },
`
      : ""
  }${
    magic
      ? `
  /** Email a one-time sign-in link; always answers sent so addresses cannot be probed (tests get the token when emails are captured) */
  async magicLink(request: Request): Promise<Response> {
    try {
      const body = await parseBody(magicLinkInput, request);
      if (!body.ok) return body.response;
      const issued = await issueMagicLink(body.data.email);
      return ok(issued ? { sent: true, debug: { token: issued.token, url: issued.url } } : { sent: true });
    } catch (err) {
      return handleError(err, "write");
    }
  },

  async magicLinkVerify(request: Request): Promise<Response> {
    try {
      const body = await parseBody(magicLinkVerifyInput, request);
      if (!body.ok) return body.response;
      const user = await verifyMagicLink(body.data.token);
      return withCookie(ok(present${T}(user)), sessionCookie(user.${pk}));
    } catch (err) {
      return handleError(err, "write");
    }
  },
`
      : ""
  }${
    oauth
      ? `
  /** Send the browser to the provider */
  async oauthStart(request: Request, name: string): Promise<Response> {
    try {
      const redirectTo = new URL(request.url).searchParams.get("redirect") ?? "/";
      return Response.redirect(await oauthStart(name, redirectTo), 302);
    } catch (err) {
      return handleError(err, "write");
    }
  },

  /** The provider sends the browser back here; sign the user in and go to the app */
  async oauthCallback(request: Request, name: string): Promise<Response> {
    try {
      const params = Object.fromEntries(new URL(request.url).searchParams);
      const { user, redirectTo } = await oauthCallback(name, params);
      return withCookie(Response.redirect(APP_URL + redirectTo, 302), sessionCookie(user.${pk}));
    } catch (err) {
      return handleError(err, "write");
    }
  },
`
      : ""
  }
  async logout(_request: Request): Promise<Response> {
    return withCookie(noContent(), clearedCookie());
  },

  async me(request: Request): Promise<Response> {
    try {
      const session = await getSession(request);
      if (!session) return error(401, "unauthenticated", "Sign in to continue");
      return ok(session.user);
    } catch (err) {
      return handleError(err, "read");
    }
  },

  /** How users may sign in, for the sign-in page */
  async providers(_request: Request): Promise<Response> {
    return ok(${magic || oauth ? "PROVIDERS" : `[${auth.providers.map(p => `{ kind: ${q(p.kind)}, name: ${q(p.kind)} }`).join(", ")}]`});
  }
};
`;
}

export function authRouteFiles(ir: IR): GeneratedFile[] {
  if (!ir.auth) return [];
  const isolated = Boolean(ir.auth.tenancy?.isolation);
  const make = (folder: string, action: string, method: "GET" | "POST", withName = false) => {
    const call = `auth.${action}(request${withName ? ", name" : ""})`;
    const name = withName ? "  const name = (await ctx.params).name;\n" : "";
    return {
      path: `app/api/auth/${folder}/route.ts`,
      content: isolated
        ? `${HEADER(`Route for auth.${action}.`)}
import { auth, withRequest } from "@/generated/auth";

export async function ${method}(request: Request${withName ? ", ctx: { params: Promise<{ name: string }> }" : ""}): Promise<Response> {
${name}  return withRequest(request, () => ${call});
}
`
        : `${HEADER(`Route for auth.${action}.`)}
import { auth } from "@/generated/auth";

export async function ${method}(request: Request${withName ? ", ctx: { params: Promise<{ name: string }> }" : ""}): Promise<Response> {
  return auth.${action}(request${withName ? ", (await ctx.params).name" : ""});
}
`
    };
  };
  const files: GeneratedFile[] = [];
  if (ir.auth.providers.some(p => p.kind === "credentials"))
    files.push(make("register", "register", "POST"), make("login", "login", "POST"));
  if (ir.auth.providers.some(p => p.kind === "magic_link"))
    files.push(make("magic-link", "magicLink", "POST"), make("magic-link/verify", "magicLinkVerify", "POST"));
  if (ir.auth.providers.some(p => p.kind === "oauth"))
    files.push(
      make("oauth/[name]", "oauthStart", "GET", true),
      make("oauth/[name]/callback", "oauthCallback", "GET", true)
    );
  files.push(make("logout", "logout", "POST"), make("me", "me", "GET"), make("providers", "providers", "GET"));
  return files;
}
