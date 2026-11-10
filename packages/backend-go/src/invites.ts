import type { EntityIR, IR, InviteIR } from "@osl/core";
import { columnsConst, presentCall, presentFunc, publicType, scanFunc, takesViewer, tableConst } from "./models.js";
import {
  column,
  entityByName,
  eventIdent,
  exported,
  goStruct,
  isFile,
  q,
  quoteIdent,
  rowGoType,
  typeName
} from "./util.js";
import { fieldLiteral, objectLiteral } from "./validation.js";

/** Whether the model declares invites (auth.invites) */
export function hasInvites(ir: IR): boolean {
  return Boolean(ir.auth?.invites?.length);
}

interface Plan {
  plan: InviteIR;
  invite: EntityIR;
  membership: EntityIR;
  parent: EntityIR;
  /** TeamInvite */
  I: string;
  /** The role an invite gets when its body names none */
  roleDefault?: string;
}

function plans(ir: IR): Plan[] {
  return (ir.auth?.invites ?? []).map(plan => {
    const invite = entityByName(ir, plan.entity);
    const role = plan.roleColumn ? invite.columns.find(c => c.name === plan.roleColumn) : undefined;
    return {
      plan,
      invite,
      membership: entityByName(ir, plan.membership),
      parent: entityByName(ir, plan.parent),
      I: typeName(invite),
      roleDefault: role?.default?.kind === "literal" ? String(role.default.value) : undefined
    };
  });
}

/** The method on Auth that sends an invite of this invite entity: IssueTeamInvite */
export function issueFunc(invite: EntityIR): string {
  return `Issue${typeName(invite)}`;
}

/**
 * The invited memberships whose created events an accepted invite must run, each with its events named once. The
 * auth package cannot import the events package (events reach auth through actions), so it calls a variable per
 * membership that the app sets.
 */
export function inviteMemberEvents(ir: IR): { membership: EntityIR; hook: string; events: string[] }[] {
  const seen = new Set<string>();
  const out: { membership: EntityIR; hook: string; events: string[] }[] = [];
  for (const p of plans(ir)) {
    if (seen.has(p.membership.name)) continue;
    seen.add(p.membership.name);
    const events = [
      ...new Set(
        ir.events
          .filter(e => e.kind === "entity" && e.entity === p.membership.name && e.action === "created")
          .map(e => e.name)
      )
    ];
    if (events.length) out.push({ membership: p.membership, hook: `On${typeName(p.membership)}Created`, events });
  }
  return out;
}

/** The lines of app.New that hand the auth package the created events of invited memberships */
export function inviteEventWiring(ir: IR): string[] {
  return inviteMemberEvents(ir).map(({ membership, hook, events }) => {
    const calls = events.map(
      name => `\t\tif err := events.${eventIdent(name)}(ctx, member); err != nil {\n\t\t\treturn err\n\t\t}`
    );
    return `\tauth.${hook} = func(ctx context.Context, member models.${publicType(membership)}) error {\n${calls.join("\n")}\n\t\treturn nil\n\t}`;
  });
}

function lower(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

/** A struct literal's entries, two tabs deep, aligned as gofmt aligns them */
function literalEntries(entries: [string, string][]): string {
  const width = Math.max(...entries.map(([key]) => key.length)) + 1;
  return entries.map(([key, value]) => `\t\t${(key + ":").padEnd(width)} ${value},`).join("\n");
}

/** The query that walks from an invite's parent to the tenant it belongs to, as one method per parent */
function tenantFunction(ir: IR, p: Plan): string {
  const path = p.plan.tenantPath ?? [];
  if (!path.length) return "";
  const joins: string[] = [];
  let source = p.parent;
  path.forEach((fk, i) => {
    if (i === 0) return;
    const previous = path[i - 1];
    source = entityByName(ir, previous.targetEntity);
    joins.push(
      ` JOIN ${quoteIdent(source.table)} h${i} ON h${i}.${quoteIdent(previous.targetColumn)} = h${i - 1}.${quoteIdent(previous.column)}`
    );
  });
  const last = path[path.length - 1];
  const type = rowGoType(column(source, last.column));
  const nullable = type.startsWith("*");
  return `// tenantOf${typeName(p.parent)} is the tenant a ${p.parent.name} belongs to, or nil when it has none.
func (a *Auth) tenantOf${typeName(p.parent)}(ctx context.Context, id any) (any, error) {
	var tenant ${type}
	err := a.db.QueryRow(ctx, \`SELECT h${path.length - 1}.${quoteIdent(last.column)} FROM ${quoteIdent(p.parent.table)} h0${joins.join("")} WHERE h0.${quoteIdent(p.plan.parentKey)} = $1\`, id).Scan(&tenant)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
${nullable ? `\tif tenant == nil {\n\t\treturn nil, nil\n\t}\n\treturn *tenant, nil` : `\treturn tenant, nil`}
}`;
}

/**
 * generated/auth/providers.go, the invite half: sending an invite, the lookup behind the landing page, and
 * AcceptPending, the one place an invite becomes a membership. It mirrors generated/auth-providers.ts of the
 * TypeScript backends reply for reply.
 */
export function inviteSections(ir: IR, modulePath: string, imports: Set<string>): string[] {
  const auth = ir.auth!;
  const identity = entityByName(ir, auth.identity);
  const T = typeName(identity);
  const pk = column(identity, identity.primaryKey[0]);
  const pkField = exported(pk.name);
  const pkIdent = quoteIdent(pk.name);
  const emailColumn = column(identity, auth.emailColumn);
  const emailIdent = quoteIdent(auth.emailColumn);
  const credentials = auth.providers.some(p => p.kind === "credentials");
  const others = auth.providers.some(p => p.kind !== "credentials");
  const oauth = auth.providers.some(p => p.kind === "oauth");
  const registerFiles = auth.registerFields.map(name => column(identity, name)).filter(isFile);
  const userTable = `models.${tableConst(identity)}`;
  const userColumns = `models.${columnsConst(identity)}`;
  const scanUser = `models.${scanFunc(identity)}`;
  const presentUser = `models.${presentFunc(identity)}`;
  const all = plans(ir);
  const ranked = all.some(p => p.plan.roleColumn && p.plan.roles?.length);
  const hooks = new Map(inviteMemberEvents(ir).map(e => [e.membership.name, e.hook]));

  for (const spec of [
    "context",
    "encoding/json",
    "net/url",
    "sort",
    "strings",
    `${modulePath}/generated/db`,
    `${modulePath}/generated/email`,
    `${modulePath}/generated/validation`
  ])
    imports.add(spec);
  if (oauth) imports.add("fmt");
  if (registerFiles.length) imports.add(`${modulePath}/generated/files`);

  /** The lower-cased address of a user row */
  const addressOf = (user: string) =>
    rowGoType(emailColumn) === "string"
      ? `inviteAddress(${user}.${exported(emailColumn.name)})`
      : `inviteAddress(inviteText(${user}.${exported(emailColumn.name)}))`;
  /** The role of an invite row as text */
  const roleOf = (p: Plan, row: string) => {
    const field = `${row}.${exported(p.plan.roleColumn!)}`;
    return rowGoType(column(p.invite, p.plan.roleColumn!)) === "string" ? field : `inviteText(${field})`;
  };

  const sections: string[] = [];

  sections.push(`// Invites. An invite is a row of an invite resource; its link carries a token the row keeps only the hash of.

${goStruct(
  "Accepted",
  [
    { name: "Entity", type: "string", tag: '`json:"entity"`' },
    { name: "ID", type: "any", tag: '`json:"id"`' },
    { name: "Role", type: "string", tag: '`json:"role,omitempty"`' },
    { name: "Tenant", type: "any", tag: '`json:"tenant"`' }
  ],
  "Accepted is what accepting an invite made: the row joined, the role given in it, and the tenant that row belongs to."
)}

${goStruct(
  "InviteDebug",
  [
    { name: "Token", type: "string", tag: '`json:"token"`' },
    { name: "URL", type: "string", tag: '`json:"url"`' }
  ],
  "InviteDebug is an invite's token and link, answered beside the row only when emails are captured (tests)."
)}

${goStruct(
  "Issued",
  [
    { name: "Data", type: "any", tag: '`json:"data"`' },
    { name: "Debug", type: "*InviteDebug", tag: '`json:"debug,omitempty"`' }
  ],
  "Issued is the reply of an invite's create: the row, and the token when emails are captured."
)}

${goStruct(
  "signedIn",
  [
    { name: "Data", type: "any", tag: '`json:"data"`' },
    { name: "Accepted", type: "[]Accepted", tag: '`json:"accepted"`' }
  ],
  "signedIn is a sign-in reply that accepted invites: the user, and what was joined."
)}

${goStruct(
  "inviteLookup",
  [
    { name: "Entity", type: "string", tag: '`json:"entity"`' },
    { name: "Name", type: "string", tag: '`json:"name"`' },
    { name: "Role", type: "string", tag: '`json:"role,omitempty"`' },
    { name: "Inviter", type: "string", tag: '`json:"inviter"`' },
    { name: "Email", type: "string", tag: '`json:"email"`' },
    { name: "ExpiresAt", type: "string", tag: '`json:"expires_at"`' },
    { name: "Account", type: "bool", tag: '`json:"account"`' }
  ],
  "inviteLookup is what an invite shows whoever holds its link, before anyone has proven the address."
)}

${goStruct(
  "pendingInvite",
  [
    { name: "row", type: "any" },
    { name: "entity", type: "string" },
    { name: "parent", type: "any" },
    { name: "role", type: "string" },
    { name: "email", type: "string" },
    { name: "tokenHash", type: "string" },
    { name: "invitedBy", type: "any" },
    { name: "expiresAt", type: "time.Time" },
    { name: "createdAt", type: "time.Time" },
    { name: "nameQuery", type: "string" }
  ],
  "pendingInvite is an invite of any invited membership, as the token routes and AcceptPending read it."
)}

// inviterNameQuery reads the name of whoever sent an invite.
const inviterNameQuery = \`SELECT COALESCE(${quoteIdent(identity.display)}::text, '') FROM ${quoteIdent(identity.table)} WHERE ${pkIdent} = $1\`

// inviteText is a column's text: a string, or "" for a null.
func inviteText(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case *string:
		if v != nil {
			return *v
		}
	}
	return ""
}

// inviteAddress is an email address as invites compare it: trimmed and in lower case.
func inviteAddress(address string) string {
	return strings.ToLower(strings.TrimSpace(address))
}
${
  ranked
    ? `
// rankIn is a role's place in a list from most to least privileged; a role outside it, or none, ranks last.
func rankIn(roles []string, role string) int {
	for i, r := range roles {
		if r == role {
			return i
		}
	}
	return len(roles)
}
`
    : ""
}${
    oauth
      ? `
// acceptedPath is where the browser goes after a sign-in that accepted invites: the page that opens what was joined.
func acceptedPath(first Accepted) string {
	query := url.Values{}
	query.Set("entity", first.Entity)
	query.Set("id", fmt.Sprint(first.ID))
	if first.Tenant != nil {
		query.Set("tenant", fmt.Sprint(first.Tenant))
	}
	return "/invite/accepted?" + query.Encode()
}
`
      : ""
  }
// maskEmail keeps the first letter of an address and its domain.
func maskEmail(address string) string {
	at := strings.LastIndex(address, "@")
	if at < 1 {
		return "•••"
	}
	return string([]rune(address)[:1]) + "•••" + address[at:]
}

// nameOf reads one text column of one row: the name a mail or a landing page shows. False when the row is gone.
func (a *Auth) nameOf(ctx context.Context, query string, id any) (string, bool, error) {
	var name string
	err := a.db.QueryRow(ctx, query, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return name, true, nil
}

// hasAccount is whether a ${T} holds this address.
func (a *Auth) hasAccount(ctx context.Context, address string) (bool, error) {
	var exists bool
	err := a.db.QueryRow(ctx, \`SELECT EXISTS (SELECT 1 FROM \`+${userTable}+\` WHERE ${emailIdent} = $1)\`, address).Scan(&exists)
	return exists, err
}`);

  // The created events of invited memberships, reached through variables the app sets
  for (const { membership, hook } of inviteMemberEvents(ir)) {
    sections.push(`// ${hook} runs the created events of a ${membership.name} that an accepted invite made. The app sets it:
// this package cannot import the events it would call.
var ${hook} func(ctx context.Context, member models.${publicType(membership)}) error`);
  }

  if (all.some(p => p.plan.isolation))
    sections.push(`// Under isolation: database an invite is a row of the tenant it leads into, which its invitee does not belong to
// yet. Whoever holds a token may read its invite: a function that sees past the policy answers the tenant of the
// invite holding the token's hash, and the request binds it before reading the invite.
func (a *Auth) bindByToken(ctx context.Context, probe string, tokenHash string) error {
	var tenant *string
	if err := a.db.QueryRow(ctx, \`SELECT \`+db.Quote(probe)+\`($1)::text\`, tokenHash).Scan(&tenant); err != nil {
		return err
	}
	if tenant != nil {
		db.BindTenant(ctx, *tenant)
	}
	return nil
}

// bindByEmail binds, once an address is proven, the tenants of the invites to it live at now, so that they can be
// accepted.
func (a *Auth) bindByEmail(ctx context.Context, probe string, address string, now time.Time) error {
	rows, err := a.db.Query(ctx, \`SELECT tenant::text FROM \`+db.Quote(probe)+\`($1, $2) AS tenant\`, address, now)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var tenant string
		if err := rows.Scan(&tenant); err != nil {
			return err
		}
		db.BindTenant(ctx, tenant)
	}
	return rows.Err()
}`);

  const tenants = new Set<string>();
  for (const p of all) {
    const { plan, invite, membership, parent, I } = p;
    const inviteTable = `models.${tableConst(invite)}`;
    const inviteColumns = `models.${columnsConst(invite)}`;
    const scanInvite = `models.${scanFunc(invite)}`;
    const memberTable = `models.${tableConst(membership)}`;
    const parentField = exported(plan.parentColumn);
    const parentIdent = quoteIdent(plan.parentColumn);
    const userIdent = quoteIdent(plan.userColumn);
    const role = plan.roleColumn;
    const nameQuery = `${lower(I)}NameQuery`;

    sections.push(`// ${nameQuery} reads the name an invite to a ${plan.parent} shows.
const ${nameQuery} = \`SELECT COALESCE(${quoteIdent(parent.display)}::text, '') FROM ${quoteIdent(parent.table)} WHERE ${quoteIdent(plan.parentKey)} = $1\`

// pending${I} is a ${I} as the token routes and AcceptPending read it.
func pending${I}(row *models.${I}) *pendingInvite {
	return &pendingInvite{
${literalEntries([
  ["row", "row"],
  ["entity", q(plan.parent)],
  ["parent", `row.${parentField}`],
  ...(role ? ([["role", roleOf(p, "row")]] as [string, string][]) : []),
  ["email", "row.Email"],
  ["tokenHash", "row.TokenHash"],
  ["invitedBy", "row.InvitedBy"],
  ["expiresAt", "row.ExpiresAt"],
  ["createdAt", "row.CreatedAt"],
  ["nameQuery", nameQuery]
])}
	}
}

// sweep${I} lists the live invites of this kind to an address.
func (a *Auth) sweep${I}(ctx context.Context, address string, now time.Time) ([]*pendingInvite, error) {
${plan.isolation ? `\tif err := a.bindByEmail(ctx, ${q(plan.isolation.byEmail)}, address, now); err != nil {\n\t\treturn nil, err\n\t}\n` : ""}	rows, err := a.db.Query(ctx, \`SELECT \`+${inviteColumns}+\` FROM \`+${inviteTable}+\` WHERE "email" = $1 AND "expires_at" > $2\`, address, now)
	if err != nil {
		return nil, err
	}
	invites, err := models.Collect(rows, ${scanInvite})
	if err != nil {
		return nil, err
	}
	found := make([]*pendingInvite, 0, len(invites))
	for _, invite := range invites {
		found = append(found, pending${I}(invite))
	}
	return found, nil
}`);

    const ceiling =
      role && plan.roles?.length
        ? `	// The ceiling: a member of the ${plan.parent} grants no role above the one they hold in it
	var own string
	err = a.db.QueryRow(ctx, \`SELECT COALESCE(${quoteIdent(role)}::text, '') FROM \`+${memberTable}+\` WHERE ${parentIdent} = $1 AND ${userIdent} = $2\`, parent, me).Scan(&own)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}
	if err == nil {
		granted := inviteText(values[${q(role)}])
${p.roleDefault ? `\t\tif granted == "" {\n\t\t\tgranted = ${q(p.roleDefault)}\n\t\t}\n` : ""}		ranked := []string{${plan.roles.map(q).join(", ")}}
		if rankIn(ranked, granted) < rankIn(ranked, own) {
			return nil, nil, httpx.NewError(http.StatusForbidden, "forbidden", "An invite cannot grant a role above your own")
		}
	}
`
        : "";
    const parentName = `	name, found, err := a.nameOf(ctx, ${nameQuery}, parent)
	if err != nil {
		return nil, nil, err
	}
	if !found {
		return nil, nil, httpx.NewError(http.StatusBadRequest, "invalid_reference", "A referenced row does not exist")
	}
`;
    sections.push(`// ${issueFunc(invite)} sends an invite to a ${plan.parent}. before is the resource's BeforeCreate hook, handed the row as it
// will be stored. Then, in order: the role ceiling, 409 for an address already invited or already a member, the
// row with the token's hash, the mail. The row is kept only if the mail was handed to the adapter. The token is
// answered only when emails are captured (tests).
func (a *Auth) ${issueFunc(invite)}(ctx context.Context, session *Session, input models.Values, before func(models.Values) (models.Values, error)) (*models.${I}, *InviteDebug, error) {
	token := randomToken(32)
	me := session.User.${pkField}
	draft := models.Values{}
	for key, value := range input {
		draft[key] = value
	}
	draft["email"] = inviteAddress(inviteText(draft["email"]))
	draft["invited_by"] = me
	draft["token_hash"] = hashToken(token)
	draft["expires_at"] = time.Now().Add(${plan.expires} * time.Second)
	values, err := before(draft)
	if err != nil {
		return nil, nil, err
	}
	values["email"] = inviteAddress(inviteText(values["email"]))
	values["invited_by"] = me
	values["token_hash"] = hashToken(token)
	parent := values[${q(plan.parentColumn)}]
${ceiling}	waiting, err := ${scanInvite}(a.db.QueryRow(ctx, \`SELECT \`+${inviteColumns}+\` FROM \`+${inviteTable}+\` WHERE ${parentIdent} = $1 AND "email" = $2\`, parent, values["email"]))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}
	if waiting != nil && waiting.ExpiresAt.After(time.Now()) {
		return nil, nil, httpx.NewError(http.StatusConflict, "invite_exists", "An invite to this address is already waiting")
	}
	var member bool
	err = a.db.QueryRow(ctx, \`SELECT EXISTS (SELECT 1 FROM \`+${memberTable}+\` m JOIN \`+${userTable}+\` u ON u.${pkIdent} = m.${userIdent} WHERE m.${parentIdent} = $1 AND u.${emailIdent} = $2)\`, parent, values["email"]).Scan(&member)
	if err != nil {
		return nil, nil, err
	}
	if member {
		return nil, nil, httpx.NewError(http.StatusConflict, "already_member", "This address already belongs to a member")
	}
${plan.isolation ? "" : parentName}	inviter, _, err := a.nameOf(ctx, inviterNameQuery, me)
	if err != nil {
		return nil, nil, err
	}

	// A lapsed invite to the address gives way to the new one
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	if waiting != nil {
		if _, err := tx.Exec(ctx, \`DELETE FROM \`+${inviteTable}+\` WHERE "id" = $1\`, waiting.ID); err != nil {
			return nil, nil, err
		}
	}
	sql, args := db.Insert(${inviteTable}, values, ${inviteColumns})
	row, err := ${scanInvite}(tx.QueryRow(ctx, sql, args...))
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
${
  plan.isolation
    ? `	// Under isolation: database the insert, under the policy, is what refuses another tenant's ${plan.parent}; the
	// name is read once it has gone through
${parentName}`
    : ""
}	link := AppURL() + "/invite/" + url.PathEscape(token)
	if err := email.Send(ctx, email.Invite(row.Email, name, inviter, ${role ? roleOf(p, "row") : `""`}, link, row.ExpiresAt)); err != nil {
		if _, gone := a.db.Exec(ctx, \`DELETE FROM \`+${inviteTable}+\` WHERE "id" = $1\`, row.ID); gone != nil {
			return nil, nil, gone
		}
		return nil, nil, err
	}
	if email.CurrentMode() != email.ModeCapture {
		return row, nil, nil
	}
	return row, &InviteDebug{Token: token, URL: link}, nil
}`);

    if (plan.tenantPath?.length && !tenants.has(parent.name)) {
      tenants.add(parent.name);
      sections.push(tenantFunction(ir, p));
    }

    const hook = hooks.get(membership.name);
    const memberColumns = [plan.parentColumn, plan.userColumn, ...(role ? [role] : [])];
    const memberArgs = [`invite.${parentField}`, `user.${pkField}`, ...(role ? [`invite.${exported(role)}`] : [])];
    const insertSql = `INSERT INTO \`+${memberTable}+\` (${memberColumns.map(quoteIdent).join(", ")}) VALUES (${memberColumns.map((_, i) => `$${i + 1}`).join(", ")}) ON CONFLICT DO NOTHING`;
    const insert = hook
      ? `	member, err := models.${scanFunc(membership)}(tx.QueryRow(ctx, \`${insertSql} RETURNING \`+models.${columnsConst(membership)}, ${memberArgs.join(", ")}))
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	if member != nil && ${hook} != nil {
		if err := ${hook}(ctx, ${presentCall(membership, "member", "models.Server")}); err != nil {
			return nil, err
		}
	}`
      : `	if _, err := tx.Exec(ctx, \`${insertSql}\`, ${memberArgs.join(", ")}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}`;
    const acceptedFields = (tenant: string) =>
      `Entity: ${q(plan.parent)}, ID: invite.${parentField}, ${role ? `Role: ${roleOf(p, "invite")}, ` : ""}Tenant: ${tenant}`;
    const answer =
      plan.tenantPath === undefined
        ? `	return &Accepted{${acceptedFields("nil")}}, nil`
        : plan.tenantPath.length === 0
          ? `	return &Accepted{${acceptedFields(`invite.${parentField}`)}}, nil`
          : `	tenant, err := a.tenantOf${typeName(parent)}(ctx, invite.${parentField})
	if err != nil {
		return nil, err
	}
	return &Accepted{${acceptedFields("tenant")}}, nil`;
    sections.push(`// accept${I} makes the ${plan.membership} an invite stands for and uses the invite up, in one transaction. A membership
// that exists already is left as it is. Nil when the invite was gone before this could take it.
func (a *Auth) accept${I}(ctx context.Context, user *models.${T}, invite *models.${I}) (*Accepted, error) {
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	used, err := tx.Exec(ctx, \`DELETE FROM \`+${inviteTable}+\` WHERE "id" = $1\`, invite.ID)
	if err != nil {
		return nil, err
	}
	if used.RowsAffected() == 0 {
		return nil, nil
	}
${insert}
${answer}
}`);
  }

  const byToken = all
    .map(
      p => `${p.plan.isolation ? `\tif err := a.bindByToken(ctx, ${q(p.plan.isolation.byToken)}, tokenHash); err != nil {\n\t\treturn nil, err\n\t}\n` : ""}	if row, err := models.${scanFunc(p.invite)}(a.db.QueryRow(ctx, \`SELECT \`+models.${columnsConst(p.invite)}+\` FROM \`+models.${tableConst(p.invite)}+\` WHERE "token_hash" = $1\`, tokenHash)); err == nil {
		return pending${p.I}(row), nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}`
    )
    .join("\n");
  const acceptCases = all.map(p => `	case *models.${p.I}:\n\t\treturn a.accept${p.I}(ctx, user, row)`).join("\n");

  sections.push(`// inviteOf is the invite a token belongs to, lapsed or not. Nil when there is none.
func (a *Auth) inviteOf(ctx context.Context, token string) (*pendingInvite, error) {
	tokenHash := hashToken(token)
${byToken}
	return nil, nil
}

// liveInvite is the token's invite: 404 for a token that is unknown, used or revoked, 410 for one that has lapsed.
func (a *Auth) liveInvite(ctx context.Context, token string) (*pendingInvite, error) {
	found, err := a.inviteOf(ctx, token)
	if err != nil {
		return nil, err
	}
	if found == nil {
		return nil, httpx.NotFound()
	}
	if !found.expiresAt.After(time.Now()) {
		return nil, httpx.NewError(http.StatusGone, "invite_expired", "This invite has expired")
	}
	return found, nil
}

// acceptFound accepts one invite, whichever membership it stands for.
func (a *Auth) acceptFound(ctx context.Context, user *models.${T}, found *pendingInvite) (*Accepted, error) {
	switch row := found.row.(type) {
${acceptCases}
	}
	return nil, nil
}

// AcceptPending is the one place an invite becomes a membership. It does nothing unless the proven email is the
// account's own; then every live invite to that address is accepted, across all invited memberships. It answers
// what it accepted: the invite whose token was used first, then the others, oldest first.
func (a *Auth) AcceptPending(ctx context.Context, user *models.${T}, provenEmail string, usedToken string) ([]Accepted, error) {
	accepted := []Accepted{}
	address := inviteAddress(provenEmail)
	if address == "" || address != ${addressOf("user")} {
		return accepted, nil
	}
	now := time.Now()
	first := ""
	if usedToken != "" {
		first = hashToken(usedToken)
	}
	var live []*pendingInvite
	for _, sweep := range []func(context.Context, string, time.Time) ([]*pendingInvite, error){${all.map(p => `a.sweep${p.I}`).join(", ")}} {
		found, err := sweep(ctx, address, now)
		if err != nil {
			return nil, err
		}
		live = append(live, found...)
	}
	sort.SliceStable(live, func(i, j int) bool {
		if (live[i].tokenHash == first) != (live[j].tokenHash == first) {
			return live[i].tokenHash == first
		}
		return live[i].createdAt.Before(live[j].createdAt)
	})
	for _, invite := range live {
		made, err := a.acceptFound(ctx, user, invite)
		if err != nil {
			return nil, err
		}
		if made != nil {
			accepted = append(accepted, *made)
		}
	}
	return accepted, nil
}`);

  if (credentials) {
    sections.push(`// acceptWithToken accepts for a password sign-in. A password proves nothing about a mailbox, so it accepts only
// with a live token for the account's own address.
func (a *Auth) acceptWithToken(ctx context.Context, user *models.${T}, token string) ([]Accepted, error) {
	found, err := a.inviteOf(ctx, token)
	if err != nil {
		return nil, err
	}
	if found == nil || !found.expiresAt.After(time.Now()) {
		return []Accepted{}, nil
	}
	return a.AcceptPending(ctx, user, found.email, token)
}`);
  }

  const acceptFields = [
    ...(credentials
      ? [`{Name: "password", ${others ? "" : "Required: true, "}Type: validation.String{MinLength: 8, MaxLength: 200}}`]
      : []),
    ...auth.registerFields.map(name => fieldLiteral(ir, column(identity, name), "create"))
  ];
  const resolveFiles = registerFiles.length
    ? `	if err := files.ResolveRefs(ctx, a.db, values, registerFileFields); err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
`
    : "";
  const password = !credentials
    ? ""
    : others
      ? `	if password, ok := values["password"].(string); ok && password != "" {
		hash, err := HashPassword(password)
		if err != nil {
			httpx.HandleError(c, err, "write")
			return
		}
		values[${q(auth.passwordColumn)}] = hash
	}
	delete(values, "password")
`
      : `	hash, err := HashPassword(values["password"].(string))
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	delete(values, "password")
	values[${q(auth.passwordColumn)}] = hash
`;

  sections.push(`var inviteAcceptInput = ${objectLiteral(acceptFields)}

// Invite handles GET /api/auth/invites/{token}: what an invite offers, for its landing page. It never accepts:
// mail scanners open links.
func (a *Auth) Invite(c *gin.Context) {
	ctx := c.Request.Context()
	found, err := a.liveInvite(ctx, c.Param("token"))
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	name, _, err := a.nameOf(ctx, found.nameQuery, found.parent)
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	inviter, _, err := a.nameOf(ctx, inviterNameQuery, found.invitedBy)
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	account, err := a.hasAccount(ctx, found.email)
	if err != nil {
		httpx.HandleError(c, err, "read")
		return
	}
	httpx.OK(c, inviteLookup{
		Entity:    found.entity,
		Name:      name,
		Role:      found.role,
		Inviter:   inviter,
		Email:     maskEmail(found.email),
		ExpiresAt: models.FormatDateTime(found.expiresAt),
		Account:   account,
	})
}

// InviteAccept handles POST /api/auth/invites/{token}/accept. A session under the invite's email accepts; one
// under another email is refused, and nothing changes. Without a session the token never signs anyone into an
// account that exists: it asks for a sign-in. Where the address has no account, the body creates it (the token
// has proven the address), and the reply signs it in.
func (a *Auth) InviteAccept(c *gin.Context) {
	ctx := c.Request.Context()
	token := c.Param("token")
	session, err := a.Session(c)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	found, err := a.liveInvite(ctx, token)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	if session != nil {
		me, err := ${scanUser}(a.db.QueryRow(ctx, \`SELECT \`+${userColumns}+\` FROM \`+${userTable}+\` WHERE ${pkIdent} = $1\`, session.User.${pkField}))
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			httpx.HandleError(c, err, "write")
			return
		}
		if err != nil || ${addressOf("me")} != found.email {
			httpx.Fail(c, httpx.NewError(http.StatusForbidden, "invite_email_mismatch", "This invite is for another address"))
			return
		}
		accepted, err := a.AcceptPending(ctx, me, found.email, token)
		if err != nil {
			httpx.HandleError(c, err, "write")
			return
		}
		httpx.JSON(c, http.StatusOK, signedIn{Data: ${takesViewer(identity) ? `${presentUser}(session.row, a.see.Viewer(session))` : "session.User"}, Accepted: accepted})
		return
	}
	account, err := a.hasAccount(ctx, found.email)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	if account {
		httpx.Fail(c, httpx.NewError(http.StatusUnauthorized, "sign_in_required", "Sign in to accept this invite"))
		return
	}
	// A missing or unreadable body counts as an empty one: an account that needs no fields is made without one
	body, perr := httpx.ParseBody(c)
	if perr != nil && perr.Code == "invalid_json" {
		body, perr = map[string]json.RawMessage{}, nil
	}
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
	values, perr := inviteAcceptInput.Parse(body)
	if perr != nil {
		httpx.Fail(c, perr)
		return
	}
${resolveFiles}${password}	values[${q(auth.emailColumn)}] = found.email
	sql, args := db.Insert(${userTable}, values, ${userColumns})
	created, err := ${scanUser}(a.db.QueryRow(ctx, sql, args...))
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	accepted, err := a.AcceptPending(ctx, created, found.email, token)
	if err != nil {
		httpx.HandleError(c, err, "write")
		return
	}
	signIn(c, created)
${
  takesViewer(identity)
    ? `\tshown, ok := a.shown(c, created)\n\tif !ok {\n\t\treturn\n\t}\n\thttpx.JSON(c, http.StatusCreated, signedIn{Data: shown, Accepted: accepted})`
    : `\thttpx.JSON(c, http.StatusCreated, signedIn{Data: ${presentUser}(created), Accepted: accepted})`
}
}`);

  return sections;
}
