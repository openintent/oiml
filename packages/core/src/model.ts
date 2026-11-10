/**
 * The OSL 1.0 model: the declared state of an application.
 * `.osl/model.yaml` is written by `osl apply`, never by hand.
 */
import { z } from "zod";
import { defaultTableName } from "./naming.js";

const Identifier = z.string().regex(/^[a-z][a-z0-9_]*$/, "lower_snake_case identifier");
const EntityName = z.string().regex(/^[A-Z][A-Za-z0-9]*$/, "PascalCase entity name");
const ResourceName = z.string().regex(/^[a-z][a-z0-9_]*$/, "lower_snake_case resource name");

export const FIELD_TYPES = [
  "string",
  "text",
  "integer",
  "bigint",
  "float",
  "decimal",
  "boolean",
  "datetime",
  "date",
  "time",
  "uuid",
  "json",
  "enum",
  "array",
  "bytes",
  "file"
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const ARRAY_ELEMENT_TYPES = [
  "string",
  "text",
  "integer",
  "bigint",
  "float",
  "decimal",
  "boolean",
  "uuid"
] as const;

export const Validate = z
  .object({
    format: z.enum(["email", "url", "uuid"]).optional(),
    min_length: z.number().int().nonnegative().optional(),
    max_length: z.number().int().positive().optional(),
    pattern: z.string().min(1).optional(),
    min: z.number().optional(),
    max: z.number().optional()
  })
  .strict();
export type Validate = z.infer<typeof Validate>;

/** What a file field accepts. Sizes are bytes. */
export const FileOptions = z
  .object({
    /** MIME types, with wildcards like image/*; default: anything */
    accept: z
      .array(z.string().regex(/^[a-z0-9.+-]+\/(\*|[a-z0-9.+-]+)$/i))
      .min(1)
      .optional(),
    max_size: z.number().int().positive().optional()
  })
  .strict();
export type FileOptions = z.infer<typeof FileOptions>;

export const Relation = z
  .object({
    /** Target entity */
    entity: EntityName,
    kind: z.enum(["many_to_one", "one_to_one"]).default("many_to_one"),
    /** Relation name on this entity; defaults to the field name without `_id` */
    name: Identifier.optional(),
    /** Relation name on the target entity (the reverse side) */
    reverse: Identifier.optional(),
    on_delete: z.enum(["restrict", "cascade", "set_null"]).default("restrict")
  })
  .strict();
export type Relation = z.infer<typeof Relation>;

export const Field = z
  .object({
    type: z.enum(FIELD_TYPES),
    primary: z.boolean().optional(),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    /** Literal default, or the keywords `now` (datetime) and `uuid` (uuid) */
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    max_length: z.number().int().positive().optional(),
    enum_values: z.array(z.string().min(1)).min(1).optional(),
    array_type: z.enum(ARRAY_ELEMENT_TYPES).optional(),
    validate: Validate.optional(),
    relation: Relation.optional(),
    /** file fields only: what uploads are accepted */
    file: FileOptions.optional(),
    /** Never returned by the API and never accepted from it */
    hidden: z.boolean().optional(),
    /** Returned by the API but never accepted from it: only server code (an action handler) and defaults set it */
    read_only: z.boolean().optional(),
    /** Enum fields only: the values rank in declared order, first most privileged, for member:<path>:<value> on a membership entity */
    ranked: z.boolean().optional(),
    description: z.string().optional()
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.ranked && field.type !== "enum")
      ctx.addIssue({ code: "custom", message: "ranked only applies to enum fields" });
    if (field.read_only && field.hidden)
      ctx.addIssue({ code: "custom", message: "a hidden field is never accepted already; drop read_only" });
    if (field.read_only && field.primary)
      ctx.addIssue({ code: "custom", message: "a primary key is never accepted already; drop read_only" });
    if (field.type !== "file" && field.file)
      ctx.addIssue({ code: "custom", message: "file options only apply to file fields" });
    if (field.type === "file" && (field.primary || field.unique || field.default !== undefined || field.relation))
      ctx.addIssue({ code: "custom", message: "a file field cannot be primary, unique, defaulted or a relation" });
    if (field.type === "enum" && !field.enum_values)
      ctx.addIssue({ code: "custom", message: "enum fields need enum_values" });
    if (field.type !== "enum" && field.enum_values)
      ctx.addIssue({ code: "custom", message: "enum_values only apply to enum fields" });
    if (field.type === "array" && !field.array_type)
      ctx.addIssue({ code: "custom", message: "array fields need array_type" });
    if (field.type !== "array" && field.array_type)
      ctx.addIssue({ code: "custom", message: "array_type only applies to array fields" });
    if (field.relation && !["uuid", "integer", "bigint", "string"].includes(field.type))
      ctx.addIssue({ code: "custom", message: "a relation field must be uuid, integer, bigint or string" });
    if (field.default === "now" && field.type !== "datetime")
      ctx.addIssue({ code: "custom", message: "default now only applies to datetime fields" });
    if (field.default === "uuid" && field.type !== "uuid")
      ctx.addIssue({ code: "custom", message: "default uuid only applies to uuid fields" });
  });
export type Field = z.infer<typeof Field>;

/** One predicate of a rule; owner and member may follow a path of relation fields (project_id.owner_id) */
const BASE_PREDICATE =
  "(?:public|authenticated|none|owner:[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*|role:[A-Za-z0-9_-]+|member:[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*(?::[A-Za-z0-9_-]+)?)";
/** A field, or a path of relation fields ending in one: `published`, `project_id.public` */
const FIELD_PATH = "[a-z][a-z0-9_]*(?:\\.[a-z][a-z0-9_]*)*";
/** A row condition a predicate may carry: `when <field> = <value>` or `!=`; the field may be a path through relations */
const WHEN_CLAUSE = `(?: when ${FIELD_PATH} (?:=|!=) [A-Za-z0-9_.+-]+)?`;
const PREDICATE_SOURCE = `${BASE_PREDICATE}${WHEN_CLAUSE}`;
/** A conjunction: predicates joined with " and ", all of which must allow */
const CONJUNCTION_SOURCE = `${PREDICATE_SOURCE}(?: and ${PREDICATE_SOURCE})*`;
/** A rule: one conjunction, or alternatives joined with " or ", any of which allows; "and" binds tighter than "or" */
export const RULE_PATTERN = new RegExp(`^${CONJUNCTION_SOURCE}(?: or ${CONJUNCTION_SOURCE})*$`);
export const Rule = z
  .string()
  .regex(
    RULE_PATTERN,
    "public | authenticated | none | owner:<field> | role:<value> | member:<field>[:<role>], each optionally followed by ' when <field> = <value>' (or !=); <field> may follow relation fields (project_id.owner_id); predicates that must all hold are joined with ' and ', alternatives with ' or '"
  );
export type Rule = z.infer<typeof Rule>;

/** The row condition of a predicate, as written: `when published = true`, `when project_id.public = true` */
export interface RuleCondition {
  /** A field of the entity, or a dotted path of relation fields ending in a field of the entity they reach */
  field: string;
  op: "=" | "!=";
  /** The literal as written: true, false, null, a number, an enum value or a string without spaces */
  value: string;
}

/** A predicate split into its base and its when condition, when it has one */
export function splitWhen(predicate: string): { base: string; when?: RuleCondition } {
  const m = predicate.match(/^(.*?) when ([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*) (=|!=) (\S+)$/);
  return m ? { base: m[1], when: { field: m[2], op: m[3] as "=" | "!=", value: m[4] } } : { base: predicate };
}

/** A condition's text taken apart: the field it compares, its path and literal; undefined when it is not one */
export function splitCondition(text: string): RuleCondition | undefined {
  const m = text.match(/^([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*) (=|!=) (\S+)$/);
  return m ? { field: m[1], op: m[2] as "=" | "!=", value: m[3] } : undefined;
}

/** Why a when literal does not fit the field it tests, or undefined when it does */
export function conditionProblem(field: Field, raw: string): string | undefined {
  if (raw === "null") return field.required || field.primary ? "the field is never null" : undefined;
  switch (field.type) {
    case "boolean":
      return raw === "true" || raw === "false" ? undefined : "must be true or false";
    case "integer":
    case "bigint":
      return /^-?\d+$/.test(raw) ? undefined : "must be an integer";
    case "float":
    case "decimal":
      return /^-?\d+(\.\d+)?$/.test(raw) ? undefined : "must be a number";
    case "enum":
      return field.enum_values!.includes(raw) ? undefined : `must be one of ${field.enum_values!.join(", ")}`;
    case "string":
    case "text":
      return undefined;
    default:
      return `when conditions compare boolean, number, enum and string fields, not ${field.type}`;
  }
}

/** The alternatives of a rule: one, or the conjunctions it joins with " or "; each is a predicate or " and "-joined predicates */
export function ruleAlternativeTexts(rule: string): string[] {
  return rule
    .split(" or ")
    .map(p => p.trim())
    .filter(Boolean);
}

/** The predicates a conjunction (or a single predicate) is made of: split on " and " */
export function conjunctionParts(alternative: string): string[] {
  return alternative
    .split(" and ")
    .map(p => p.trim())
    .filter(Boolean);
}

/** Every predicate of a rule, across its alternatives and conjunctions */
export function rulePredicates(rule: string): string[] {
  return ruleAlternativeTexts(rule).flatMap(conjunctionParts);
}

/** An owner or member predicate taken apart: the fields it follows (the last one is tested) and, for member, the least role */
export function predicateParts(
  predicate: string
): { kind: "owner" | "member"; path: string[]; role?: string } | undefined {
  const [kind, field, role] = splitWhen(predicate).base.split(":");
  if (kind !== "owner" && kind !== "member") return undefined;
  const path = field.split(".");
  return role !== undefined ? { kind, path, role } : { kind, path };
}

/** A membership relation as a member path ends in it: the junction, its two columns, and its ranked enum when it has one */
export interface MembershipRelation {
  entity: string;
  /** The junction's relation field pointing at the entity the path reached */
  fkField: string;
  /** The junction's relation field pointing at the identity */
  memberField: string;
  roleField?: string;
  roles: string[];
  /** Whether the junction is unique on its two relation fields */
  unique: boolean;
}

/**
 * The membership relation named `name` on `entityName`: a reverse relation declared on a junction whose entity has
 * exactly one relation to the identity besides the one the path arrived through. Null when no reverse relation has
 * that name; a problem when it has one that is not a membership.
 */
export function membershipRelation(
  model: Model,
  entityName: string,
  name: string
): MembershipRelation | { problem: string } | null {
  const identity = model.auth?.identity;
  for (const [junctionName, junction] of Object.entries(model.entities)) {
    for (const [fkField, field] of Object.entries(junction.fields)) {
      if (field.relation?.entity !== entityName || field.relation.reverse !== name) continue;
      const identityFields = Object.entries(junction.fields)
        .filter(([n, f]) => f.relation?.entity === identity && n !== fkField)
        .map(([n]) => n);
      if (identityFields.length === 0)
        return {
          problem: `${junctionName} has no relation to ${identity ?? "the identity"} besides ${fkField}, so it is not a membership`
        };
      if (identityFields.length > 1)
        return {
          problem: `${junctionName} has ${identityFields.length} relations to ${identity} (${identityFields.join(", ")}); a membership needs one`
        };
      const memberField = identityFields[0];
      const ranked = Object.entries(junction.fields).filter(([, f]) => f.type === "enum" && f.ranked);
      const roleField = ranked[0]?.[0];
      const bothPrimary = Boolean(junction.fields[fkField].primary && junction.fields[memberField].primary);
      const unique =
        bothPrimary ||
        (junction.unique ?? []).some(cols => cols.length === 2 && cols.includes(fkField) && cols.includes(memberField));
      return {
        entity: junctionName,
        fkField,
        memberField,
        roleField,
        roles: roleField ? (junction.fields[roleField].enum_values ?? []) : [],
        unique
      };
    }
  }
  return null;
}

/** Whether a rule can hide one row and allow another: an owner or member predicate, or a condition, somewhere in it */
export function ruleHidesRows(rule: string | undefined): boolean {
  if (!rule) return false;
  return rulePredicates(rule).some(predicate => {
    const { base, when } = splitWhen(predicate);
    return when !== undefined || base.startsWith("owner:") || base.startsWith("member:");
  });
}

/** The field an owner predicate without a path names, when the rule has one (inside a conjunction too): on create it is set from the session */
export function directOwnerField(rule: string | undefined): string | undefined {
  for (const predicate of rulePredicates(rule ?? "")) {
    const parts = predicateParts(predicate);
    if (parts?.kind === "owner" && parts.path.length === 1) return parts.path[0];
  }
  return undefined;
}

/** What a row the read rule hides answers when addressed by id: a refusal (401 or 403), or the 404 a missing row gets */
export const HiddenRows = z.enum(["forbidden", "not_found"]);
export type HiddenRows = z.infer<typeof HiddenRows>;

export const RULE_OPERATIONS = ["read", "create", "update", "delete"] as const;

export const Rules = z
  .object({
    read: Rule.optional(),
    create: Rule.optional(),
    update: Rule.optional(),
    delete: Rule.optional(),
    /** not_found: a get, update, delete or row action of a row the read rule hides answers 404 like a missing row */
    hidden: HiddenRows.optional()
  })
  .strict();
export type Rules = z.infer<typeof Rules>;

export const Index = z
  .object({ fields: z.array(Identifier).min(1), unique: z.boolean().default(false), name: Identifier.optional() })
  .strict();
export type Index = z.infer<typeof Index>;

export const Entity = z
  .object({
    table: Identifier.optional(),
    description: z.string().optional(),
    fields: z.record(Identifier, Field),
    rules: Rules.optional(),
    indexes: z.array(Index).optional(),
    /** Multi-column unique constraints */
    unique: z.array(z.array(Identifier).min(1)).optional()
  })
  .strict();
export type Entity = z.infer<typeof Entity>;

export const OPERATIONS = ["list", "get", "create", "update", "delete"] as const;
export const Operation = z.enum(OPERATIONS);
export type Operation = z.infer<typeof Operation>;

export const ListOptions = z
  .object({
    /** Fields the list operation accepts as equality filters in the query string */
    filters: z.array(Identifier).optional(),
    order: z.array(z.tuple([Identifier, z.enum(["asc", "desc"])])).optional(),
    page_size: z.number().int().positive().max(200).default(20),
    /** Relation names to embed in each row */
    include: z.array(Identifier).optional(),
    /** Fields a client may sort by (`sort=<field>:asc|desc`); the declared order is the default */
    sortable: z.array(Identifier).optional(),
    /** String fields a `q` parameter searches, case-insensitively, as a substring */
    search: z.array(Identifier).optional()
  })
  .strict();

export const GetOptions = z.object({ include: z.array(Identifier).optional() }).strict();
export const WriteOptions = z.object({ fields: z.array(Identifier).optional() }).strict();

/** A field of an action's input or result: a Field without storage concerns */
export const ActionField = Field;

export const Action = z
  .object({
    description: z.string().optional(),
    /** row: POST <resource>/{id}/<name>, the handler gets the row. collection: POST <resource>/<name>. Global actions have no scope. */
    scope: z.enum(["row", "collection"]).optional(),
    /** The body the action accepts */
    input: z.record(Identifier, ActionField).optional(),
    rule: Rule.optional(),
    /** entity: the (updated) row, presented. none: 204. fields: a custom shape. Default entity for row actions, none otherwise. */
    returns: z.union([z.literal("entity"), z.literal("none"), z.record(Identifier, ActionField)]).optional()
  })
  .strict();
export type Action = z.infer<typeof Action>;

export const Resource = z
  .object({
    entity: EntityName,
    /** URL path; defaults to /api/<resource name> */
    path: z
      .string()
      .regex(/^\/[a-z0-9/_-]*$/)
      .optional(),
    description: z.string().optional(),
    operations: z.array(Operation).min(1),
    list: ListOptions.optional(),
    get: GetOptions.optional(),
    create: WriteOptions.optional(),
    update: WriteOptions.optional(),
    /** Operations beyond the five standard ones, handled by code you own in src/actions */
    actions: z.record(Identifier, Action).optional()
  })
  .strict();
export type Resource = z.infer<typeof Resource>;

export const OAUTH_PRESETS = ["github", "google"] as const;

/** A sign-in method. `credentials` is email and password; `magic_link` emails a one-time link; `oauth` redirects to a provider. */
export const AuthProvider = z.union([
  z.literal("credentials"),
  z.literal("magic_link"),
  z
    .object({
      /** github or google (presets), or oidc with an issuer */
      oauth: z.enum([...OAUTH_PRESETS, "oidc"]),
      /** oidc only: the issuer URL, discovered at /.well-known/openid-configuration */
      issuer: z.string().url().optional(),
      /** oidc only: the provider's name in URLs and env vars; default oidc */
      name: Identifier.optional()
    })
    .strict()
]);
export type AuthProvider = z.infer<typeof AuthProvider>;

/** A duration: what a timer waits after its field's time, how long an invite's link lasts: 15m, 48h, 30d */
export const DURATION_PATTERN = /^(\d+)(m|h|d)$/;
export const Duration = z.string().regex(DURATION_PATTERN, "a duration like 15m, 48h or 30d");

export function durationSeconds(text: string): number {
  const m = text.match(DURATION_PATTERN)!;
  const n = Number(m[1]);
  return n * (m[2] === "m" ? 60 : m[2] === "h" ? 3600 : 86400);
}

/** Teams, workspaces, organisations: rows belong to a tenant and users belong to tenants through memberships. */
export const Tenancy = z
  .object({
    /** The tenant entity (Team, Workspace, Organisation) */
    entity: EntityName,
    /** The membership entity: a relation to the identity, a relation to the tenant, a role enum, and a unique on both relations */
    membership: EntityName,
    /** The membership's role field; default role */
    role_field: Identifier.default("role"),
    /** The role given to whoever creates a tenant through its resource */
    creator_role: z.string().min(1)
  })
  .strict();
export type Tenancy = z.infer<typeof Tenancy>;

/**
 * Invites to one membership entity: a member names an email and a role, the address gets a link, and proving the
 * address makes the membership. The compiler writes the invite's entity and resource (see expandInvites).
 */
export const Invite = z
  .object({
    /** Who may invite, revoke and read the pending list; default the membership entity's own create rule */
    rule: Rule.optional(),
    /** How long a link lasts */
    expires: Duration.default("7d")
  })
  .strict();
export type Invite = z.infer<typeof Invite>;

export const Auth = z
  .object({
    /** Entity that represents a signed-in user */
    identity: EntityName,
    /** 1.0 spelling of providers: [credentials] */
    provider: z.literal("credentials").optional(),
    providers: z.array(AuthProvider).min(1).optional(),
    email_field: Identifier.default("email"),
    /** Hidden column the backend adds to the identity entity when credentials are a provider */
    password_field: Identifier.default("password_hash"),
    session_days: z.number().int().positive().default(30),
    tenancy: Tenancy.optional(),
    /** Membership entities people join by invite: the tenancy's membership or a junction a member path ends in */
    invites: z.record(EntityName, Invite).optional()
  })
  .strict()
  .superRefine((auth, ctx) => {
    if (!auth.provider && !auth.providers)
      ctx.addIssue({ code: "custom", message: "auth needs providers (or provider: credentials)" });
    for (const p of auth.providers ?? []) {
      if (typeof p === "object" && p.oauth === "oidc" && !p.issuer)
        ctx.addIssue({ code: "custom", message: "oauth: oidc needs an issuer" });
    }
  });
export type Auth = z.infer<typeof Auth>;

/** Who may start uploads and read file metadata. Defaults: upload authenticated when auth exists (else public), read public. */
export const Files = z.object({ upload: Rule.optional(), read: Rule.optional() }).strict();
export type Files = z.infer<typeof Files>;

/** Five cron fields (minute hour day-of-month month day-of-week), read in UTC */
export const Cron = z
  .string()
  .regex(/^\S+\s+\S+\s+\S+\s+\S+\s+\S+$/, "five cron fields: minute hour day month weekday");

/** Why a cron expression is not one the queues accept, or undefined when it is */
export function cronProblem(text: string): string | undefined {
  const fields = text.trim().split(/\s+/);
  if (fields.length !== 5) return "needs five fields: minute hour day month weekday";
  const limits: [string, number, number][] = [
    ["minute", 0, 59],
    ["hour", 0, 23],
    ["day", 1, 31],
    ["month", 1, 12],
    ["weekday", 0, 7]
  ];
  for (const [i, field] of fields.entries()) {
    const [name, min, max] = limits[i];
    for (const part of field.split(",")) {
      const m = part.match(/^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/);
      if (!m) return `${name} field "${part}" is not a number, range, list or step`;
      for (const n of [m[2], m[3]].filter((v): v is string => v !== undefined).map(Number))
        if (n < min || n > max) return `${name} field "${part}" is outside ${min}-${max}`;
      if (m[4] !== undefined && Number(m[4]) === 0) return `${name} field "${part}" steps by zero`;
    }
  }
  return undefined;
}

/** What a schedule or timer runs: a global action or a resource action, in the step spelling */
const RunRef = z
  .string()
  .regex(/^(actions\.[a-z][a-z0-9_]*|[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)$/, "actions.<name> or <resource>.<action>");

export const Schedule = z
  .object({
    /** Five cron fields, UTC */
    cron: Cron,
    /** A global action or a collection action; runs as the system, with no session */
    run: RunRef,
    /** Literal input for the action, when it takes some */
    input: z.record(Identifier, z.union([z.string(), z.number(), z.boolean()])).optional()
  })
  .strict();
export type Schedule = z.infer<typeof Schedule>;

export const Timer = z
  .object({
    /** The entity whose rows are timed */
    on: EntityName,
    /** A datetime field of it: the job is due at its value plus `after` */
    at: Identifier,
    after: Duration.optional(),
    /** A row action of a resource over the entity, run as the system for the row when the time passes */
    run: RunRef,
    /** A row condition in the rules' spelling, checked again when the job fires: `status = scheduled`, `thread_id.locked = false` */
    when: z
      .string()
      .regex(
        /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)* (=|!=) [A-Za-z0-9_.+-]+$/,
        "<field> = <value> or <field> != <value>; the field may follow relation fields"
      )
      .optional()
  })
  .strict();
export type Timer = z.infer<typeof Timer>;

export const EVENT_ON_PATTERN =
  /^([A-Z][A-Za-z0-9]*)\.(created|updated|deleted)$|^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;

export const Event = z
  .object({
    /** `<Entity>.created|updated|deleted`, or `<resource>.<action>` / `actions.<action>` after an action ran */
    on: z.string().regex(EVENT_ON_PATTERN, "<Entity>.created|updated|deleted or <resource>.<action>"),
    handler: Identifier,
    /** inline: in the request, before it answers. queue: a job in the database, run by the worker with retries. */
    delivery: z.enum(["inline", "queue"]).default("inline")
  })
  .strict();
export type Event = z.infer<typeof Event>;

export const Actor = z.object({ email: z.string().email(), password: z.string().min(1) }).catchall(z.unknown());
export type Actor = z.infer<typeof Actor>;

/** `<namespace>.<operation>`: a resource and one of its operations or actions, `auth.<op>`, `files.<upload|get>`, `actions.<name>` */
export const STEP_OP_PATTERN = /^([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;
export const AUTH_STEP_OPS = [
  "register",
  "login",
  "logout",
  "me",
  "magic_link",
  "magic_link_verify",
  "invite",
  "invite_accept"
] as const;
export const FILE_STEP_OPS = ["upload", "get"] as const;
/** Test-only steps: run due timers at a moment, run a schedule now, read the captured mailbox */
export const TIMER_STEP_OPS = ["run"] as const;
export const SCHEDULE_STEP_OPS = ["run"] as const;
export const EMAIL_STEP_OPS = ["sent"] as const;

const StepBase = z.object({
  name: z.string().optional(),
  /** Actor name from examples.actors; omitted means anonymous */
  as: z.string().optional(),
  op: z.string().regex(STEP_OP_PATTERN),
  /** Values are strings; a bare number (an integer id, a page size) is accepted and kept as its text */
  path: z.record(z.union([z.string(), z.number()]).transform(v => String(v))).optional(),
  query: z.record(z.union([z.string(), z.number()]).transform(v => String(v))).optional(),
  body: z.unknown().optional(),
  /** Variables captured from the response, e.g. `{ post: data.id }` */
  capture: z.record(z.string()).optional()
});

export const Step = StepBase.extend({
  expect: z.object({ status: z.number().int(), body: z.unknown().optional() }).strict()
}).strict();
export type Step = z.infer<typeof Step>;

/** A seed step is a scenario step without an expectation: it must succeed. */
export const SeedStep = StepBase.strict();
export type SeedStep = z.infer<typeof SeedStep>;

export const Scenario = z.object({ name: z.string().min(1), steps: z.array(Step).min(1) }).strict();
export type Scenario = z.infer<typeof Scenario>;

export const Examples = z
  .object({
    actors: z.record(Identifier, Actor).optional(),
    scenarios: z.array(Scenario).default([]),
    /** Steps `osl seed` replays against a running app to fill a development database */
    seed: z.array(SeedStep).default([])
  })
  .strict();
export type Examples = z.infer<typeof Examples>;

/** A lucide icon name in kebab-case, e.g. file-text; backends import it by its PascalCase export */
export const IconName = z.string().regex(/^[a-z][a-z0-9-]*$/, "lucide icon name in kebab-case");

/**
 * A URL path for a page: lower-case segments, no trailing slash. A detail page's path ends in the parameter :id,
 * the row's key; where a parameter may stand is checked with the model (M095).
 */
export const PagePath = z
  .string()
  .regex(
    /^(\/|\/:?[a-z0-9][a-z0-9_-]*(\/:?[a-z0-9][a-z0-9_-]*)*)$/,
    "a path like /posts or /admin/users, / for the landing page, or /posts/:id for a detail page"
  );

/** Who may open a page: a plain predicate; owner and member need a row, which a page does not have */
export const PageAccess = z
  .string()
  .regex(/^(public|authenticated|role:[A-Za-z0-9_-]+)$/, "public | authenticated | role:<value>");
export type PageAccess = z.infer<typeof PageAccess>;

/** Paths the app shell owns: the home page, sign-in and settings are scaffolds, never pages. */
export const RESERVED_PAGE_PATHS = ["/login", "/settings"] as const;
/** Paths the shell owns with everything under them: an invite's link lands on /invite/<token> */
export const RESERVED_PAGE_PREFIXES = ["/invite"] as const;

/**
 * Equality filters a page, tile, section or recent list always carries, from the resource's list filters, e.g.
 * { published: true }. Three values come from the context: "{actor.id}" is the signed-in user, "{tenant.id}" the
 * tenant chosen in the shell's switcher, and "{row.id}" the row of the detail page a section sits on.
 */
export const PageFilter = z.record(Identifier, z.union([z.string(), z.number(), z.boolean()]));
export type PageFilter = z.infer<typeof PageFilter>;

/** The context values a page filter may take */
export const PAGE_FILTER_CONTEXT = ["{actor.id}", "{row.id}", "{tenant.id}"] as const;

export const DashboardTile = z
  .object({
    resource: ResourceName,
    /** Default: the resource's title */
    label: z.string().min(1).optional(),
    /** Equality filters from the resource's list filters, e.g. { published: true }; "{actor.id}" is the signed-in user */
    filter: PageFilter.optional(),
    icon: IconName.optional(),
    /** One tile per value of an enum list filter, or per row of the related resource for a relation list filter */
    group_by: Identifier.optional()
  })
  .strict();
export type DashboardTile = z.infer<typeof DashboardTile>;

/** A list from another resource on a detail page, filtered by the page's row */
export const PageSection = z
  .object({
    resource: ResourceName,
    /** Default: the resource's name in Title Case */
    title: z.string().min(1).optional(),
    /** List filters of the section's resource; at least one key takes "{row.id}", the page's row */
    filter: PageFilter,
    /** Default: as a resource page's list, without the fields the filter fixes */
    columns: z.array(Identifier).min(1).optional(),
    /** One pair over a sortable field, spelled like list.order; default: the resource's own order */
    order: z.array(z.tuple([Identifier, z.enum(["asc", "desc"])])).optional(),
    /** Rows per page of the section; default 10 */
    limit: z.number().int().min(1).max(200).optional(),
    /** End the section with the resource's create form, the filter's context values preset; default false */
    create: z.boolean().optional()
  })
  .strict();
export type PageSection = z.infer<typeof PageSection>;

export const Page = z
  .object({
    /**
     * resource: a page over a resource (see layout). dashboard: count tiles and recent rows.
     * custom: a page the backend scaffolds once for you to fill in. detail: one row of a resource at its own
     * address (path ends in :id), followed by sections.
     */
    kind: z.enum(["resource", "dashboard", "custom", "detail"]).default("resource"),
    /** Resource the page shows; resource and detail pages */
    resource: ResourceName.optional(),
    /** split: the list beside the selected row. table: a sortable, filterable table with a detail page. board: cards grouped by an enum field. */
    layout: z.enum(["split", "table", "board"]).optional(),
    /** board layout: the enum field whose values are the columns; dragging a card updates it */
    group_by: Identifier.optional(),
    /** dashboard pages: the count tiles */
    tiles: z.array(DashboardTile).optional(),
    /** dashboard pages: recent rows per resource, newest first */
    recent: z
      .array(
        z
          .object({
            resource: ResourceName,
            limit: z.number().int().positive().max(50).default(5),
            /** Equality filters from the resource's list filters; "{actor.id}" and "{tenant.id}" as on tiles */
            filter: PageFilter.optional()
          })
          .strict()
      )
      .optional(),
    /** detail pages: lists from other resources, filtered by the page's row; they replace the included reverse relations */
    sections: z.array(PageSection).optional(),
    /** URL path; defaults to /<page name with underscores as dashes>, and to that plus /:id for a detail page */
    path: PagePath.optional(),
    /** Heading and sidebar label; defaults to the page name in Title Case */
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    /** Columns of the master list; resource pages only. Default: the first few short columns. */
    columns: z.array(Identifier).min(1).optional(),
    /** Fields shown and edited on the detail pane; resource and detail pages. Default: every output field. */
    fields: z.array(Identifier).min(1).optional(),
    /**
     * Who may open the page (sidebar and route); default authenticated when auth exists, public otherwise.
     * A detail page that takes over a list's detail opens for whoever the list opens for and takes none.
     */
    access: PageAccess.optional(),
    /** Resource pages: equality filters the list always carries, from the resource's list filters; "{actor.id}" is the signed-in user */
    filter: PageFilter.optional(),
    /** Refetch the page's data every this many seconds while it is open (polling) */
    refresh: z.number().int().min(5).max(3600).optional()
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.kind === "resource" && !page.resource)
      ctx.addIssue({ code: "custom", message: "resource pages need a resource" });
    if (page.kind === "detail" && !page.resource)
      ctx.addIssue({ code: "custom", message: "detail pages need a resource" });
    if (page.kind === "resource" && page.path === "/")
      ctx.addIssue({ code: "custom", message: "a resource page cannot take /; a dashboard or custom page can" });
    if (page.kind !== "resource" && page.filter)
      ctx.addIssue({
        code: "custom",
        message: "filter applies to resource pages; tiles, recent lists and sections carry their own"
      });
    if (page.kind === "custom" && page.refresh)
      ctx.addIssue({ code: "custom", message: "refresh applies to resource, dashboard and detail pages" });
    if ((page.kind === "dashboard" || page.kind === "custom") && (page.resource || page.fields))
      ctx.addIssue({ code: "custom", message: "resource and fields apply to resource and detail pages" });
    if (page.kind !== "resource" && (page.columns || page.layout || page.group_by))
      ctx.addIssue({ code: "custom", message: "layout, group_by and columns apply to resource pages" });
    if (page.kind !== "detail" && page.sections)
      ctx.addIssue({ code: "custom", message: "sections apply to detail pages" });
    if (page.kind !== "dashboard" && (page.tiles || page.recent))
      ctx.addIssue({ code: "custom", message: "tiles and recent apply to dashboard pages" });
    if (page.layout === "board" && !page.group_by)
      ctx.addIssue({ code: "custom", message: "board pages need group_by" });
    if (page.layout !== "board" && page.group_by)
      ctx.addIssue({ code: "custom", message: "group_by applies to board pages" });
  });
export type Page = z.infer<typeof Page>;

export const SidebarItem = z
  .object({
    /** Page name from app.pages */
    page: Identifier,
    /** Defaults to the page title */
    label: z.string().min(1).optional(),
    icon: IconName.optional()
  })
  .strict();
export type SidebarItem = z.infer<typeof SidebarItem>;

export const SidebarFooter = z
  .object({
    /** Show the signed-in user (avatar, name, role) with a sign-out menu; needs auth */
    user: z.boolean().default(true),
    /** Show a settings link to the scaffolded /settings page */
    settings: z.boolean().default(true)
  })
  .strict();
export type SidebarFooter = z.infer<typeof SidebarFooter>;

export const Sidebar = z
  .object({
    items: z.array(SidebarItem).default([]),
    /** The fixed footer under the items */
    footer: SidebarFooter.default({})
  })
  .strict();
export type Sidebar = z.infer<typeof Sidebar>;

/** The web app: its pages and the sidebar that links them. Backends with a web app render it. */
export const App = z
  .object({
    /** Shown in the sidebar header and the document title; defaults to the model name */
    title: z.string().min(1).optional(),
    pages: z.record(Identifier, Page).default({}),
    /** A master/detail layout: the sidebar lists pages, the main pane shows the current one */
    sidebar: Sidebar.optional()
  })
  .strict();
export type App = z.infer<typeof App>;

export const Model = z
  .object({
    osl: z.literal("1.0"),
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    description: z.string().optional(),
    database: z
      .object({ dialect: z.literal("postgres") })
      .strict()
      .default({ dialect: "postgres" }),
    auth: Auth.optional(),
    /** Who may upload and read files; present or not, file fields work */
    files: Files.optional(),
    entities: z.record(EntityName, Entity).default({}),
    resources: z.record(ResourceName, Resource).default({}),
    /** Actions not tied to a resource: POST /api/actions/<name> */
    actions: z.record(Identifier, Action).default({}),
    events: z.array(Event).default([]),
    /** Work that runs on a cron, as the system */
    schedules: z.array(Schedule).default([]),
    /** Work that runs for a row when one of its datetime fields passes */
    timers: z.array(Timer).default([]),
    examples: Examples.optional(),
    app: App.optional()
  })
  .strict();
export type Model = z.infer<typeof Model>;

export interface Diagnostic {
  level: "error" | "warning";
  code: string;
  message: string;
  path: string;
}

/** Operations a resource may have, which an action may not be named after */
const RESERVED_ACTION_NAMES = new Set<string>([...OPERATIONS, "actions"]);

/** Columns a list may filter, order, sort or search by: anything but files and binary data */
/** The field can hold a written value: it is not a key, not hidden, not raw bytes, and not filled by the database */
function isWritable(field: Field): boolean {
  return (
    !field.primary && !field.hidden && field.type !== "bytes" && field.default !== "now" && field.default !== "uuid"
  );
}

/** A client may write the field through the API: writable and not read_only */
function isClientWritable(field: Field): boolean {
  return isWritable(field) && !field.read_only;
}

/** Fields auth.register accepts besides email and password: client-writable identity fields, never role */
function registerFields(model: Model): string[] {
  if (!model.auth) return [];
  const identity = model.entities[model.auth.identity];
  if (!identity) return [];
  const email = model.auth.email_field ?? "email";
  return Object.entries(identity.fields)
    .filter(([name, f]) => isClientWritable(f) && f.type !== "file" && name !== email && name !== "role")
    .map(([name]) => name);
}

/**
 * Identity fields an example actor may set although register refuses them: role and read_only fields. The test
 * harness and `osl seed` register the actor through the API, then write these straight into the database.
 */
export function provisionFields(model: Model): string[] {
  if (!model.auth) return [];
  const identity = model.entities[model.auth.identity];
  if (!identity) return [];
  const email = model.auth.email_field ?? "email";
  const accepted = new Set(registerFields(model));
  return Object.entries(identity.fields)
    .filter(([name, f]) => isWritable(f) && f.type !== "file" && name !== email && !accepted.has(name))
    .map(([name]) => name);
}

/** Why a literal value does not fit a field, or undefined when it does */
function valueProblem(field: Field, value: unknown): string | undefined {
  switch (field.type) {
    case "enum":
      return field.enum_values!.includes(String(value)) ? undefined : `must be one of ${field.enum_values!.join(", ")}`;
    case "boolean":
      return typeof value === "boolean" ? undefined : "must be true or false";
    case "integer":
    case "bigint":
      return Number.isInteger(value) ? undefined : "must be an integer";
    case "float":
    case "decimal":
      return typeof value === "number" ? undefined : "must be a number";
    case "string":
    case "text":
      return typeof value === "string" ? undefined : "must be a string";
    default:
      return undefined;
  }
}

function isQueryable(field: Field): boolean {
  return field.type !== "file" && field.type !== "bytes";
}

/** Field names every invite entity has of its own; a membership's parent or role field may not carry one */
const INVITE_OWN_FIELDS = ["id", "email", "invited_by", "token_hash", "expires_at", "created_at"] as const;
/** Key types the database fills by itself */
const GENERATED_KEY_TYPES = ["uuid", "integer", "bigint"];

/** What one entry of auth.invites comes to: the membership it invites to, and the entity and resource written for it */
export interface InvitePlan {
  membership: string;
  /** The entity a membership belongs to: the tenant, or the row a junction's reverse relation hangs from */
  parent: string;
  /** The membership's relation fields to its parent and to the identity; the invite names its parent the same way */
  parentField: string;
  memberField: string;
  /** The role an invite grants and its values from most to least privileged: the tenancy's role field or a junction's ranked enum */
  roleField?: string;
  roles: string[];
  /** Who may invite, revoke and read the pending list */
  rule: string;
  /** Whether the entry declares the rule; otherwise it is the membership's own create rule */
  explicitRule: boolean;
  expires: string;
  entity: string;
  table: string;
  resource: string;
}

interface InviteExpansion {
  plans: InvitePlan[];
  problems: Diagnostic[];
}
/** The plans behind every model expandInvites has written; a model in here is not expanded twice */
const EXPANSIONS = new WeakMap<Model, InviteExpansion>();

type InviteShape = Pick<InvitePlan, "parent" | "parentField" | "memberField" | "roleField" | "roles"> & {
  unique: boolean;
};

/**
 * How `name` is a membership entity: the tenancy's, or a junction a member path can end in. A string says why it is
 * neither. Null leaves a broken tenancy to its own diagnostics (M110 to M113).
 */
function inviteShape(model: Model, name: string): InviteShape | string | null {
  const auth = model.auth!;
  const entity = model.entities[name];
  if (!entity) return `auth.invites names ${name}, which does not exist`;
  const uniquePair = (a: string, b: string) =>
    Boolean(entity.fields[a].primary && entity.fields[b].primary) ||
    (entity.unique ?? []).some(cols => cols.length === 2 && cols.includes(a) && cols.includes(b));
  const tenancy = auth.tenancy;
  if (tenancy?.membership === name) {
    const users = Object.keys(entity.fields).filter(n => entity.fields[n].relation?.entity === auth.identity);
    const tenants = Object.keys(entity.fields).filter(n => entity.fields[n].relation?.entity === tenancy.entity);
    const role = entity.fields[tenancy.role_field];
    if (!model.entities[tenancy.entity] || users.length !== 1 || tenants.length !== 1 || role?.type !== "enum")
      return null;
    return {
      parent: tenancy.entity,
      parentField: tenants[0],
      memberField: users[0],
      roleField: tenancy.role_field,
      roles: role.enum_values ?? [],
      unique: uniquePair(tenants[0], users[0])
    };
  }
  const found = Object.entries(entity.fields).flatMap(([fieldName, field]) => {
    if (!field.relation?.reverse) return [];
    const membership = membershipRelation(model, field.relation.entity, field.relation.reverse);
    if (!membership || "problem" in membership) return [];
    if (membership.entity !== name || membership.fkField !== fieldName) return [];
    return [{ parent: field.relation.entity, membership }];
  });
  if (found.length === 0)
    return `${name} is not a membership: an invite needs the tenancy's membership, or an entity with one relation to ${auth.identity} and one relation with a reverse name to the entity people join`;
  if (found.length > 1)
    return `${name} is a membership in both directions (${found.map(f => f.membership.fkField).join(", ")}), so an invite to it has no one parent`;
  const { parent, membership } = found[0];
  return {
    parent,
    parentField: membership.fkField,
    memberField: membership.memberField,
    roleField: membership.roleField,
    roles: membership.roles,
    unique: membership.unique
  };
}

/** Every entry of auth.invites as a plan, with what stops an entry from becoming one (M115 to M118) */
function planInvites(model: Model): InviteExpansion {
  const plans: InvitePlan[] = [];
  const problems: Diagnostic[] = [];
  const problem = (code: string, message: string, path: string) =>
    problems.push({ level: "error", code, message, path });
  const auth = model.auth;
  if (!auth?.invites || !model.entities[auth.identity]) return { plans, problems };
  const tables = new Map(Object.entries(model.entities).map(([n, e]) => [e.table ?? defaultTableName(n), n]));
  const invitedParents = new Map<string, string>();
  for (const [name, entry] of Object.entries(auth.invites)) {
    const path = `auth.invites.${name}`;
    const shape = inviteShape(model, name);
    if (shape === null) continue;
    if (typeof shape === "string") {
      problem("M115", shape, path);
      continue;
    }
    const membership = model.entities[name];
    const before = problems.length;

    const keys = primaryKeyFields(membership);
    const unfilled = Object.entries(membership.fields)
      .filter(([n, f]) => {
        if (n === shape.parentField || n === shape.memberField || n === shape.roleField) return false;
        if (f.default !== undefined) return false;
        if (f.primary || (keys.length === 1 && keys[0] === n))
          return !(keys.length === 1 && GENERATED_KEY_TYPES.includes(f.type));
        return f.required;
      })
      .map(([n]) => n);
    if (unfilled.length)
      problem(
        "M116",
        `an invite cannot make a ${name}: ${unfilled.join(", ")} ${unfilled.length === 1 ? "is" : "are"} required and ${unfilled.length === 1 ? "has" : "have"} no default; accepting an invite sets ${shape.parentField}, ${shape.memberField}${shape.roleField ? ` and ${shape.roleField}` : ""} only`,
        path
      );
    if (!shape.unique)
      problem(
        "M116",
        `an invite cannot make a ${name}: it needs unique: [[${shape.parentField}, ${shape.memberField}]], so a person holds one membership of a ${shape.parent} however often they accept`,
        path
      );

    const entity = `${shape.parent}Invite`;
    const table = defaultTableName(entity);
    const resource = table;
    const earlier = invitedParents.get(shape.parent);
    if (earlier)
      problem(
        "M118",
        `${earlier} and ${name} both belong to ${shape.parent}, and ${shape.parent} takes one kind of invite (${entity})`,
        path
      );
    invitedParents.set(shape.parent, name);
    if (model.entities[entity])
      problem(
        "M118",
        `invites to ${name} are kept in an entity ${entity}, and the model declares one; rename it`,
        path
      );
    else if (tables.has(table))
      problem(
        "M118",
        `invites to ${name} are kept in the table ${table}, which ${tables.get(table)} uses; give ${tables.get(table)} another table`,
        path
      );
    if (model.resources[resource])
      problem(
        "M118",
        `invites to ${name} are served by a resource ${resource}, and the model declares one; rename it`,
        path
      );
    for (const taken of [shape.parentField, shape.roleField])
      if (taken && (INVITE_OWN_FIELDS as readonly string[]).includes(taken))
        problem(
          "M118",
          `${name}.${taken} carries a name every invite uses for a field of its own (${INVITE_OWN_FIELDS.join(", ")}); rename the field`,
          path
        );

    const rule = entry.rule ?? membership.rules?.create ?? "authenticated";
    const explicitRule = entry.rule !== undefined;
    const rulePath = explicitRule ? `${path}.rule` : path;
    const inviteFields = new Set<string>([
      ...INVITE_OWN_FIELDS,
      shape.parentField,
      ...(shape.roleField ? [shape.roleField] : [])
    ]);
    const declare = explicitRule
      ? `write it over the invite's own fields (${shape.parentField}, invited_by)`
      : `it is ${name}'s create rule; declare rule on the entry, over the invite's own fields (${shape.parentField}, invited_by)`;
    if (ruleAlternativeTexts(rule).includes("public"))
      problem("M117", `the invite rule "${rule}" lets anyone invite to any ${shape.parent}; ${declare}`, rulePath);
    else {
      const missing = new Set<string>();
      for (const predicate of rulePredicates(rule)) {
        const { base, when } = splitWhen(predicate);
        const first = predicateParts(base)?.path[0];
        if (first !== undefined && !inviteFields.has(first)) missing.add(first);
        const tested = when?.field.split(".")[0];
        if (tested !== undefined && !inviteFields.has(tested)) missing.add(tested);
      }
      if (missing.size)
        problem(
          "M117",
          `the invite rule "${rule}" cannot be read on an invite, which has no ${[...missing].join(", ")}; ${declare}`,
          rulePath
        );
    }

    if (problems.length === before)
      plans.push({
        membership: name,
        parent: shape.parent,
        parentField: shape.parentField,
        memberField: shape.memberField,
        roleField: shape.roleField,
        roles: shape.roles,
        rule,
        explicitRule,
        expires: entry.expires,
        entity,
        table,
        resource
      });
  }
  return { plans, problems };
}

/** The entity an invite plan writes: an email, the parent it invites to, the role, the inviter, a hashed token and when it lapses */
function inviteEntity(model: Model, plan: InvitePlan): Entity {
  const auth = model.auth!;
  const membership = model.entities[plan.membership];
  const identity = model.entities[auth.identity];
  const keys = primaryKeyFields(membership);
  const key = keys.length === 1 ? membership.fields[keys[0]] : undefined;
  const parentField = membership.fields[plan.parentField];
  const identityKey = identity.fields[primaryKeyFields(identity)[0]];
  const emailField = identity.fields[auth.email_field];
  const fields: Record<string, unknown> = {
    id: { type: key && GENERATED_KEY_TYPES.includes(key.type) ? key.type : "uuid", primary: true },
    [plan.parentField]: {
      type: parentField.type,
      required: true,
      relation: {
        entity: plan.parent,
        ...(parentField.relation?.name ? { name: parentField.relation.name } : {}),
        on_delete: "cascade"
      }
    },
    email: {
      type: "string",
      required: true,
      ...(emailField?.max_length ? { max_length: emailField.max_length } : {}),
      validate: { format: "email" },
      description: "The address invited; whoever proves it becomes the member"
    }
  };
  if (plan.roleField) {
    const role = membership.fields[plan.roleField];
    fields[plan.roleField] = {
      type: "enum",
      enum_values: role.enum_values,
      ...(role.required ? { required: true } : {}),
      ...(role.default !== undefined ? { default: role.default } : {}),
      description: `The ${plan.roleField} the membership gets`
    };
  }
  fields.invited_by = {
    type: identityKey?.type ?? "uuid",
    required: true,
    read_only: true,
    relation: { entity: auth.identity, name: "inviter", on_delete: "cascade" }
  };
  fields.token_hash = { type: "string", required: true, hidden: true, unique: true };
  fields.expires_at = { type: "datetime", required: true, read_only: true };
  fields.created_at = { type: "datetime", required: true, default: "now" };
  const rules: Record<string, string> = { read: plan.rule, create: plan.rule, update: "none", delete: plan.rule };
  if (model.entities[plan.parent]?.rules?.hidden === "not_found" && ruleHidesRows(plan.rule))
    rules.hidden = "not_found";
  return Entity.parse({
    description: `An invite to a ${plan.parent}: the address gets a link, and proving the address makes a ${plan.membership}. Written from auth.invites.`,
    fields,
    rules,
    unique: [[plan.parentField, "email"]]
  });
}

function inviteResource(plan: InvitePlan): Resource {
  return Resource.parse({
    entity: plan.entity,
    description: `Invites to a ${plan.parent}: create sends one, delete revokes one, list shows the ones waiting`,
    operations: ["list", "get", "create", "delete"],
    list: { filters: [plan.parentField], include: ["inviter"], order: [["created_at", "desc"]] }
  });
}

/**
 * The model with what auth.invites stands for written out: for each invited membership an invite entity and its
 * resource. From validation onward they are an entity and a resource like any other; the stored model never holds
 * them, and no diff op changes them, because their shape follows the membership. Run at the top of validateModel
 * and compile. A model without invites, or one this function wrote, comes back as it is.
 */
export function expandInvites(model: Model): Model {
  if (EXPANSIONS.has(model) || !model.auth?.invites) return model;
  const expansion = planInvites(model);
  const entities = { ...model.entities };
  const resources = { ...model.resources };
  for (const plan of expansion.plans) {
    entities[plan.entity] = inviteEntity(model, plan);
    resources[plan.resource] = inviteResource(plan);
  }
  const expanded: Model = { ...model, entities, resources };
  EXPANSIONS.set(expanded, expansion);
  return expanded;
}

/** The invite plans of a model expandInvites has written; none for any other model */
export function invitePlans(expanded: Model): InvitePlan[] {
  return EXPANSIONS.get(expanded)?.plans ?? [];
}

/** Semantic checks the Zod schema cannot express. Errors make the model unusable. */
export function validateModel(input: Model): Diagnostic[] {
  const model = expandInvites(input);
  const invited = new Map(invitePlans(model).map(plan => [plan.entity, plan]));
  const out: Diagnostic[] = [];
  const error = (code: string, message: string, path: string) => out.push({ level: "error", code, message, path });
  const warn = (code: string, message: string, path: string) => out.push({ level: "warning", code, message, path });

  const entityNames = new Set(Object.keys(model.entities));
  const providers = authProviders(model);
  const tenancy = model.auth?.tenancy;
  const membershipRoles = (): string[] => {
    if (!tenancy) return [];
    const membership = model.entities[tenancy.membership];
    return membership?.fields[tenancy.role_field]?.enum_values ?? [];
  };

  /** One predicate of a rule on `entity` (see checkRule) */
  /**
   * A when condition on `entityName`: its field may be a path of relation fields; every segment but the last must
   * be a relation field of the entity reached so far (M032), and the literal must fit the final field (M033).
   */
  const checkCondition = (when: RuleCondition, entityName: string, rpath: string) => {
    const path = when.field.split(".");
    let current = entityName;
    for (const segment of path.slice(0, -1)) {
      const f = model.entities[current].fields[segment];
      if (!f) {
        error("M032", `when field ${segment} does not exist on ${current}`, rpath);
        return;
      }
      if (!f.relation || !model.entities[f.relation.entity]) {
        error("M032", `when path ${when.field}: ${segment} is not a relation field on ${current}`, rpath);
        return;
      }
      current = f.relation.entity;
    }
    const field = path[path.length - 1];
    const f = model.entities[current].fields[field];
    if (!f) error("M032", `when field ${field} does not exist on ${current}`, rpath);
    else {
      const problem = conditionProblem(f, when.value);
      if (problem) error("M033", `when ${when.field} ${when.op} ${when.value}: ${problem}`, rpath);
    }
  };

  const checkPredicate = (full: string, entityName: string | null, rpath: string, row: boolean) => {
    const { base: predicate, when } = splitWhen(full);
    if (when) {
      if (!row || !entityName || !model.entities[entityName])
        error("M032", `rule ${full}: a when condition needs a row; drop it here`, rpath);
      else if (predicate === "none") error("M032", `none takes no when condition`, rpath);
      else checkCondition(when, entityName, rpath);
    }
    const parts = predicateParts(predicate);
    if (parts) {
      if (!row || !entityName || !model.entities[entityName]) {
        error("M027", `rule ${predicate} needs a row; use public, authenticated or role here`, rpath);
        return;
      }
      // Follow the relation fields the path names; the last field is tested on the entity they reach
      let current = entityName;
      for (const segment of parts.path.slice(0, -1)) {
        const f = model.entities[current].fields[segment];
        if (!f) {
          error("M020", `${parts.kind} field ${segment} does not exist on ${current}`, rpath);
          return;
        }
        if (!f.relation || !model.entities[f.relation.entity]) {
          error(
            "M028",
            `${parts.kind} path ${parts.path.join(".")}: ${segment} is not a relation field on ${current}`,
            rpath
          );
          return;
        }
        current = f.relation.entity;
      }
      const field = parts.path[parts.path.length - 1];
      const f = model.entities[current].fields[field];
      // A member path may end in a membership relation instead of a field: a reverse relation to a junction
      const membership = !f && parts.kind === "member" ? membershipRelation(model, current, field) : null;
      if (!f && !membership)
        error(
          "M020",
          `${parts.kind} field ${field} does not exist on ${current}${parts.kind === "member" ? " (neither a field nor a reverse relation)" : ""}`,
          rpath
        );
      else if (!model.auth) error("M021", `${parts.kind} rules need auth to be configured`, rpath);
      else if (membership) {
        const spelled = `member:${parts.path.join(".")}`;
        if ("problem" in membership) error("M036", `${spelled}: ${membership.problem}`, rpath);
        else {
          if (parts.role !== undefined) {
            if (!membership.roleField) {
              const enums = Object.entries(model.entities[membership.entity].fields).filter(
                ([, e]) => e.type === "enum"
              );
              const hint = enums.length === 1 ? ` (mark ${membership.entity}.${enums[0][0]} ranked: true)` : "";
              error(
                "M037",
                `${spelled}:${parts.role} needs an enum field marked ranked: true on ${membership.entity}${hint}`,
                rpath
              );
            } else if (!membership.roles.includes(parts.role))
              error(
                "M037",
                `member role ${parts.role} is not a value of ${membership.entity}.${membership.roleField}`,
                rpath
              );
          }
          if (!membership.unique)
            warn(
              "M038",
              `${membership.entity} has no unique on [${membership.fkField}, ${membership.memberField}]: a user could hold two memberships of one ${current}`,
              rpath
            );
        }
      } else if (parts.kind === "owner") {
        const pointsAtIdentity =
          f.relation?.entity === model.auth.identity || (current === model.auth.identity && f.primary);
        if (!pointsAtIdentity)
          error(
            "M022",
            `owner field ${field} must be a relation to ${model.auth.identity}, or the identity's own primary key`,
            rpath
          );
      } else {
        if (!tenancy) {
          error(
            "M024",
            `member field ${field} needs auth.tenancy; a membership relation (a reverse relation to an entity with a relation to ${model.auth.identity}) needs none`,
            rpath
          );
          return;
        }
        const pointsAtTenant = f.relation?.entity === tenancy.entity || (current === tenancy.entity && f.primary);
        if (!pointsAtTenant)
          error(
            "M025",
            `member field ${field} must be a relation to ${tenancy.entity}, the tenant's own primary key, or a membership relation (a reverse relation to an entity with a relation to ${model.auth.identity})`,
            rpath
          );
        if (parts.role !== undefined && !membershipRoles().includes(parts.role))
          error(
            "M026",
            `member role ${parts.role} is not a value of ${tenancy.membership}.${tenancy.role_field}`,
            rpath
          );
      }
      return;
    }
    if ((predicate === "authenticated" || predicate.startsWith("role:")) && !model.auth)
      error("M021", `rule ${predicate} needs auth to be configured`, rpath);
    if (predicate.startsWith("role:") && model.auth) {
      const identity = model.entities[model.auth.identity];
      if (identity && !identity.fields.role)
        error("M023", `role rules need a role field on ${model.auth.identity}`, rpath);
    }
  };

  /** A rule on `entity`, used by its operations or an action over it (`row` true) or by nothing row-shaped */
  const checkRule = (rule: string, entityName: string | null, rpath: string, row: boolean) => {
    const alternatives = ruleAlternativeTexts(rule);
    if (alternatives.length > 1 && alternatives.includes("public"))
      warn("M029", `rule "${rule}": public allows everyone, so the other alternatives never matter`, rpath);
    for (const alternative of alternatives) {
      const parts = conjunctionParts(alternative);
      if (parts.length > 1) {
        if (parts.includes("none")) error("M034", `"${alternative}": none in a conjunction never allows`, rpath);
        if (parts.some(part => splitWhen(part).base === "public"))
          warn("M034", `"${alternative}": public adds nothing to a conjunction`, rpath);
      }
    }
    for (const predicate of new Set(rulePredicates(rule))) checkPredicate(predicate, entityName, rpath, row);
  };

  for (const [entityName, entity] of Object.entries(model.entities)) {
    const base = `entities.${entityName}`;
    /** Set for an invite entity the compiler wrote */
    const written = invited.get(entityName);
    const fieldNames = new Set(Object.keys(entity.fields));
    const primaries = Object.entries(entity.fields)
      .filter(([, f]) => f.primary)
      .map(([n]) => n);
    if (primaries.length === 0 && !entity.fields.id)
      error("M001", `entity ${entityName} has no primary key: mark a field primary or add an id field`, base);
    if (primaries.length > 1) {
      for (const p of primaries)
        if (entity.fields[p].default !== undefined)
          error("M002", `composite key field ${p} cannot have a default`, `${base}.fields.${p}`);
    }
    const rankedEnums = Object.keys(entity.fields).filter(
      n => entity.fields[n].type === "enum" && entity.fields[n].ranked
    );
    if (rankedEnums.length > 1)
      error(
        "M039",
        `${entityName} has ${rankedEnums.length} ranked enums (${rankedEnums.join(", ")}); one of them ranks memberships`,
        base
      );
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const fpath = `${base}.fields.${fieldName}`;
      if (field.relation) {
        if (!entityNames.has(field.relation.entity))
          error("M010", `relation target ${field.relation.entity} does not exist`, fpath);
        const target = model.entities[field.relation.entity];
        if (target) {
          const targetPk = primaryKeyFields(target);
          if (targetPk.length !== 1)
            error("M011", `relation target ${field.relation.entity} must have a single-column primary key`, fpath);
          else if (target.fields[targetPk[0]].type !== field.type)
            error(
              "M012",
              `relation field type ${field.type} must match ${field.relation.entity}.${targetPk[0]} type ${target.fields[targetPk[0]].type}`,
              fpath
            );
        }
        if (field.relation.on_delete === "set_null" && field.required)
          error("M013", `on_delete set_null needs a nullable field`, fpath);
      }
      if (
        field.read_only &&
        field.required &&
        field.default === undefined &&
        !field.primary &&
        !written &&
        directOwnerField(entity.rules?.create) !== fieldName
      )
        error(
          "M065",
          `read_only field ${fieldName} is required and has no default, so nothing could ever create a row; give it a default, drop required, or set it from the session with rules.create: owner:${fieldName}`,
          fpath
        );
    }
    // An invite entity carries one rule three times; it is checked once, where it was written
    if (written)
      checkRule(
        written.rule,
        entityName,
        `auth.invites.${written.membership}${written.explicitRule ? ".rule" : ""}`,
        true
      );
    else
      for (const action of RULE_OPERATIONS) {
        const rule = entity.rules?.[action];
        if (rule) checkRule(rule, entityName, `${base}.rules.${action}`, true);
      }
    if (entity.rules?.hidden === "not_found" && !ruleHidesRows(entity.rules.read))
      warn(
        "M035",
        "rules.hidden has no effect: the read rule allows or refuses every row alike, so no row is ever hidden",
        `${base}.rules.hidden`
      );
    for (const [i, index] of (entity.indexes ?? []).entries()) {
      for (const f of index.fields)
        if (!fieldNames.has(f)) error("M030", `index field ${f} does not exist`, `${base}.indexes[${i}]`);
    }
    for (const [i, cols] of (entity.unique ?? []).entries()) {
      for (const f of cols)
        if (!fieldNames.has(f)) error("M031", `unique field ${f} does not exist`, `${base}.unique[${i}]`);
    }
  }

  if (model.auth) {
    const identity = model.entities[model.auth.identity];
    if (!identity) error("M040", `auth identity ${model.auth.identity} does not exist`, "auth.identity");
    else {
      const emailField = identity.fields[model.auth.email_field];
      if (!emailField)
        error(
          "M041",
          `auth email field ${model.auth.email_field} does not exist on ${model.auth.identity}`,
          "auth.email_field"
        );
      else if (emailField.type !== "string" || !emailField.unique || !emailField.required)
        error("M042", `auth email field must be a required, unique string`, "auth.email_field");
      if (identity.fields[model.auth.password_field])
        error(
          "M043",
          `password field ${model.auth.password_field} is added by OSL and must not be declared`,
          "auth.password_field"
        );
      const blocking = Object.entries(identity.fields).filter(
        ([name, f]) =>
          f.required &&
          f.default === undefined &&
          !f.primary &&
          name !== model.auth!.email_field &&
          name !== "name" &&
          f.type !== "file"
      );
      if (blocking.length && providers.some(p => p !== "credentials"))
        warn(
          "M123",
          `magic links and OAuth cannot register new users while ${model.auth.identity} requires ${blocking.map(([n]) => n).join(", ")}; those users must register through credentials${model.auth.invites ? " or accept an invite, whose form asks for the fields," : ""} first`,
          "auth.providers"
        );
    }
    out.push(...(EXPANSIONS.get(model)?.problems ?? []));
    const names = (model.auth.providers ?? []).map(p =>
      typeof p === "string" ? p : p.oauth === "oidc" ? (p.name ?? "oidc") : p.oauth
    );
    for (const [i, n] of names.entries())
      if (names.indexOf(n) !== i) error("M122", `provider ${n} is declared twice`, `auth.providers[${i}]`);
    if (tenancy) {
      const tenant = model.entities[tenancy.entity];
      const membership = model.entities[tenancy.membership];
      if (!tenant) error("M110", `tenancy entity ${tenancy.entity} does not exist`, "auth.tenancy.entity");
      if (!membership)
        error("M110", `membership entity ${tenancy.membership} does not exist`, "auth.tenancy.membership");
      if (tenant && membership) {
        const userFields = Object.entries(membership.fields).filter(
          ([, f]) => f.relation?.entity === model.auth!.identity
        );
        const tenantFields = Object.entries(membership.fields).filter(([, f]) => f.relation?.entity === tenancy.entity);
        if (userFields.length !== 1)
          error(
            "M111",
            `${tenancy.membership} needs exactly one relation to ${model.auth.identity}`,
            "auth.tenancy.membership"
          );
        if (tenantFields.length !== 1)
          error(
            "M111",
            `${tenancy.membership} needs exactly one relation to ${tenancy.entity}`,
            "auth.tenancy.membership"
          );
        const role = membership.fields[tenancy.role_field];
        if (!role || role.type !== "enum" || !role.required)
          error(
            "M112",
            `${tenancy.membership}.${tenancy.role_field} must be a required enum`,
            "auth.tenancy.role_field"
          );
        else if (!role.enum_values!.includes(tenancy.creator_role))
          error(
            "M112",
            `creator_role ${tenancy.creator_role} is not a value of ${tenancy.membership}.${tenancy.role_field}`,
            "auth.tenancy.creator_role"
          );
        if (userFields.length === 1 && tenantFields.length === 1) {
          const pair = [userFields[0][0], tenantFields[0][0]];
          const unique = (membership.unique ?? []).some(cols => cols.length === 2 && pair.every(c => cols.includes(c)));
          const pk = primaryKeyFields(membership);
          if (!unique && !(pk.length === 2 && pair.every(c => pk.includes(c))))
            error(
              "M113",
              `${tenancy.membership} needs unique: [[${pair.join(", ")}]] so a user joins a tenant once`,
              "auth.tenancy.membership"
            );
        }
        for (const [resourceName, resource] of Object.entries(model.resources)) {
          if (
            resource.entity === tenancy.entity &&
            resource.operations.includes("create") &&
            rulePredicates(tenant.rules?.create ?? "authenticated").includes("public")
          )
            error(
              "M114",
              `creating ${tenancy.entity} through ${resourceName} must need a signed-in user, who becomes its ${tenancy.creator_role}`,
              `resources.${resourceName}`
            );
        }
      }
    }
  }
  if (!model.auth && Object.keys(model.examples?.actors ?? {}).length > 0)
    error("M074", "examples.actors need auth to be configured", "examples.actors");
  if (model.auth && Object.keys(model.examples?.actors ?? {}).length > 0 && !providers.includes("credentials"))
    error("M120", "examples.actors register with a password, which needs the credentials provider", "examples.actors");
  if (model.auth) {
    const accepted = new Set(["email", "password", ...registerFields(model)]);
    const provisioned = new Set(provisionFields(model));
    const identity = model.entities[model.auth.identity];
    for (const [actorName, actor] of Object.entries(model.examples?.actors ?? {})) {
      for (const [key, value] of Object.entries(actor)) {
        if (accepted.has(key)) continue;
        const apath = `examples.actors.${actorName}.${key}`;
        if (!provisioned.has(key) || !identity) {
          error(
            "M075",
            `actor ${actorName} sets ${key}, which auth.register does not accept (${[...accepted].join(", ")})` +
              (provisioned.size
                ? ` and which the harness cannot provision either (only ${[...provisioned].join(", ")})`
                : ""),
            apath
          );
          continue;
        }
        const problem = valueProblem(identity.fields[key], value);
        if (problem)
          error("M076", `actor ${actorName} sets ${key} to ${JSON.stringify(value)}, which ${problem}`, apath);
      }
    }
  }

  if (model.files) {
    for (const key of ["upload", "read"] as const) {
      const rule = model.files[key];
      if (rule) checkRule(rule, null, `files.${key}`, false);
      if (rule === "none" && key === "read") error("M100", "files.read cannot be none", "files.read");
    }
  }

  for (const [resourceName, resource] of Object.entries(model.resources)) {
    const base = `resources.${resourceName}`;
    const entity = model.entities[resource.entity];
    if (!entity) {
      error("M050", `resource entity ${resource.entity} does not exist`, base);
      continue;
    }
    if (primaryKeyFields(entity).length !== 1)
      error(
        "M054",
        `resource entity ${resource.entity} needs a single-column primary key; give the entity an id, or leave the link table without a resource`,
        base
      );
    const fieldNames = new Set(Object.keys(entity.fields));
    const relationNames = new Set(relationNamesOf(model, resource.entity));
    const ops = new Set(resource.operations);
    if (new Set(resource.operations).size !== resource.operations.length)
      error("M051", "duplicate operations", `${base}.operations`);
    if (model.auth && resource.entity === model.auth.identity && ops.has("create"))
      error(
        "M052",
        `the identity entity is created through auth.register, not a resource create operation`,
        `${base}.operations`
      );
    const queryable = (f: string, what: string, where: string) => {
      if (!fieldNames.has(f)) error("M053", `${what} field ${f} does not exist`, where);
      else if (!isQueryable(entity.fields[f]))
        error("M053", `${what} field ${f} is a ${entity.fields[f].type} field`, where);
    };
    for (const f of resource.list?.filters ?? []) queryable(f, "filter", `${base}.list.filters`);
    for (const [f] of resource.list?.order ?? []) queryable(f, "order", `${base}.list.order`);
    for (const f of resource.list?.sortable ?? []) queryable(f, "sortable", `${base}.list.sortable`);
    for (const f of resource.list?.search ?? []) {
      if (!fieldNames.has(f)) error("M059", `search field ${f} does not exist`, `${base}.list.search`);
      else if (!["string", "text"].includes(entity.fields[f].type))
        error("M059", `search field ${f} must be a string or text field`, `${base}.list.search`);
    }
    for (const r of resource.list?.include ?? [])
      if (!relationNames.has(r))
        error("M055", `include ${r} is not a relation of ${resource.entity}`, `${base}.list.include`);
    for (const r of resource.get?.include ?? [])
      if (!relationNames.has(r))
        error("M055", `include ${r} is not a relation of ${resource.entity}`, `${base}.get.include`);
    for (const key of ["create", "update"] as const) {
      for (const f of resource[key]?.fields ?? []) {
        if (!fieldNames.has(f)) error("M056", `${key} field ${f} does not exist`, `${base}.${key}.fields`);
        else if (entity.fields[f].hidden) error("M057", `${key} field ${f} is hidden`, `${base}.${key}.fields`);
        else if (entity.fields[f].read_only)
          error(
            "M064",
            `${key} field ${f} is read_only: only server code sets it; drop it from ${key}.fields or the read_only`,
            `${base}.${key}.fields`
          );
      }
      if (resource[key] && !ops.has(key))
        warn("M058", `${key} options given but ${key} is not in operations`, `${base}.${key}`);
    }
    if (resource.create?.fields && ops.has("create")) {
      const listed = new Set(resource.create.fields);
      const ownerField = directOwnerField(entity.rules?.create) ?? null;
      for (const [name, field] of Object.entries(entity.fields)) {
        if (
          !field.required ||
          field.default !== undefined ||
          !isClientWritable(field) ||
          listed.has(name) ||
          name === ownerField
        )
          continue;
        error(
          "M063",
          `create fields omit ${name}, which is required and has no default; list it, give it a default, or set it from the session with rules.create: owner:${name}`,
          `${base}.create.fields`
        );
      }
    }
    if (resource.list && !ops.has("list"))
      warn("M058", "list options given but list is not in operations", `${base}.list`);
    for (const [actionName, action] of Object.entries(resource.actions ?? {})) {
      const apath = `${base}.actions.${actionName}`;
      if (RESERVED_ACTION_NAMES.has(actionName)) error("M093", `action name ${actionName} is reserved`, apath);
      checkActionFields(action, apath, error);
      const scope = action.scope ?? "row";
      if (action.rule) checkRule(action.rule, resource.entity, `${apath}.rule`, scope === "row");
    }
  }

  for (const [actionName, action] of Object.entries(model.actions)) {
    const apath = `actions.${actionName}`;
    if (action.scope) error("M094", `global actions have no scope`, `${apath}.scope`);
    if (action.returns === "entity") error("M094", `global actions have no entity to return`, `${apath}.returns`);
    checkActionFields(action, apath, error);
    if (action.rule) checkRule(action.rule, null, `${apath}.rule`, false);
  }

  for (const [i, event] of model.events.entries()) {
    const m = event.on.match(EVENT_ON_PATTERN)!;
    if (m[1]) {
      if (!entityNames.has(m[1])) error("M060", `event entity ${m[1]} does not exist`, `events[${i}]`);
    } else if (m[3] === "actions") {
      if (!model.actions[m[4]]) error("M061", `event action ${m[4]} does not exist`, `events[${i}]`);
    } else {
      const resource = model.resources[m[3]];
      if (!resource) error("M061", `event resource ${m[3]} does not exist`, `events[${i}]`);
      else if (!resource.actions?.[m[4]]) error("M061", `resource ${m[3]} has no action ${m[4]}`, `events[${i}]`);
    }
  }

  // Schedules run a global or collection action on a cron; timers run a row action when a datetime field passes
  const runTarget = (run: string): { resource?: string; action: Action } | undefined => {
    const [ns, name] = run.split(".");
    if (ns === "actions") return model.actions[name] ? { action: model.actions[name] } : undefined;
    const action = model.resources[ns]?.actions?.[name];
    return action ? { resource: ns, action } : undefined;
  };
  for (const [i, schedule] of model.schedules.entries()) {
    const spath = `schedules[${i}]`;
    const cron = cronProblem(schedule.cron);
    if (cron) error("M130", `cron "${schedule.cron}": ${cron}`, `${spath}.cron`);
    const target = runTarget(schedule.run);
    if (!target) {
      error("M131", `run ${schedule.run} is not an action`, `${spath}.run`);
      continue;
    }
    if (target.resource && (target.action.scope ?? "row") === "row")
      error(
        "M131",
        `run ${schedule.run} is a row action; a schedule has no row, so run a collection or global action`,
        `${spath}.run`
      );
    const inputs = target.action.input ?? {};
    for (const [key, value] of Object.entries(schedule.input ?? {})) {
      const field = inputs[key];
      if (!field) {
        error("M131", `input ${key} is not an input of ${schedule.run}`, `${spath}.input.${key}`);
        continue;
      }
      const problem = valueProblem(field as Field, value);
      if (problem) error("M131", `input ${key}: ${problem}`, `${spath}.input.${key}`);
    }
    for (const [key, field] of Object.entries(inputs))
      if (field.required && field.default === undefined && !(key in (schedule.input ?? {})))
        error("M131", `${schedule.run} needs input ${key}; give it a literal in input`, `${spath}.input`);
  }
  for (const [i, timer] of model.timers.entries()) {
    const tpath = `timers[${i}]`;
    const entity = model.entities[timer.on];
    if (!entity) {
      error("M132", `entity ${timer.on} does not exist`, `${tpath}.on`);
      continue;
    }
    const at = entity.fields[timer.at];
    if (!at) error("M132", `field ${timer.at} does not exist on ${timer.on}`, `${tpath}.at`);
    else if (at.type !== "datetime")
      error("M132", `field ${timer.at} must be a datetime, not ${at.type}`, `${tpath}.at`);
    const target = runTarget(timer.run);
    const resourceEntity = target?.resource ? model.resources[target.resource]?.entity : undefined;
    if (!target || !target.resource || (target.action.scope ?? "row") !== "row" || resourceEntity !== timer.on)
      error("M133", `run ${timer.run} is not a row action of a resource over ${timer.on}`, `${tpath}.run`);
    else
      for (const [key, field] of Object.entries(target.action.input ?? {}))
        if (field.required && field.default === undefined)
          error("M133", `run ${timer.run} needs input ${key}, which a timer cannot give`, `${tpath}.run`);
    if (timer.when) {
      const when = splitCondition(timer.when);
      if (when) checkCondition(when, timer.on, `${tpath}.when`);
    }
  }

  if (model.app) {
    const pages = model.app.pages;
    const tenancy = model.auth?.tenancy;
    /** Where {tenant.id} is used: the switcher needs a resource listing the tenancy entity and a sidebar to sit in */
    const tenantUses: string[] = [];
    const seenPaths = new Map<string, string>();
    for (const [pageName, page] of Object.entries(pages)) {
      const base = `app.pages.${pageName}`;
      const pagePath = pagePathOf(pageName, page);
      const detailBase = page.kind === "detail" ? detailBasePath(pagePath) : undefined;
      if (
        (RESERVED_PAGE_PATHS as readonly string[]).includes(detailBase ?? pagePath) ||
        RESERVED_PAGE_PREFIXES.some(prefix => pagePath === prefix || pagePath.startsWith(`${prefix}/`))
      )
        error("M084", `path ${pagePath} is reserved for the app shell`, `${base}.path`);
      const segments = pagePath.split("/").filter(Boolean);
      const params = segments.filter(s => s.startsWith(":"));
      if (page.kind !== "detail") {
        if (params.length)
          error(
            "M095",
            `path ${pagePath} has a parameter; only a detail page's path takes one, and page ${pageName} is a ${page.kind} page`,
            `${base}.path`
          );
      } else if (params.length !== 1 || segments[segments.length - 1] !== ":id" || segments.length < 2)
        error(
          "M095",
          `a detail page's path ends in :id after at least one literal segment, like /channels/:id; page ${pageName} has ${pagePath}`,
          `${base}.path`
        );
      const taken = seenPaths.get(pagePath);
      if (taken) error("M085", `path ${pagePath} is already used by page ${taken}`, `${base}.path`);
      seenPaths.set(pagePath, pageName);
      // A detail page at <path>/:id sits where the resource page at <path> shows its rows: it takes that detail over
      // when both are over one resource, and collides with it otherwise
      const under = detailBase
        ? Object.entries(pages).find(([n, p]) => n !== pageName && pagePathOf(n, p) === detailBase)
        : undefined;
      if (under && under[1].kind === "resource" && under[1].resource !== page.resource)
        error(
          "M085",
          `path ${pagePath} is where page ${under[0]} opens its own rows; a detail page there must be over ${under[1].resource}, or take another path`,
          `${base}.path`
        );
      const listPage = under && under[1].kind === "resource" && under[1].resource === page.resource ? under : undefined;
      // Who may open the page: public pages can only show publicly readable data. A detail page inside a list is
      // behind the list's gate and opens for whoever the list opens for.
      if (listPage && page.access)
        error(
          "M091",
          `page ${pageName} takes over the detail of page ${listPage[0]} and opens for whoever that page opens for; it takes no access of its own`,
          `${base}.access`
        );
      const access = (listPage ? listPage[1].access : page.access) ?? (model.auth ? "authenticated" : "public");
      if (!listPage) {
        if (access !== "public" && !model.auth)
          error("M091", `page ${pageName} has access ${access}, which needs auth to be configured`, `${base}.access`);
        if (access.startsWith("role:") && model.auth && !model.entities[model.auth.identity]?.fields.role)
          error(
            "M091",
            `page ${pageName} has access ${access}, which needs a role field on ${model.auth.identity}`,
            `${base}.access`
          );
      }
      const publicPage = access === "public";
      const readable = (resourceName: string, where: string) => {
        const resource = model.resources[resourceName];
        const entity = resource && model.entities[resource.entity];
        if (!entity || !publicPage) return;
        const read = entity.rules?.read ?? "public";
        if (!rulePredicates(read).some(p => /^public\b/.test(p)))
          error(
            "M092",
            `page ${pageName} is public but ${resourceName} is not publicly readable (read: ${read}); give the page access: authenticated or open the read rule`,
            where
          );
      };
      /** rowEntity: the page's entity inside a detail page's section, where "{row.id}" is the page's row */
      const checkFilter = (
        resourceName: string,
        filter: Record<string, unknown> | undefined,
        where: string,
        rowEntity?: string
      ) => {
        const resource = model.resources[resourceName];
        const entity = resource && model.entities[resource.entity];
        if (!resource || !entity) return;
        for (const [key, value] of Object.entries(filter ?? {})) {
          if (!(resource.list?.filters ?? []).includes(key)) {
            error("M089", `filter ${key} is not a list filter of ${resourceName}`, where);
            continue;
          }
          if (typeof value !== "string" || !/^\{(actor|row|tenant)\.[^}]*\}$/.test(value)) continue;
          const field = entity.fields[key];
          const ownKey = primaryKeyFields(entity).includes(key);
          if (value === "{actor.id}") {
            const toIdentity =
              model.auth &&
              field &&
              (field.relation?.entity === model.auth.identity || (resource.entity === model.auth.identity && ownKey));
            if (!toIdentity)
              error("M089", `filter ${key} cannot be {actor.id}: it is not a relation to the identity entity`, where);
            if (publicPage)
              error(
                "M092",
                `page ${pageName} filters by {actor.id} but is public; give it access: authenticated or a role`,
                where
              );
          } else if (value === "{row.id}") {
            if (!rowEntity)
              error("M089", `filter ${key} cannot be {row.id}: only a detail page's sections have a row`, where);
            else if (field?.relation?.entity !== rowEntity)
              error(
                "M097",
                `filter ${key} cannot be {row.id}: it is not a relation to ${rowEntity}, the page's entity`,
                where
              );
          } else if (value === "{tenant.id}") {
            if (!tenancy) error("M098", `filter ${key} is {tenant.id}, which needs auth.tenancy`, where);
            else {
              const toTenant =
                field && (field.relation?.entity === tenancy.entity || (resource.entity === tenancy.entity && ownKey));
              if (!toTenant)
                error(
                  "M098",
                  `filter ${key} cannot be {tenant.id}: it is not a relation to ${tenancy.entity}, the tenancy entity`,
                  where
                );
              tenantUses.push(where);
            }
            if (publicPage)
              error(
                "M092",
                `page ${pageName} filters by {tenant.id} but is public; give it access: authenticated or a role`,
                where
              );
          } else
            error(
              "M089",
              `filter ${key} cannot be ${value}: the context values are {actor.id}, {tenant.id} and, in a section, {row.id}`,
              where
            );
        }
      };
      if (page.kind === "dashboard") {
        for (const [ti, tile] of (page.tiles ?? []).entries()) {
          const tpath = `${base}.tiles[${ti}]`;
          const resource = model.resources[tile.resource];
          if (!resource) error("M088", `tile resource ${tile.resource} does not exist`, tpath);
          else if (!resource.operations.includes("list"))
            error("M088", `tile resource ${tile.resource} needs a list operation`, tpath);
          else {
            checkFilter(tile.resource, tile.filter, tpath);
            readable(tile.resource, tpath);
            if (tile.group_by) {
              const entity = model.entities[resource.entity];
              const field = entity?.fields[tile.group_by];
              if (!field) error("M089", `tile group_by ${tile.group_by} does not exist on ${resource.entity}`, tpath);
              else if (!(resource.list?.filters ?? []).includes(tile.group_by))
                error("M089", `tile group_by ${tile.group_by} must be a list filter of ${tile.resource}`, tpath);
              else if (field.relation) {
                const target = field.relation.entity;
                if (!Object.values(model.resources).some(r => r.entity === target && r.operations.includes("list")))
                  error(
                    "M089",
                    `tile group_by ${tile.group_by} points at ${target}, which has no resource with a list operation`,
                    tpath
                  );
              } else if (field.type !== "enum")
                error("M089", `tile group_by ${tile.group_by} must be an enum or a relation field`, tpath);
            }
          }
        }
        for (const [ri, recent] of (page.recent ?? []).entries()) {
          const rpath = `${base}.recent[${ri}]`;
          const resource = model.resources[recent.resource];
          if (!resource || !resource.operations.includes("list"))
            error("M088", `recent resource ${recent.resource} needs a list operation`, rpath);
          else {
            checkFilter(recent.resource, recent.filter, rpath);
            readable(recent.resource, rpath);
          }
        }
        continue;
      }
      if (page.kind !== "resource" && page.kind !== "detail") continue;
      const resource = model.resources[page.resource!];
      if (!resource) {
        error("M081", `page resource ${page.resource} does not exist`, `${base}.resource`);
        continue;
      }
      if (page.kind === "detail") {
        if (!resource.operations.includes("get"))
          error("M082", `resource ${page.resource} needs a get operation for a detail page`, `${base}.resource`);
      } else if (!resource.operations.includes("list") || !resource.operations.includes("get"))
        error("M082", `resource ${page.resource} needs list and get operations for a page`, `${base}.resource`);
      readable(page.resource!, `${base}.resource`);
      checkFilter(page.resource!, page.filter, `${base}.filter`);
      const entity = model.entities[resource.entity];
      if (!entity) continue;
      if (entity.rules?.read === "none")
        error(
          "M086",
          `resource ${page.resource} cannot be read (rule none), so it cannot have a page`,
          `${base}.resource`
        );
      for (const key of ["columns", "fields"] as const) {
        for (const f of page[key] ?? []) {
          const field = entity.fields[f];
          if (!field) error("M083", `${key} field ${f} does not exist on ${resource.entity}`, `${base}.${key}`);
          else if (field.hidden || field.type === "bytes")
            error("M083", `${key} field ${f} is never returned by the API`, `${base}.${key}`);
        }
      }
      if (page.group_by) {
        const field = entity.fields[page.group_by];
        if (!field || field.type !== "enum")
          error("M087", `group_by ${page.group_by} must be an enum field of ${resource.entity}`, `${base}.group_by`);
        else if (!resource.operations.includes("update"))
          error(
            "M087",
            `board pages move cards by updating ${page.group_by}; ${page.resource} needs an update operation`,
            `${base}.group_by`
          );
      }
      for (const [si, section] of (page.sections ?? []).entries()) {
        const spath = `${base}.sections[${si}]`;
        const listed = model.resources[section.resource];
        if (!listed) {
          error("M097", `section resource ${section.resource} does not exist`, `${spath}.resource`);
          continue;
        }
        if (!listed.operations.includes("list")) {
          error("M097", `section resource ${section.resource} needs a list operation`, `${spath}.resource`);
          continue;
        }
        checkFilter(section.resource, section.filter, `${spath}.filter`, resource.entity);
        if (!Object.values(section.filter).includes("{row.id}"))
          error(
            "M097",
            `section ${section.resource} must filter by the page's row: give one key "{row.id}"; a list that does not depend on the row belongs on a dashboard`,
            `${spath}.filter`
          );
        readable(section.resource, `${spath}.resource`);
        if (section.order) {
          const sortable = listed.list?.sortable ?? [];
          if (section.order.length !== 1)
            error(
              "M097",
              `section order takes exactly one [field, direction] pair: the list sorts by one field`,
              `${spath}.order`
            );
          else if (!sortable.includes(section.order[0][0]))
            error(
              "M097",
              `section order field ${section.order[0][0]} is not in list.sortable of ${section.resource}`,
              `${spath}.order`
            );
        }
        if (section.create && !listed.operations.includes("create"))
          error(
            "M097",
            `section ${section.resource} has create: true, which needs a create operation on the resource`,
            `${spath}.create`
          );
        const listedEntity = model.entities[listed.entity];
        for (const f of section.columns ?? []) {
          const field = listedEntity?.fields[f];
          if (!field) error("M083", `columns field ${f} does not exist on ${listed.entity}`, `${spath}.columns`);
          else if (field.hidden || field.type === "bytes")
            error("M083", `columns field ${f} is never returned by the API`, `${spath}.columns`);
        }
      }
    }
    if (tenancy && tenantUses.length) {
      if (!Object.values(model.resources).some(r => r.entity === tenancy.entity && r.operations.includes("list")))
        error(
          "M098",
          `{tenant.id} needs a resource with a list operation over ${tenancy.entity}: the switcher lists the user's tenants from it`,
          tenantUses[0]
        );
      if (!model.app.sidebar)
        error("M098", `{tenant.id} needs app.sidebar: the tenant switcher sits in its header`, tenantUses[0]);
    }
    for (const [i, item] of (model.app.sidebar?.items ?? []).entries()) {
      const target = pages[item.page];
      if (!target)
        error("M080", `sidebar item page ${item.page} is not declared in app.pages`, `app.sidebar.items[${i}]`);
      else if (target.kind === "detail")
        error(
          "M096",
          `sidebar item page ${item.page} is a detail page, which needs a row; a sidebar item names a page without a parameter`,
          `app.sidebar.items[${i}]`
        );
    }
  }

  const actors = new Set(Object.keys(model.examples?.actors ?? {}));
  const checkStep = (
    step: { as?: string; op: string; path?: Record<string, string>; body?: unknown },
    spath: string
  ) => {
    if (step.as && !actors.has(step.as)) error("M070", `actor ${step.as} is not declared in examples.actors`, spath);
    const resolved = resolveStepOp(model, step.op);
    const needsId =
      (resolved.kind === "resource" && ["get", "update", "delete"].includes(resolved.operation)) ||
      (resolved.kind === "action" &&
        resolved.resource !== undefined &&
        (model.resources[resolved.resource].actions?.[resolved.action]?.scope ?? "row") === "row") ||
      (resolved.kind === "file" && resolved.operation === "get");
    if (needsId && !step.path?.id) error("M072", `${step.op} is about one row and needs path: { id: ... }`, spath);
    if (resolved.kind === "unknown") error("M071", resolved.reason, spath);
    if (resolved.kind === "timer" && model.timers.length === 0)
      error("M135", `timers.run needs timers in the model`, spath);
    if (resolved.kind === "schedule") {
      const run = (step.body as { run?: unknown } | undefined)?.run;
      if (typeof run !== "string") error("M136", `schedules.run needs body: { run: <the scheduled action> }`, spath);
      else if (!model.schedules.some(sch => sch.run === run))
        error(
          "M136",
          `schedules.run: ${run} is not scheduled (schedules: ${model.schedules.map(sch => sch.run).join(", ") || "none"})`,
          spath
        );
    } else if (resolved.kind === "auth" && !model.auth) error("M073", `auth steps need auth to be configured`, spath);
    else if (
      resolved.kind === "auth" &&
      (resolved.operation === "register" || resolved.operation === "login") &&
      !providers.includes("credentials")
    )
      error("M120", `auth.${resolved.operation} needs the credentials provider`, spath);
    else if (
      resolved.kind === "auth" &&
      resolved.operation.startsWith("magic_link") &&
      !providers.includes("magic_link")
    )
      error("M121", `${step.op} needs the magic_link provider`, spath);
    else if (resolved.kind === "auth" && (resolved.operation === "invite" || resolved.operation === "invite_accept")) {
      if (!model.auth?.invites) error("M121", `${step.op} needs auth.invites`, spath);
      else if (!step.path?.token) error("M072", `${step.op} is about one invite and needs path: { token: ... }`, spath);
    }
    if (
      resolved.kind === "auth" &&
      resolved.operation === "login" &&
      model.auth &&
      !model.auth.invites &&
      step.body &&
      typeof step.body === "object" &&
      "invite" in step.body
    )
      error("M121", `invite on ${step.op} needs auth.invites`, spath);
  };
  // "{name}" in a step resolves to what an earlier step of the same scenario captured; "{actor.id}" to the step's actor
  const templatesIn = (value: unknown, out: string[] = []): string[] => {
    if (typeof value === "string") for (const m of value.matchAll(/\{([a-zA-Z0-9_.]+)\}/g)) out.push(m[1]);
    else if (Array.isArray(value)) for (const v of value) templatesIn(v, out);
    else if (value && typeof value === "object") for (const v of Object.values(value)) templatesIn(v, out);
    return out;
  };
  const checkTemplates = (
    steps: {
      as?: string;
      path?: unknown;
      query?: unknown;
      body?: unknown;
      expect?: unknown;
      capture?: Record<string, string>;
    }[],
    base: string
  ) => {
    const captured = new Set<string>();
    for (const [ti, step] of steps.entries()) {
      const spath = `${base}[${ti}]`;
      const expectBody =
        step.expect && typeof step.expect === "object" ? (step.expect as { body?: unknown }).body : undefined;
      for (const name of new Set(templatesIn([step.path, step.query, step.body, expectBody]))) {
        if (/^now([+-]\d+[mhd])?$/.test(name)) continue;
        if (name === "actor.id") {
          if (!step.as) error("M077", `{actor.id} needs the step to act as someone (as: <actor>)`, spath);
        } else if (name.startsWith("actor.") || !captured.has(name.split(".")[0]))
          error(
            "M077",
            `{${name}} is not captured by an earlier step of this scenario; only captured names and {actor.id} resolve (actors are not addressable by name: capture an id from auth.me or a create response first)`,
            spath
          );
      }
      for (const name of Object.keys(step.capture ?? {})) captured.add(name);
    }
  };
  for (const [si, scenario] of (model.examples?.scenarios ?? []).entries()) {
    for (const [ti, step] of scenario.steps.entries()) checkStep(step, `examples.scenarios[${si}].steps[${ti}]`);
    checkTemplates(scenario.steps, `examples.scenarios[${si}].steps`);
  }
  for (const [ti, step] of (model.examples?.seed ?? []).entries()) checkStep(step, `examples.seed[${ti}]`);
  checkTemplates(model.examples?.seed ?? [], "examples.seed");

  return out;
}

function checkActionFields(
  action: Action,
  apath: string,
  error: (code: string, message: string, path: string) => void
) {
  const fields = { ...(action.input ?? {}), ...(typeof action.returns === "object" ? action.returns : {}) };
  for (const [name, field] of Object.entries(fields)) {
    if (field.primary || field.hidden || field.relation || field.type === "file" || field.type === "bytes")
      error("M090", `action field ${name} cannot be primary, hidden, a relation, a file or bytes`, `${apath}.${name}`);
    if (name === "id") error("M090", `action field id is reserved for the row's id`, `${apath}.${name}`);
  }
}

/** The providers a model signs users in with, in declared order */
export function authProviders(model: Model): string[] {
  if (!model.auth) return [];
  const list = model.auth.providers ?? ["credentials"];
  return list.map(p => (typeof p === "string" ? p : "oauth"));
}

export type ResolvedStepOp =
  | { kind: "resource"; resource: string; operation: Operation }
  | { kind: "action"; resource?: string; action: string }
  | { kind: "auth"; operation: (typeof AUTH_STEP_OPS)[number] }
  | { kind: "file"; operation: (typeof FILE_STEP_OPS)[number] }
  | { kind: "timer"; operation: (typeof TIMER_STEP_OPS)[number] }
  | { kind: "schedule"; operation: (typeof SCHEDULE_STEP_OPS)[number] }
  | { kind: "email"; operation: (typeof EMAIL_STEP_OPS)[number] }
  | { kind: "unknown"; reason: string };

/** What a step's `op` names in this model */
export function resolveStepOp(model: Model, op: string): ResolvedStepOp {
  const [ns, name] = op.split(".");
  if (ns === "auth") {
    if ((AUTH_STEP_OPS as readonly string[]).includes(name)) return { kind: "auth", operation: name as never };
    return { kind: "unknown", reason: `auth has no operation ${name}` };
  }
  if (ns === "files") {
    if ((FILE_STEP_OPS as readonly string[]).includes(name)) return { kind: "file", operation: name as never };
    return { kind: "unknown", reason: `files has no operation ${name}` };
  }
  if (ns === "timers") {
    if ((TIMER_STEP_OPS as readonly string[]).includes(name)) return { kind: "timer", operation: name as never };
    return { kind: "unknown", reason: `timers has no operation ${name}; use timers.run` };
  }
  if (ns === "schedules") {
    if ((SCHEDULE_STEP_OPS as readonly string[]).includes(name)) return { kind: "schedule", operation: name as never };
    return { kind: "unknown", reason: `schedules has no operation ${name}; use schedules.run` };
  }
  if (ns === "emails") {
    if ((EMAIL_STEP_OPS as readonly string[]).includes(name)) return { kind: "email", operation: name as never };
    return { kind: "unknown", reason: `emails has no operation ${name}; use emails.sent` };
  }
  if (ns === "actions") {
    if (model.actions[name]) return { kind: "action", action: name };
    return { kind: "unknown", reason: `action ${name} does not exist` };
  }
  const resource = model.resources[ns];
  if (!resource) return { kind: "unknown", reason: `resource ${ns} does not exist` };
  if ((OPERATIONS as readonly string[]).includes(name)) {
    if (!resource.operations.includes(name as Operation))
      return { kind: "unknown", reason: `resource ${ns} has no ${name} operation` };
    return { kind: "resource", resource: ns, operation: name as Operation };
  }
  if (resource.actions?.[name]) return { kind: "action", resource: ns, action: name };
  return { kind: "unknown", reason: `resource ${ns} has no operation or action ${name}` };
}

/** The URL path of a page that declares none: its name with underscores as dashes */
/** A page's path: its own, or the default from its name; a detail page's default ends in the :id parameter */
export function pagePathOf(pageName: string, page: { kind?: string; path?: string }): string {
  if (page.path) return page.path;
  return page.kind === "detail" ? `${defaultPagePath(pageName)}/:id` : defaultPagePath(pageName);
}

/** The path a detail page's path hangs under: /channels for /channels/:id */
export function detailBasePath(path: string): string | undefined {
  return path.endsWith("/:id") && path.length > 4 ? path.slice(0, -4) : undefined;
}

/**
 * The resource page whose generated detail a detail page takes over: the page at its path without /:id, when
 * both are over one resource. The detail page then renders inside that page, behind its gate.
 */
export function takenOverPage(pages: Record<string, Page>, pageName: string): string | undefined {
  const page = pages[pageName];
  if (!page || page.kind !== "detail") return undefined;
  const base = detailBasePath(pagePathOf(pageName, page));
  if (!base) return undefined;
  for (const [name, other] of Object.entries(pages))
    if (other.kind === "resource" && other.resource === page.resource && pagePathOf(name, other) === base) return name;
  return undefined;
}

export function defaultPagePath(pageName: string): string {
  return `/${pageName.replace(/_/g, "-")}`;
}

export function primaryKeyFields(entity: Entity): string[] {
  const declared = Object.entries(entity.fields)
    .filter(([, f]) => f.primary)
    .map(([n]) => n);
  if (declared.length > 0) return declared;
  return entity.fields.id ? ["id"] : [];
}

/** Forward relation names declared on the entity plus reverse names other entities point at it with. */
export function relationNamesOf(model: Model, entityName: string): string[] {
  const names: string[] = [];
  const entity = model.entities[entityName];
  if (!entity) return names;
  for (const [fieldName, field] of Object.entries(entity.fields)) {
    if (field.relation)
      names.push(field.relation.name ?? (fieldName.endsWith("_id") ? fieldName.slice(0, -3) : fieldName));
  }
  for (const other of Object.values(model.entities)) {
    for (const field of Object.values(other.fields)) {
      if (field.relation?.entity === entityName && field.relation.reverse) names.push(field.relation.reverse);
    }
  }
  return names;
}

export function parseModel(input: unknown): Model {
  return Model.parse(input);
}

export class ModelError extends Error {
  constructor(
    message: string,
    public readonly diagnostics: Diagnostic[]
  ) {
    super(message);
    this.name = "ModelError";
  }
}

/** Parse and validate; throws ModelError with every problem listed. */
export function loadModel(input: unknown): Model {
  const parsed = Model.safeParse(input);
  if (!parsed.success) {
    const diagnostics = parsed.error.issues.map<Diagnostic>(i => ({
      level: "error",
      code: "M000",
      message: i.message,
      path: i.path.join(".")
    }));
    throw new ModelError(`model is invalid:\n${formatDiagnostics(diagnostics)}`, diagnostics);
  }
  const diagnostics = validateModel(parsed.data);
  if (diagnostics.some(d => d.level === "error"))
    throw new ModelError(`model is invalid:\n${formatDiagnostics(diagnostics)}`, diagnostics);
  return parsed.data;
}

export function formatDiagnostics(diagnostics: Diagnostic[]): string {
  return diagnostics.map(d => `  ${d.level} ${d.code} ${d.path}: ${d.message}`).join("\n");
}
