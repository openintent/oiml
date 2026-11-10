import type { IR, ProviderIR } from "@osl/core";
import { entityByName, q, tableExport, typeName } from "./conventions.js";
import { hasInvites, inviteImports, invitesSource, isolatedInvites } from "./invites.js";
import type { ServerConventions } from "./server-conventions.js";

/**
 * Whether the model needs generated/auth-providers.ts and generated/email.ts: it signs users in with magic links
 * or OAuth, or it sends invites
 */
export function hasProviders(ir: IR): boolean {
  return Boolean(ir.auth?.providers.some(p => p.kind !== "credentials")) || hasInvites(ir);
}

/**
 * generated/auth-providers.ts: magic links, OAuth and invites, transport-neutral. The backend's auth routes call
 * these and set the session cookie on the user they answer.
 */
export function authProvidersFile(ir: IR, conv: ServerConventions): string {
  const auth = ir.auth!;
  const identity = entityByName(ir, auth.identity);
  const T = typeName(identity);
  const table = tableExport(identity);
  const pk = identity.primaryKey[0];
  const magic = auth.providers.some(p => p.kind === "magic_link");
  const oauth = auth.providers.filter((p): p is Extract<ProviderIR, { kind: "oauth" }> => p.kind === "oauth");
  const nameValue = auth.nameColumn ? `, ${auth.nameColumn}: name ?? email.split("@")[0]` : "";
  const createUser = auth.registerable
    ? `  const [created] = await db
    .insert(identityTable)
    .values({ ${auth.emailColumn}: email${nameValue} })
    .returning();
  return created;`
    : `  void name;
  fail(403, "registration_closed", "No account for " + email + "; register first");`;

  const invites = hasInvites(ir);
  const invite = invites ? inviteImports(ir, conv) : { schema: [], lines: [] };
  // Under isolation: database an invite's tenant is read past the policy and bound before the invite is
  const bound = isolatedInvites(ir);
  const imports = [
    `import { createHash, randomBytes } from "node:crypto";`,
    `import { and, eq, gt${bound ? ", sql" : ""} } from "drizzle-orm";`,
    `import { ${bound ? "bindTenant, " : ""}db } from "./db/client";`,
    `import { ${table} as identityTable${magic ? ", oslAuthTokens" : ""}${oauth.length ? ", oslAuthStates, oslAuthAccounts" : ""}${invite.schema.map(name => `, ${name}`).join("")}, type ${T} } from "./db/schema";`,
    `import { fail } from "${conv.errorsModule}";`,
    ...(magic || invites ? [`import { emailMode, ${invites ? "inviteEmail, " : ""}sendEmail } from "./email";`] : []),
    ...invite.lines
  ];
  const what = invites
    ? "Sign-in providers beyond passwords (magic links, OAuth) and invites. Transport-neutral; the auth routes set the cookie."
    : "Sign-in providers beyond passwords: magic links and OAuth. Transport-neutral; the auth routes set the cookie.";

  const presets = oauth
    .map(p => {
      const name = p.name;
      const env = name.toUpperCase().replace(/-/g, "_");
      const config =
        p.provider === "github"
          ? `{ kind: "github", authorize: "https://github.com/login/oauth/authorize", token: "https://github.com/login/oauth/access_token", scope: "read:user user:email", pkce: false }`
          : p.provider === "google"
            ? `{ kind: "oidc", issuer: "https://accounts.google.com", scope: "openid email profile", pkce: true }`
            : `{ kind: "oidc", issuer: ${q(p.issuer!)}, scope: "openid email profile", pkce: true }`;
      return `  ${q(name)}: { ...${config}, clientId: process.env.OAUTH_${env}_CLIENT_ID ?? "", clientSecret: process.env.OAUTH_${env}_CLIENT_SECRET ?? "" }`;
    })
    .join(",\n");

  return `${conv.header(what)}
${imports.join("\n")}

/** Where the web app lives: magic links${invites ? " and invites" : ""} point here and OAuth returns here (OSL_APP_URL) */
export const APP_URL = (process.env.OSL_APP_URL ?? "http://localhost:3000").replace(/\\/$/, "");

const MAGIC_LINK_MINUTES = 10;
const OAUTH_STATE_MINUTES = 10;

export const PROVIDERS: { kind: string; name: string }[] = [
${auth.providers.map(p => `  { kind: ${q(p.kind)}, name: ${q(p.kind === "oauth" ? p.name : p.kind)} }`).join(",\n")}
];

function hash(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

/** The user with this email, created when the identity needs nothing but an email and a name. */
export async function findOrCreateByEmail(rawEmail: string, name?: string): Promise<${T}> {
  const email = rawEmail.trim().toLowerCase();
  const existing = await db.query.${table}.findFirst({ where: eq(identityTable.${auth.emailColumn}, email) });
  if (existing) return existing;
${createUser}
}
${
  magic
    ? `
/**
 * Email a one-time sign-in link. Answers the token only when emails are captured (tests); otherwise null, and the
 * caller always reports success so addresses cannot be probed.
 */
export async function issueMagicLink(rawEmail: string): Promise<{ token: string; url: string } | null> {
  const email = rawEmail.trim().toLowerCase();
  const user = await db.query.${table}.findFirst({ where: eq(identityTable.${auth.emailColumn}, email) });
  if (!user && !${auth.registerable}) return null;
  const token = randomBytes(32).toString("base64url");
  await db.insert(oslAuthTokens).values({
    token_hash: hash(token),
    email,
    purpose: "magic_link",
    expires_at: new Date(Date.now() + MAGIC_LINK_MINUTES * 60_000)
  });
  const url = APP_URL + "/login/verify?token=" + encodeURIComponent(token);
  await sendEmail({
    to: email,
    subject: "Your sign-in link",
    text: "Sign in with this link (valid for " + MAGIC_LINK_MINUTES + " minutes): " + url
  });
  return emailMode() === "capture" ? { token, url } : null;
}

${
  invites
    ? `/**
 * Take the token (once) and answer its user, creating the user when the model allows. The link has proven the
 * address, so the invites waiting for it are accepted.
 */
export async function verifyMagicLink(token: string): Promise<{ user: ${T}; accepted: Accepted[] }> {
  const [row] = await db.delete(oslAuthTokens).where(eq(oslAuthTokens.token_hash, hash(token))).returning();
  if (!row || row.purpose !== "magic_link" || row.expires_at.getTime() < Date.now()) fail(400, "invalid_token", "This link is invalid or has expired");
  const user = await findOrCreateByEmail(row.email);
  return { user, accepted: await acceptPending(user, row.email) };
}`
    : `/** Take the token (once) and answer its user, creating the user when the model allows. */
export async function verifyMagicLink(token: string): Promise<${T}> {
  const [row] = await db.delete(oslAuthTokens).where(eq(oslAuthTokens.token_hash, hash(token))).returning();
  if (!row || row.purpose !== "magic_link" || row.expires_at.getTime() < Date.now()) fail(400, "invalid_token", "This link is invalid or has expired");
  return findOrCreateByEmail(row.email);
}`
}
`
    : ""
}${
    oauth.length
      ? `
type ProviderConfig = (
  | { kind: "github"; authorize: string; token: string; scope: string; pkce: false }
  | { kind: "oidc"; issuer: string; scope: string; pkce: true }
) & { clientId: string; clientSecret: string };

export const OAUTH: Record<string, ProviderConfig> = {
${presets}
};

const discovered = new Map<string, Promise<{ authorization_endpoint: string; token_endpoint: string; userinfo_endpoint?: string }>>();
function discover(issuer: string) {
  let found = discovered.get(issuer);
  if (!found) {
    found = fetch(issuer.replace(/\\/$/, "") + "/.well-known/openid-configuration").then(async r => {
      if (!r.ok) throw new Error("OIDC discovery failed for " + issuer + ": " + r.status);
      return (await r.json()) as { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint?: string };
    });
    discovered.set(issuer, found);
  }
  return found;
}

function providerOrFail(name: string): ProviderConfig {
  const provider = OAUTH[name];
  if (!provider) fail(404, "not_found", "No such provider");
  if (!provider.clientId || !provider.clientSecret) fail(400, "provider_unconfigured", "Set OAUTH_" + name.toUpperCase().replace(/-/g, "_") + "_CLIENT_ID and _CLIENT_SECRET");
  return provider;
}

function redirectUri(name: string): string {
  return APP_URL + "/api/auth/oauth/" + name + "/callback";
}

/** Record the pending authorisation and answer the provider's URL to send the browser to. */
export async function oauthStart(name: string, redirectTo = "/"): Promise<string> {
  const provider = providerOrFail(name);
  const state = randomBytes(24).toString("base64url");
  const verifier = provider.pkce ? randomBytes(32).toString("base64url") : null;
  const nonce = provider.kind === "oidc" ? randomBytes(16).toString("base64url") : null;
  await db.insert(oslAuthStates).values({
    state_hash: hash(state),
    provider: name,
    code_verifier: verifier,
    nonce,
    redirect_to: redirectTo,
    expires_at: new Date(Date.now() + OAUTH_STATE_MINUTES * 60_000)
  });
  const params = new URLSearchParams({ client_id: provider.clientId, redirect_uri: redirectUri(name), scope: provider.scope, state, response_type: "code" });
  if (verifier) {
    params.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    params.set("code_challenge_method", "S256");
  }
  if (nonce) params.set("nonce", nonce);
  const endpoint = provider.kind === "oidc" ? (await discover(provider.issuer)).authorization_endpoint : provider.authorize;
  return endpoint + "?" + params.toString();
}

${
  invites
    ? `/**
 * Finish the authorisation: check the state, exchange the code, read the profile, find or create the user. The
 * provider has proven the address it answers, so the invites waiting for it are accepted, and the browser goes to
 * what was joined.
 */`
    : `/** Finish the authorisation: check the state, exchange the code, read the profile, find or create the user. */`
}
export async function oauthCallback(name: string, params: Record<string, string | undefined>): Promise<{ user: ${T}; redirectTo: string }> {
  const provider = providerOrFail(name);
  if (params.error) fail(400, "oauth_denied", params.error_description ?? params.error);
  if (!params.code || !params.state) fail(400, "oauth_invalid", "Missing code or state");
  const [pending] = await db
    .delete(oslAuthStates)
    .where(and(eq(oslAuthStates.state_hash, hash(params.state)), eq(oslAuthStates.provider, name), gt(oslAuthStates.expires_at, new Date())))
    .returning();
  if (!pending) fail(400, "oauth_invalid", "This sign-in attempt is unknown or has expired");

  const tokenEndpoint = provider.kind === "oidc" ? (await discover(provider.issuer)).token_endpoint : provider.token;
  const form = new URLSearchParams({ grant_type: "authorization_code", code: params.code, redirect_uri: redirectUri(name), client_id: provider.clientId, client_secret: provider.clientSecret });
  if (pending.code_verifier) form.set("code_verifier", pending.code_verifier);
  const tokenResponse = await fetch(tokenEndpoint, { method: "POST", headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }, body: form });
  if (!tokenResponse.ok) fail(400, "oauth_exchange_failed", "The provider refused the code");
  const tokens = (await tokenResponse.json()) as { access_token?: string; id_token?: string };
  if (!tokens.access_token) fail(400, "oauth_exchange_failed", "The provider sent no access token");

  const profile = await fetchProfile(provider, tokens, pending.nonce);
  const [linked] = await db
    .select()
    .from(oslAuthAccounts)
    .where(and(eq(oslAuthAccounts.provider, name), eq(oslAuthAccounts.provider_account_id, profile.id)));
  let user: ${T};
  if (linked) {
    const found = await db.query.${table}.findFirst({ where: eq(identityTable.${pk}, linked.user_id) });
    if (!found) fail(400, "oauth_invalid", "The linked account no longer exists");
    user = found;
  } else {
    if (!profile.email) fail(400, "oauth_no_email", "The provider shared no verified email address");
    user = await findOrCreateByEmail(profile.email, profile.name);
    await db.insert(oslAuthAccounts).values({ provider: name, provider_account_id: profile.id, user_id: user.${pk} });
  }
${
  invites
    ? `  const accepted = await acceptPending(user, profile.email);
  return { user, redirectTo: accepted.length ? acceptedPath(accepted[0]) : (pending.redirect_to ?? "/") };`
    : `  return { user, redirectTo: pending.redirect_to ?? "/" };`
}
}

async function fetchProfile(provider: ProviderConfig, tokens: { access_token?: string; id_token?: string }, nonce: string | null): Promise<{ id: string; email: string | null; name?: string }> {
  const bearer = { authorization: "Bearer " + tokens.access_token, accept: "application/json", "user-agent": "osl" };
  if (provider.kind === "github") {
    const user = (await (await fetch("https://api.github.com/user", { headers: bearer })).json()) as { id: number; email: string | null; name: string | null; login: string };
    let email = user.email;
    if (!email) {
      const emails = (await (await fetch("https://api.github.com/user/emails", { headers: bearer })).json()) as { email: string; primary: boolean; verified: boolean }[];
      email = emails.find(e => e.primary && e.verified)?.email ?? emails.find(e => e.verified)?.email ?? null;
    }
    return { id: String(user.id), email, name: user.name ?? user.login };
  }
  if (tokens.id_token) {
    const claims = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as { sub: string; email?: string; email_verified?: boolean; name?: string; nonce?: string };
    if (nonce && claims.nonce !== nonce) fail(400, "oauth_invalid", "The identity token does not match this sign-in");
    return { id: claims.sub, email: claims.email_verified === false ? null : (claims.email ?? null), name: claims.name };
  }
  const userinfo = (await discover(provider.issuer)).userinfo_endpoint;
  if (!userinfo) fail(400, "oauth_invalid", "The provider shared no identity");
  const info = (await (await fetch(userinfo, { headers: bearer })).json()) as { sub: string; email?: string; email_verified?: boolean; name?: string };
  return { id: info.sub, email: info.email_verified === false ? null : (info.email ?? null), name: info.name };
}
`
      : ""
  }${invites ? invitesSource(ir) : ""}`;
}
