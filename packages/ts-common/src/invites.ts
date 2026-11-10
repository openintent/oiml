import type { EntityIR, InviteIR, IR } from "@osl/core";
import { entityByName, q, tableExport, typeName } from "./conventions.js";
import type { ServerConventions } from "./server-conventions.js";

/** Whether the model declares invites (auth.invites) */
export function hasInvites(ir: IR): boolean {
  return Boolean(ir.auth?.invites?.length);
}

interface Plan {
  plan: InviteIR;
  invite: EntityIR;
  membership: EntityIR;
  parent: EntityIR;
  /** TeamInvite, teamInvites, teamMembers, teams */
  I: string;
  inv: string;
  mem: string;
  par: string;
  /** The role an invite gets when its body names none */
  roleDefault?: string;
  /** The membership's created events, dispatched when an invite becomes a membership */
  events: string[];
}

function plans(ir: IR): Plan[] {
  return (ir.auth?.invites ?? []).map(plan => {
    const invite = entityByName(ir, plan.entity);
    const membership = entityByName(ir, plan.membership);
    const parent = entityByName(ir, plan.parent);
    const role = plan.roleColumn ? invite.columns.find(c => c.name === plan.roleColumn) : undefined;
    return {
      plan,
      invite,
      membership,
      parent,
      I: typeName(invite),
      inv: tableExport(invite),
      mem: tableExport(membership),
      par: tableExport(parent),
      roleDefault: role?.default?.kind === "literal" ? String(role.default.value) : undefined,
      // One name per trigger: a trigger with two handlers is two events of one name, and a dispatch runs both
      events: [
        ...new Set(
          ir.events
            .filter(e => e.kind === "entity" && e.entity === membership.name && e.action === "created")
            .map(e => e.name)
        )
      ]
    };
  });
}

/** What generated/auth-providers.ts imports for its invite half, beyond what sign-in needs */
export function inviteImports(ir: IR, conv: ServerConventions): { schema: string[]; lines: string[] } {
  const all = plans(ir);
  const schema = new Set<string>();
  for (const p of all) {
    schema.add(p.inv).add(p.mem).add(p.par);
    schema.add(`type ${p.I}`).add(`type New${p.I}`);
    for (const fk of p.plan.tenantPath ?? []) schema.add(tableExport(entityByName(ir, fk.targetEntity)));
  }
  const presenters = [...new Set(all.filter(p => p.events.length).map(p => `present${typeName(p.membership)}`))];
  return {
    schema: [...schema],
    lines: [
      ...(presenters.length
        ? [`import { emit } from "./events";`, `import { ${presenters.join(", ")} } from "./present";`]
        : []),
      `import type { Session } from "${conv.authModule}";`
    ]
  };
}

/** The select that walks from an invite's parent to the tenant it belongs to */
function tenantFunction(ir: IR, p: Plan): string {
  const path = p.plan.tenantPath ?? [];
  if (!path.length) return "";
  const lines: string[] = [];
  path.forEach((fk, i) => {
    const source = i === 0 ? p.parent : entityByName(ir, path[i - 1].targetEntity);
    const key = i === 0 ? p.plan.parentKey : path[i - 1].targetColumn;
    const table = tableExport(source);
    const from = i === 0 ? "id" : `hop${i - 1}.next`;
    lines.push(
      `  const [hop${i}] = await db.select({ next: ${table}.${fk.column} }).from(${table}).where(eq(${table}.${key}, ${from}));`
    );
    if (i < path.length - 1) lines.push(`  if (hop${i}?.next == null) return null;`);
  });
  return `
/** The tenant a ${p.parent.name} belongs to */
async function tenantOf${typeName(p.parent)}(id: ${p.I}[${q(p.plan.parentColumn)}]): Promise<string | number | null> {
${lines.join("\n")}
  return hop${path.length - 1}?.next ?? null;
}
`;
}

function issueFunction(ir: IR, p: Plan): string {
  const auth = ir.auth!;
  const identity = entityByName(ir, auth.identity);
  const pk = identity.primaryKey[0];
  const { plan, I, inv, mem, par } = p;
  const role = plan.roleColumn;
  const picked = [plan.parentColumn, "email", ...(role ? [role] : [])].map(q).join(" | ");
  const granted = role ? `values.${role}${p.roleDefault ? ` ?? ${q(p.roleDefault)}` : ""}` : "";
  const ceiling =
    role && plan.roles?.length
      ? `
  // The ceiling: a member of the ${plan.parent} grants no role above the one they hold in it
  const [own] = await db
    .select({ role: ${mem}.${role} })
    .from(${mem})
    .where(and(eq(${mem}.${plan.parentColumn}, parentId), eq(${mem}.${plan.userColumn}, me)));
  const ranked = [${(plan.roles ?? []).map(q).join(", ")}];
  if (own && rankIn(ranked, ${granted}) < rankIn(ranked, own.role)) {
    fail(403, "forbidden", "An invite cannot grant a role above your own");
  }
`
      : "";
  return `
/**
 * Send an invite to a ${plan.parent}. \`before\` is the resource's beforeCreate hook, handed the row as it will be
 * stored. Then, in order: the role ceiling, 409 for an address already invited or already a member, the row with
 * the token's hash, the mail. The row is kept only if the mail was handed to the adapter. The token is answered
 * only when emails are captured (tests).
 */
export async function issue${I}(
  input: Pick<New${I}, ${picked}>,
  session: Session,
  before: (values: New${I}) => Promise<New${I}> = async values => values
): Promise<{ row: ${I}; debug?: { token: string; url: string } }> {
  const token = randomBytes(32).toString("base64url");
  const me = session.user.${pk};
  const draft = await before({
    ...input,
    email: input.email.trim().toLowerCase(),
    invited_by: me,
    token_hash: hash(token),
    expires_at: new Date(Date.now() + ${plan.expires} * 1000)
  });
  const values = { ...draft, email: draft.email.trim().toLowerCase(), invited_by: me, token_hash: hash(token) };
  const parentId = values.${plan.parentColumn};
${ceiling}
  const [waiting] = await db
    .select()
    .from(${inv})
    .where(and(eq(${inv}.${plan.parentColumn}, parentId), eq(${inv}.email, values.email)));
  if (waiting && waiting.expires_at.getTime() > Date.now()) fail(409, "invite_exists", "An invite to this address is already waiting");
  const [account] = await db.select({ id: identityTable.${pk} }).from(identityTable).where(eq(identityTable.${auth.emailColumn}, values.email));
  if (account) {
    const [member] = await db
      .select({ user: ${mem}.${plan.userColumn} })
      .from(${mem})
      .where(and(eq(${mem}.${plan.parentColumn}, parentId), eq(${mem}.${plan.userColumn}, account.id)));
    if (member) fail(409, "already_member", "This address already belongs to a member");
  }
  const [parent] = await db.select({ name: ${par}.${p.parent.display} }).from(${par}).where(eq(${par}.${plan.parentKey}, parentId));
  if (!parent) fail(400, "invalid_reference", "A referenced row does not exist");

  // A lapsed invite to the address gives way to the new one
  const row = await db.transaction(async tx => {
    if (waiting) await tx.delete(${inv}).where(eq(${inv}.id, waiting.id));
    const [made] = await tx.insert(${inv}).values(values).returning();
    return made;
  });
  const url = APP_URL + "/invite/" + encodeURIComponent(token);
  try {
    await sendEmail(
      inviteEmail({
        to: row.email,
        name: String(parent.name),
        inviter: String((session.user as Record<string, unknown>)[${q(identity.display)}] ?? ""),
        role: ${role ? `row.${role}` : "null"},
        url,
        expires: row.expires_at
      })
    );
  } catch (err) {
    await db.delete(${inv}).where(eq(${inv}.id, row.id));
    throw err;
  }
  return emailMode() === "capture" ? { row, debug: { token, url } } : { row };
}
`;
}

function acceptFunction(ir: IR, p: Plan): string {
  const identity = entityByName(ir, ir.auth!.identity);
  const pk = identity.primaryKey[0];
  const { plan, I, inv, mem } = p;
  const role = plan.roleColumn;
  const M = typeName(p.membership);
  const tenant =
    plan.tenantPath === undefined
      ? "null"
      : plan.tenantPath.length === 0
        ? `invite.${plan.parentColumn}`
        : `await tenantOf${typeName(p.parent)}(invite.${plan.parentColumn})`;
  const values = [
    `${plan.parentColumn}: invite.${plan.parentColumn}`,
    `${plan.userColumn}: user.${pk}`,
    ...(role ? [`${role}: invite.${role}`] : [])
  ].join(", ");
  const emits = p.events.map(name => `  if (made.member) await emit(${q(name)}, present${M}(made.member));`);
  return `${tenantFunction(ir, p)}
/**
 * Make the ${plan.membership} an invite stands for and use the invite up, in one transaction. A membership that
 * exists already is left as it is. Null when the invite was gone before this could take it.
 */
async function accept${I}(user: Invitee, invite: ${I}): Promise<Accepted | null> {
  const made = await db.transaction(async tx => {
    const [used] = await tx.delete(${inv}).where(eq(${inv}.id, invite.id)).returning({ id: ${inv}.id });
    if (!used) return null;
    const [member] = await tx.insert(${mem}).values({ ${values} }).onConflictDoNothing().returning();
    return { member };
  });
  if (!made) return null;
${emits.length ? emits.join("\n") + "\n" : ""}  return { entity: ${q(plan.parent)}, id: invite.${plan.parentColumn}, ${role ? `role: invite.${role} ?? undefined, ` : ""}tenant: ${tenant} };
}
`;
}

/**
 * The invite half of generated/auth-providers.ts: sending an invite, the lookup behind the landing page, and
 * acceptPending, the one place an invite becomes a membership. Written once for both TypeScript backends.
 */
export function invitesSource(ir: IR): string {
  const auth = ir.auth!;
  const identity = entityByName(ir, auth.identity);
  const T = typeName(identity);
  const pk = identity.primaryKey[0];
  const all = plans(ir);
  const ranked = all.some(p => p.plan.roleColumn && p.plan.roles?.length);

  const found = all.map(p => `  | { membership: ${q(p.plan.membership)}; row: ${p.I} }`).join("\n");
  const byToken = all
    .map(
      p => `  const [${lower(p.I)}] = await db.select().from(${p.inv}).where(eq(${p.inv}.token_hash, tokenHash));
  if (${lower(p.I)}) return { membership: ${q(p.plan.membership)}, row: ${lower(p.I)} };`
    )
    .join("\n");
  const describe = all
    .map(
      p => `    case ${q(p.plan.membership)}: {
      const [parent] = await db.select({ name: ${p.par}.${p.parent.display} }).from(${p.par}).where(eq(${p.par}.${p.plan.parentKey}, found.row.${p.plan.parentColumn}));
      return { entity: ${q(p.plan.parent)}, name: String(parent?.name ?? "")${p.plan.roleColumn ? `, role: found.row.${p.plan.roleColumn} ?? undefined` : ""} };
    }`
    )
    .join("\n");
  const sweep = all
    .map(
      p => `  for (const invite of await db.select().from(${p.inv}).where(and(eq(${p.inv}.email, email), gt(${p.inv}.expires_at, now)))) {
    const accepted = await accept${p.I}(user, invite);
    if (accepted) done.push({ accepted, first: invite.token_hash === first, at: invite.created_at.getTime() });
  }`
    )
    .join("\n");

  return `
// Invites. An invite is a row of an invite resource; its link carries a token the row keeps only the hash of.

/** What accepting an invite made: the row joined, the role given in it, and the tenant that row belongs to */
export type Accepted = { entity: string; id: string | number; role?: string; tenant: string | number | null };

/** What an invite shows whoever holds its link, before anyone has proven the address */
export type InviteLookup = {
  entity: string;
  name: string;
  role?: string;
  inviter: string;
  email: string;
  expires_at: string;
  account: boolean;
};

/** The part of a user the invite code reads */
type Invitee = Pick<${T}, ${q(pk)} | ${q(auth.emailColumn)}>;

type FoundInvite =
${found};
${
  ranked
    ? `
/** A role's place in a list from most to least privileged; a role outside it, or none, ranks last */
function rankIn(roles: string[], role: string | null | undefined): number {
  const index = role == null ? -1 : roles.indexOf(role);
  return index < 0 ? roles.length : index;
}
`
    : ""
}
/** Where the browser goes after a sign-in that accepted invites: the page that opens what was joined */
export function acceptedPath(first: Accepted): string {
  const params = new URLSearchParams({ entity: first.entity, id: String(first.id) });
  if (first.tenant !== null) params.set("tenant", String(first.tenant));
  return "/invite/accepted?" + params.toString();
}

function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 1 ? "•••" : email[0] + "•••" + email.slice(at);
}

/** The invite a token belongs to, lapsed or not */
async function inviteOf(token: string): Promise<FoundInvite | null> {
  const tokenHash = hash(token);
${byToken}
  return null;
}

/** The token's invite: 404 for a token that is unknown, used or revoked, 410 for one that has lapsed */
async function liveInvite(token: string): Promise<FoundInvite> {
  const found = await inviteOf(token);
  if (!found) fail(404, "not_found", "Not found");
  if (found.row.expires_at.getTime() <= Date.now()) fail(410, "invite_expired", "This invite has expired");
  return found;
}

async function parentOf(found: FoundInvite): Promise<{ entity: string; name: string; role?: string }> {
  switch (found.membership) {
${describe}
  }
}
${all.map(p => issueFunction(ir, p)).join("")}${all.map(p => acceptFunction(ir, p)).join("")}
/**
 * The one place an invite becomes a membership. It does nothing unless the proven email is the account's own; then
 * every live invite to that address is accepted, across all invited memberships. Answers what it accepted: the
 * invite whose token was used first, then the others, oldest first.
 */
export async function acceptPending(user: Invitee, provenEmail: string | null | undefined, usedToken?: string): Promise<Accepted[]> {
  const email = (provenEmail ?? "").trim().toLowerCase();
  if (!email || email !== String(user.${auth.emailColumn} ?? "").trim().toLowerCase()) return [];
  const now = new Date();
  const first = usedToken ? hash(usedToken) : null;
  const done: { accepted: Accepted; first: boolean; at: number }[] = [];
${sweep}
  done.sort((a, b) => Number(b.first) - Number(a.first) || a.at - b.at);
  return done.map(entry => entry.accepted);
}

/** A password proves nothing about a mailbox, so a password sign-in accepts only with a live token for its own address. */
export async function acceptWithToken(user: Invitee, token: string): Promise<Accepted[]> {
  const found = await inviteOf(token);
  if (!found || found.row.expires_at.getTime() <= Date.now()) return [];
  return acceptPending(user, found.row.email, token);
}

/** GET /api/auth/invites/{token}: what the landing page shows. It never accepts, because mail scanners open links. */
export async function lookupInvite(token: string): Promise<InviteLookup> {
  const found = await liveInvite(token);
  const [inviter] = await db.select({ name: identityTable.${identity.display} }).from(identityTable).where(eq(identityTable.${pk}, found.row.invited_by));
  const [account] = await db.select({ id: identityTable.${pk} }).from(identityTable).where(eq(identityTable.${auth.emailColumn}, found.row.email));
  return {
    ...(await parentOf(found)),
    inviter: String(inviter?.name ?? ""),
    email: maskEmail(found.row.email),
    expires_at: found.row.expires_at.toISOString(),
    account: Boolean(account)
  };
}

/**
 * POST /api/auth/invites/{token}/accept. A session under the invite's email accepts; one under another email is
 * refused, and nothing changes. Without a session the token never signs anyone into an account that exists: it
 * asks for a sign-in. Where the address has no account, \`create\` makes it (the token has proven the address), and
 * the caller signs it in.
 */
export async function acceptInvite(
  token: string,
  userId: ${T}[${q(pk)}] | null,
  create: (email: string) => Promise<${T}>
): Promise<{ accepted: Accepted[]; created: ${T} | null }> {
  const found = await liveInvite(token);
  const email = found.row.email;
  if (userId !== null) {
    const [me] = await db.select().from(identityTable).where(eq(identityTable.${pk}, userId));
    if (!me || String(me.${auth.emailColumn} ?? "").trim().toLowerCase() !== email) fail(403, "invite_email_mismatch", "This invite is for another address");
    return { accepted: await acceptPending(me, email, token), created: null };
  }
  const [account] = await db.select({ id: identityTable.${pk} }).from(identityTable).where(eq(identityTable.${auth.emailColumn}, email));
  if (account) fail(401, "sign_in_required", "Sign in to accept this invite");
  const created = await create(email);
  return { accepted: await acceptPending(created, email, token), created };
}
`;
}

function lower(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}
