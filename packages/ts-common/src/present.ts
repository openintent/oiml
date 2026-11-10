import type { EntityIR, IR } from "@osl/core";
import { hasFieldRules, ruledColumns } from "@osl/core";
import { ruleLiteral } from "./access.js";
import { isolationOf } from "./isolation.js";
import { isBytes, q, typeName, type TsConventions } from "./conventions.js";

/** Where the generated access and auth modules sit, as present.ts imports them */
export interface PresentModules {
  access: string;
  auth: string;
}

/** Whether an entity's presenter takes the viewer: it has a field with a read rule */
export function takesViewer(entity: EntityIR): boolean {
  return ruledColumns(entity).length > 0;
}

/** `presentPost(expr)`, with the viewer when the entity has a field with a read rule */
export function presentCall(entity: EntityIR, expr: string, viewer: string): string {
  return takesViewer(entity) ? `present${typeName(entity)}(${expr}, ${viewer})` : `present${typeName(entity)}(${expr})`;
}

/** The callback a `.map` over rows of the entity takes: the presenter itself, or a closure handing it the viewer */
export function presentMapper(entity: EntityIR, viewer: string): string {
  return takesViewer(entity) ? `item => present${typeName(entity)}(item, ${viewer})` : `present${typeName(entity)}`;
}

/**
 * The session a new tenant's creator is presented its row with: the request's session was read before the
 * membership existed, and a field rule on the tenant (`member:id:admin`) must see the creator's role.
 */
export function creatorViewer(ir: IR, session: string, tenantId: string): string {
  const role = ir.auth!.tenancy!.creatorRole;
  return `{ ...${session}!, memberships: [...${session}!.memberships, { tenant: ${tenantId}, role: ${q(role)} }] }`;
}

/** generated/present.ts: public shapes of every entity, hidden columns removed, file snapshots given their URL. */
export function presentFile(ir: IR, conv: TsConventions, modules?: PresentModules): string {
  const ruled = hasFieldRules(ir);
  // A sealed column that is not hidden always has a read rule, so the entity's presenter takes the viewer
  const sealed = ir.entities.some(e => ruledColumns(e).some(c => c.sealed));
  if (ruled && !modules) throw new Error("presentFile needs the access and auth modules when a field has a read rule");
  // Under isolation: database a test hook switches the rule checks off; a field rule has no policy behind it and stays on
  const check = isolationOf(ir) ? "judge" : "verdict";
  const out: string[] = [
    conv.header(
      ruled
        ? "Public shapes of each entity. Hidden columns never leave the server; a field with a read rule leaves it only for a viewer the rule allows."
        : "Public shapes of each entity. Hidden columns never leave the server."
    ),
    `import type * as schema from "./db/schema";`,
    ...(ir.files ? [`import { presentFileRef, type PublicFile } from "./files";`] : []),
    ...(sealed ? [`import { unseal } from "./seal";`] : []),
    ...(ruled
      ? [
          `import { memberTenantIds, ${check}, type Rule } from ${q(modules!.access)};`,
          `import type { Session } from ${q(modules!.auth)};`
        ]
      : []),
    ""
  ];
  if (ruled) out.push(viewerSource(ir, check), "");
  for (const entity of ir.entities) {
    const fields = entity.columns.filter(c => !c.hidden && !isBytes(c));
    const always = fields.filter(c => !c.read);
    const plain = always.filter(c => c.type.kind !== "file");
    const files = always.filter(c => c.type.kind === "file");
    const T = typeName(entity);
    const picked = `Pick<schema.${T}, ${plain.map(c => q(c.name)).join(" | ") || "never"}>`;
    const fileShape = files.length
      ? ` & { ${files.map(c => `${c.name}: PublicFile${c.nullable ? " | null" : ""}`).join("; ")} }`
      : "";
    const parts = [
      ...plain.map(c => `${c.name}: row.${c.name}`),
      ...files.map(c =>
        c.nullable ? `${c.name}: presentFileRef(row.${c.name})` : `${c.name}: presentFileRef(row.${c.name})!`
      )
    ];
    const some = fields.filter(c => c.read);
    if (!some.length) {
      out.push(`export type Public${T} = ${picked}${fileShape};`);
      out.push(`export function present${T}(row: schema.${T}): Public${T} {`);
      out.push(`  return { ${parts.join(", ")} };`);
      out.push(`}`, "");
      continue;
    }
    // Fields with a read rule: optional in the shape, set only for a viewer the rule allows on this row
    const somePlain = some.filter(c => c.type.kind !== "file" && !c.sealed);
    const someFiles = some.filter(c => c.type.kind === "file");
    // A sealed field is the string that was written, not the bytes the row holds
    const someSealed = some.filter(c => c.sealed);
    const optional = [
      ...(somePlain.length ? [` & Partial<Pick<schema.${T}, ${somePlain.map(c => q(c.name)).join(" | ")}>>`] : []),
      ...(someSealed.length
        ? [` & { ${someSealed.map(c => `${c.name}?: string${c.nullable ? " | null" : ""}`).join("; ")} }`]
        : []),
      ...(someFiles.length
        ? [` & { ${someFiles.map(c => `${c.name}?: PublicFile${c.nullable ? " | null" : ""}`).join("; ")} }`]
        : [])
    ].join("");
    out.push(`export type Public${T} = ${picked}${fileShape}${optional};`);
    out.push(`export function present${T}(row: schema.${T}, viewer: Viewer): Public${T} {`);
    out.push(`  const out: Public${T} = { ${parts.join(", ")} };`);
    for (const c of some) {
      if (c.sealed) {
        // Opened here and nowhere else, and only once the rule has allowed this viewer; never for the server itself
        const opened = `unseal(${q(`${entity.table}.${c.name}`)}, row.${c.name})`;
        const value = c.nullable ? `row.${c.name} === null ? null : ${opened}` : opened;
        out.push(
          `  if (viewer !== SERVER && reads(FIELD_RULES.${T}.${c.name}, viewer, row)) out.${c.name} = ${value};`
        );
        continue;
      }
      const value = c.type.kind === "file" ? `presentFileRef(row.${c.name})${c.nullable ? "" : "!"}` : `row.${c.name}`;
      out.push(`  if (reads(FIELD_RULES.${T}.${c.name}, viewer, row)) out.${c.name} = ${value};`);
    }
    out.push(`  return out;`);
    out.push(`}`, "");
  }
  return out.join("\n");
}

/** The viewer, the field rules and what a session is told of them */
function viewerSource(ir: IR, check: string): string {
  const entities = ir.entities.filter(takesViewer);
  const rules = entities
    .map(
      e =>
        `  ${typeName(e)}: {\n${ruledColumns(e)
          .map(c => `    ${c.name}: ${ruleLiteral(c.read!)} as Rule`)
          .join(",\n")}\n  }`
    )
    .join(",\n");
  const resources = ir.resources.filter(r => takesViewer(ir.entities.find(e => e.name === r.entity)!));
  const shape = resources
    .map(r => {
      const entity = ir.entities.find(e => e.name === r.entity)!;
      return `${r.name}: { ${ruledColumns(entity)
        .map(c => `${c.name}: boolean`)
        .join("; ")} }`;
    })
    .join("; ");
  const answers = resources
    .map(r => {
      const entity = ir.entities.find(e => e.name === r.entity)!;
      return `    ${r.name}: { ${ruledColumns(entity)
        .map(c => `${c.name}: could(FIELD_RULES.${typeName(entity)}.${c.name}, session)`)
        .join(", ")} }`;
    })
    .join(",\n");
  return `/** The server itself as a viewer: it reads every field${ir.entities.some(e => e.columns.some(c => c.sealed)) ? " but a sealed one" : ""} (an event's payload, the user a session keeps for its rules) */
export const SERVER = "server" as const;

/**
 * Who a row is presented to: the caller's session (null without one), or the server. A field with a read rule
 * is in the public shape only for a viewer its rule allows on that row; otherwise the key is absent, never null.
 * The entity's read rule decided before this whether the row is seen at all, so a field rule only narrows.
 */
export type Viewer = Session | null | typeof SERVER;

/** The read rules of fields, by entity. Each reads the row and the caller, nothing else. */
const FIELD_RULES = {
${rules}
};

function reads(rule: Rule, viewer: Viewer, row: Record<string, unknown>): boolean {
  return viewer === SERVER || ${check}(rule, viewer, row).ok;
}

/**
 * Whether the session could read a field under this rule on some row: what the rule says before any row is
 * there, and for a member predicate whether a membership of that rank is held at all.
 */
function could(rule: Rule, session: Session | null): boolean {
  switch (rule.kind) {
    case "all":
      return rule.rules.every(part => could(part, session));
    case "any":
      return rule.rules.some(alternative => could(alternative, session));
    case "member":
      return memberTenantIds(session, rule.role).length > 0;
    default:
      return ${check}(rule, session).ok;
  }
}

/** What a session is told beside its user: per resource, whether it could read each field that has a read rule */
export type VisibleFields = { ${shape} };

/** The pages leave out a column or an input this answers false for; a row still leaves out what its own rule refuses */
export function visibleFields(session: Session | null): VisibleFields {
  return {
${answers}
  };
}`;
}

/**
 * `sessionOf` when the identity has a field with a read rule: the session keeps the user as the server reads it,
 * which the rules need (a role its own holder may not read still decides), and remembers beside it what the caller
 * is told of their own row by register, login and me.
 */
export function selfSessionSource(ir: IR, userRow: string, memberships: string): string {
  const T = typeName(ir.entities.find(e => e.name === ir.auth!.identity)!);
  return `/** What each session's caller is told of their own row (register, login, me): the fields their own session may read */
const SELF = new WeakMap<Session, Public${T}>();

/** The session of a user row: the user as the server reads it, which the rules read, and their memberships */
export async function sessionOf(user: ${userRow}): Promise<Session> {
  const session: Session = { user: present${T}(user, SERVER), memberships: ${memberships} };
  SELF.set(session, present${T}(user, session));
  return session;
}

/** The caller's own row as their own session may read it; \`session.user\` is the whole row and never leaves the server as it is */
export function shownUser(session: Session): Public${T} {
  const shown = SELF.get(session);
  if (!shown) throw new Error("shownUser needs a session made by sessionOf");
  return shown;
}`;
}
