/**
 * The OSL 1.0 model: the declared state of an application.
 * `.osl/model.yaml` is written by `osl apply`, never by hand.
 */
import { z } from "zod";

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
    description: z.string().optional()
  })
  .strict()
  .superRefine((field, ctx) => {
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
/** A row condition a predicate may carry: `when <field> = <value>` or `!=`, on a field of the entity itself */
const WHEN_CLAUSE = "(?: when [a-z][a-z0-9_]* (?:=|!=) [A-Za-z0-9_.+-]+)?";
const PREDICATE_SOURCE = `${BASE_PREDICATE}${WHEN_CLAUSE}`;
/** A rule: one predicate, or alternatives joined with " or ", any of which allows */
export const RULE_PATTERN = new RegExp(`^${PREDICATE_SOURCE}(?: or ${PREDICATE_SOURCE})*$`);
export const Rule = z
  .string()
  .regex(
    RULE_PATTERN,
    "public | authenticated | none | owner:<field> | role:<value> | member:<field>[:<role>], each optionally followed by ' when <field> = <value>' (or !=); <field> may follow relation fields (project_id.owner_id); alternatives are joined with ' or '"
  );
export type Rule = z.infer<typeof Rule>;

/** The row condition of a predicate, as written: `when published = true` */
export interface RuleCondition {
  field: string;
  op: "=" | "!=";
  /** The literal as written: true, false, null, a number, an enum value or a string without spaces */
  value: string;
}

/** A predicate split into its base and its when condition, when it has one */
export function splitWhen(predicate: string): { base: string; when?: RuleCondition } {
  const m = predicate.match(/^(.*?) when ([a-z][a-z0-9_]*) (=|!=) (\S+)$/);
  return m ? { base: m[1], when: { field: m[2], op: m[3] as "=" | "!=", value: m[4] } } : { base: predicate };
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

/** The predicates of a rule: one, or the alternatives it joins with " or " */
export function rulePredicates(rule: string): string[] {
  return rule
    .split(" or ")
    .map(p => p.trim())
    .filter(Boolean);
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

/** The field an owner predicate without a path names, when the rule has one: on create it is set from the session */
export function directOwnerField(rule: string | undefined): string | undefined {
  for (const predicate of rulePredicates(rule ?? "")) {
    const parts = predicateParts(predicate);
    if (parts?.kind === "owner" && parts.path.length === 1) return parts.path[0];
  }
  return undefined;
}

export const Rules = z
  .object({ read: Rule.optional(), create: Rule.optional(), update: Rule.optional(), delete: Rule.optional() })
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
    tenancy: Tenancy.optional()
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
export const AUTH_STEP_OPS = ["register", "login", "logout", "me", "magic_link", "magic_link_verify"] as const;
export const FILE_STEP_OPS = ["upload", "get"] as const;

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

/** A URL path for a page: lower-case segments, no trailing slash */
export const PagePath = z
  .string()
  .regex(
    /^(\/|\/[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*)$/,
    "a path like /posts or /admin/users, or / for the landing page"
  );

/** Who may open a page: a plain predicate; owner and member need a row, which a page does not have */
export const PageAccess = z
  .string()
  .regex(/^(public|authenticated|role:[A-Za-z0-9_-]+)$/, "public | authenticated | role:<value>");
export type PageAccess = z.infer<typeof PageAccess>;

/** Paths the app shell owns: the home page, sign-in and settings are scaffolds, never pages. */
export const RESERVED_PAGE_PATHS = ["/login", "/settings"] as const;

export const DashboardTile = z
  .object({
    resource: ResourceName,
    /** Default: the resource's title */
    label: z.string().min(1).optional(),
    /** Equality filters from the resource's list filters, e.g. { published: true }; "{actor.id}" is the signed-in user */
    filter: z.record(Identifier, z.union([z.string(), z.number(), z.boolean()])).optional(),
    icon: IconName.optional(),
    /** One tile per value of an enum list filter, or per row of the related resource for a relation list filter */
    group_by: Identifier.optional()
  })
  .strict();
export type DashboardTile = z.infer<typeof DashboardTile>;

export const Page = z
  .object({
    /**
     * resource: a page over a resource (see layout). dashboard: count tiles and recent rows.
     * custom: a page the backend scaffolds once for you to fill in.
     */
    kind: z.enum(["resource", "dashboard", "custom"]).default("resource"),
    /** Resource the page shows; resource pages only */
    resource: ResourceName.optional(),
    /** split: the list beside the selected row. table: a sortable, filterable table with a detail page. board: cards grouped by an enum field. */
    layout: z.enum(["split", "table", "board"]).optional(),
    /** board layout: the enum field whose values are the columns; dragging a card updates it */
    group_by: Identifier.optional(),
    /** dashboard pages: the count tiles */
    tiles: z.array(DashboardTile).optional(),
    /** dashboard pages: recent rows per resource, newest first */
    recent: z
      .array(z.object({ resource: ResourceName, limit: z.number().int().positive().max(50).default(5) }).strict())
      .optional(),
    /** URL path; defaults to /<page name with underscores as dashes> */
    path: PagePath.optional(),
    /** Heading and sidebar label; defaults to the page name in Title Case */
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    /** Columns of the master list; resource pages only. Default: the first few short columns. */
    columns: z.array(Identifier).min(1).optional(),
    /** Fields shown and edited on the detail pane; resource pages only. Default: every output field. */
    fields: z.array(Identifier).min(1).optional(),
    /** Who may open the page (sidebar and route); default authenticated when auth exists, public otherwise */
    access: PageAccess.optional(),
    /** Resource pages: equality filters the list always carries, from the resource's list filters; "{actor.id}" is the signed-in user */
    filter: z.record(Identifier, z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** Refetch the page's data every this many seconds while it is open (polling) */
    refresh: z.number().int().min(5).max(3600).optional()
  })
  .strict()
  .superRefine((page, ctx) => {
    if (page.kind === "resource" && !page.resource)
      ctx.addIssue({ code: "custom", message: "resource pages need a resource" });
    if (page.kind === "resource" && page.path === "/")
      ctx.addIssue({ code: "custom", message: "a resource page cannot take /; a dashboard or custom page can" });
    if (page.kind !== "resource" && page.filter)
      ctx.addIssue({ code: "custom", message: "filter applies to resource pages; tiles carry their own" });
    if (page.kind === "custom" && page.refresh)
      ctx.addIssue({ code: "custom", message: "refresh applies to resource and dashboard pages" });
    if (page.kind !== "resource" && (page.resource || page.columns || page.fields || page.layout || page.group_by))
      ctx.addIssue({
        code: "custom",
        message: "resource, layout, group_by, columns and fields apply to resource pages"
      });
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

/** Semantic checks the Zod schema cannot express. Errors make the model unusable. */
export function validateModel(model: Model): Diagnostic[] {
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
  const checkPredicate = (full: string, entityName: string | null, rpath: string, row: boolean) => {
    const { base: predicate, when } = splitWhen(full);
    if (when) {
      if (!row || !entityName || !model.entities[entityName])
        error("M032", `rule ${full}: a when condition needs a row; drop it here`, rpath);
      else if (predicate === "none") error("M032", `none takes no when condition`, rpath);
      else {
        const f = model.entities[entityName].fields[when.field];
        if (!f) error("M032", `when field ${when.field} does not exist on ${entityName}`, rpath);
        else {
          const problem = conditionProblem(f, when.value);
          if (problem) error("M033", `when ${when.field} ${when.op} ${when.value}: ${problem}`, rpath);
        }
      }
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
      if (!f) error("M020", `${parts.kind} field ${field} does not exist on ${current}`, rpath);
      else if (!model.auth) error("M021", `${parts.kind} rules need auth to be configured`, rpath);
      else if (parts.kind === "owner") {
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
          error("M024", `member rules need auth.tenancy`, rpath);
          return;
        }
        const pointsAtTenant = f.relation?.entity === tenancy.entity || (current === tenancy.entity && f.primary);
        if (!pointsAtTenant)
          error(
            "M025",
            `member field ${field} must be a relation to ${tenancy.entity}, or the tenant's own primary key`,
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
    const predicates = rulePredicates(rule);
    if (predicates.length > 1 && predicates.includes("public"))
      warn("M029", `rule "${rule}": public allows everyone, so the other alternatives never matter`, rpath);
    for (const predicate of new Set(predicates)) checkPredicate(predicate, entityName, rpath, row);
  };

  for (const [entityName, entity] of Object.entries(model.entities)) {
    const base = `entities.${entityName}`;
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
        directOwnerField(entity.rules?.create) !== fieldName
      )
        error(
          "M065",
          `read_only field ${fieldName} is required and has no default, so nothing could ever create a row; give it a default, drop required, or set it from the session with rules.create: owner:${fieldName}`,
          fpath
        );
    }
    for (const [action, rule] of Object.entries(entity.rules ?? {})) {
      if (rule) checkRule(rule, entityName, `${base}.rules.${action}`, true);
    }
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
          `magic links and OAuth cannot register new users while ${model.auth.identity} requires ${blocking.map(([n]) => n).join(", ")}; those users must register through credentials first`,
          "auth.providers"
        );
    }
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

  if (model.app) {
    const seenPaths = new Map<string, string>();
    for (const [pageName, page] of Object.entries(model.app.pages)) {
      const base = `app.pages.${pageName}`;
      const pagePath = page.path ?? defaultPagePath(pageName);
      if ((RESERVED_PAGE_PATHS as readonly string[]).includes(pagePath))
        error("M084", `path ${pagePath} is reserved for the app shell`, `${base}.path`);
      const taken = seenPaths.get(pagePath);
      if (taken) error("M085", `path ${pagePath} is already used by page ${taken}`, `${base}.path`);
      seenPaths.set(pagePath, pageName);
      // Who may open the page: public pages can only show publicly readable data
      const access = page.access ?? (model.auth ? "authenticated" : "public");
      if (access !== "public" && !model.auth)
        error("M091", `page ${pageName} has access ${access}, which needs auth to be configured`, `${base}.access`);
      if (access.startsWith("role:") && model.auth && !model.entities[model.auth.identity]?.fields.role)
        error(
          "M091",
          `page ${pageName} has access ${access}, which needs a role field on ${model.auth.identity}`,
          `${base}.access`
        );
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
      const checkFilter = (resourceName: string, filter: Record<string, unknown> | undefined, where: string) => {
        const resource = model.resources[resourceName];
        const entity = resource && model.entities[resource.entity];
        if (!resource || !entity) return;
        for (const [key, value] of Object.entries(filter ?? {})) {
          if (!(resource.list?.filters ?? []).includes(key)) {
            error("M089", `filter ${key} is not a list filter of ${resourceName}`, where);
            continue;
          }
          if (value !== "{actor.id}") continue;
          const field = entity.fields[key];
          const toIdentity =
            model.auth &&
            field &&
            (field.relation?.entity === model.auth.identity ||
              (resource.entity === model.auth.identity && primaryKeyFields(entity).includes(key)));
          if (!toIdentity)
            error("M089", `filter ${key} cannot be {actor.id}: it is not a relation to the identity entity`, where);
          if (publicPage)
            error(
              "M092",
              `page ${pageName} filters by {actor.id} but is public; give it access: authenticated or a role`,
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
          const resource = model.resources[recent.resource];
          if (!resource || !resource.operations.includes("list"))
            error("M088", `recent resource ${recent.resource} needs a list operation`, `${base}.recent[${ri}]`);
          else readable(recent.resource, `${base}.recent[${ri}]`);
        }
        continue;
      }
      if (page.kind !== "resource") continue;
      const resource = model.resources[page.resource!];
      if (!resource) {
        error("M081", `page resource ${page.resource} does not exist`, `${base}.resource`);
        continue;
      }
      if (!resource.operations.includes("list") || !resource.operations.includes("get"))
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
    }
    for (const [i, item] of (model.app.sidebar?.items ?? []).entries()) {
      if (!model.app.pages[item.page])
        error("M080", `sidebar item page ${item.page} is not declared in app.pages`, `app.sidebar.items[${i}]`);
    }
  }

  const actors = new Set(Object.keys(model.examples?.actors ?? {}));
  const checkStep = (step: { as?: string; op: string; path?: Record<string, string> }, spath: string) => {
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
    else if (resolved.kind === "auth" && !model.auth) error("M073", `auth steps need auth to be configured`, spath);
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
