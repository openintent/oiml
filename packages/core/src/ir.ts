/**
 * IR v2: the fully resolved, framework-neutral form of a model.
 * Every default is explicit here so backends never infer anything.
 */
import { hashValue } from "./canonical.js";
import {
  AUTH_STEP_OPS,
  EVENT_ON_PATTERN,
  OAUTH_PRESETS,
  defaultPagePath,
  loadModel,
  predicateParts,
  primaryKeyFields,
  resolveStepOp,
  rulePredicates,
  type Action,
  type Entity,
  type Field,
  type Model,
  type Rule,
  type Validate
} from "./model.js";
import { defaultTableName, relationNameFromColumn, toSnakeCase, toTitleCase } from "./naming.js";

export type Scalar =
  | "string"
  | "text"
  | "integer"
  | "bigint"
  | "float"
  | "decimal"
  | "boolean"
  | "datetime"
  | "date"
  | "time"
  | "uuid"
  | "json"
  | "bytes";

export type TypeIR =
  | { kind: "scalar"; scalar: Scalar }
  | { kind: "enum"; name: string }
  | { kind: "array"; of: Scalar }
  /** A stored file: the column holds a JSON snapshot { id, key, name, size, type } of an osl_files row */
  | { kind: "file"; accept?: string[]; maxSize?: number };

export type DefaultIR = { kind: "now" } | { kind: "uuid" } | { kind: "literal"; value: string | number | boolean };

export interface ColumnIR {
  name: string;
  type: TypeIR;
  nullable: boolean;
  unique: boolean;
  primary: boolean;
  hidden: boolean;
  default?: DefaultIR;
  /** Database-generated integer identity */
  generated?: "identity";
  maxLength?: number;
  validate?: Validate;
  description?: string;
  /** Relation name when this column is a foreign key */
  relation?: string;
  /** Enum values for columns that are not stored (action inputs and results), where no database enum exists */
  enumValues?: string[];
}

export interface ForeignKeyIR {
  name: string;
  column: string;
  targetEntity: string;
  targetTable: string;
  targetColumn: string;
  onDelete: "restrict" | "cascade" | "set_null";
}

export interface RelationIR {
  name: string;
  /** How many rows this side sees */
  kind: "one" | "many";
  direction: "forward" | "reverse";
  target: string;
  /** Foreign key column: on this entity for forward, on the target for reverse */
  column: string;
  /** Column the foreign key points at */
  targetColumn: string;
}

/** One step of a rule that follows a relation: the column on the entity it starts from and the row it reaches */
export interface RuleHopIR {
  /** The relation column on the entity the hop starts from */
  column: string;
  /** The entity the column points at */
  entity: string;
  table: string;
  /** The column it points at: that entity's primary key */
  targetColumn: string;
}

export type RuleIR =
  | { kind: "public" }
  | { kind: "authenticated" }
  | { kind: "none" }
  /** The row's `field` is the session's user; with `via`, `field` is on the row the hops reach */
  | { kind: "owner"; field: string; via?: RuleHopIR[] }
  | { kind: "role"; value: string }
  /** The user has a membership of the tenant in `field` (with at least `role`, by the membership's enum order); with `via`, `field` is on the row the hops reach */
  | { kind: "member"; field: string; role?: string; via?: RuleHopIR[] }
  /** Any of the alternatives allows */
  | { kind: "any"; rules: RuleIR[] };

export type RowRuleIR = Extract<RuleIR, { kind: "owner" | "member" }>;

/** The alternatives of a rule: the rule itself, or the rules an `any` lists */
export function ruleAlternatives(rule: RuleIR): RuleIR[] {
  return rule.kind === "any" ? rule.rules.flatMap(ruleAlternatives) : [rule];
}

/** The alternatives that are about a row (owner and member), in order */
export function rowRules(rule: RuleIR): RowRuleIR[] {
  return ruleAlternatives(rule).filter((r): r is RowRuleIR => r.kind === "owner" || r.kind === "member");
}

/** The alternatives a session can satisfy without a row: public, authenticated and role */
export function openRules(rule: RuleIR): RuleIR[] {
  return ruleAlternatives(rule).filter(r => r.kind === "public" || r.kind === "authenticated" || r.kind === "role");
}

/** The key the generated code keeps a row rule's value under when it checks a row: the column, or the dotted path */
export function ruleKey(rule: RowRuleIR): string {
  return [...(rule.via ?? []).map(h => h.column), rule.field].join(".");
}

/** The field an owner alternative without a path names: set from the session on create, never written by a client */
export function directOwnerOf(rule: RuleIR): string | undefined {
  const owner = ruleAlternatives(rule).find(r => r.kind === "owner" && !r.via);
  return owner?.kind === "owner" ? owner.field : undefined;
}

/** The rule as the model writes it */
export function ruleText(rule: RuleIR): string {
  switch (rule.kind) {
    case "public":
    case "authenticated":
    case "none":
      return rule.kind;
    case "owner":
      return `owner:${ruleKey(rule)}`;
    case "role":
      return `role:${rule.value}`;
    case "member":
      return `member:${ruleKey(rule)}${rule.role ? `:${rule.role}` : ""}`;
    case "any":
      return rule.rules.map(ruleText).join(" or ");
  }
}

export interface EntityIR {
  name: string;
  table: string;
  description?: string;
  primaryKey: string[];
  columns: ColumnIR[];
  foreignKeys: ForeignKeyIR[];
  uniques: { name: string; columns: string[] }[];
  indexes: { name: string; columns: string[]; unique: boolean }[];
  relations: RelationIR[];
  rules: { read: RuleIR; create: RuleIR; update: RuleIR; delete: RuleIR };
  /** The column that names a row to a person: the first short string column, else the primary key */
  display: string;
  /** Owned by OSL (files, auth tokens): migrated and checked for drift, never exposed as a resource or page */
  system?: boolean;
}

export interface EnumIR {
  name: string;
  entity: string;
  field: string;
  values: string[];
}

export type OperationIR =
  | {
      kind: "list";
      method: "GET";
      path: string;
      filters: string[];
      order: [string, "asc" | "desc"][];
      pageSize: number;
      include: string[];
      /** Fields a client may sort by with `sort=<field>:asc|desc` */
      sortable: string[];
      /** Fields `q` searches as a case-insensitive substring */
      search: string[];
      rule: RuleIR;
    }
  | { kind: "get"; method: "GET"; path: string; include: string[]; rule: RuleIR }
  | { kind: "create"; method: "POST"; path: string; fields: string[]; ownerField?: string; rule: RuleIR }
  | { kind: "update"; method: "PATCH"; path: string; fields: string[]; rule: RuleIR }
  | { kind: "delete"; method: "DELETE"; path: string; rule: RuleIR };

export interface ResourceIR {
  name: string;
  entity: string;
  path: string;
  description?: string;
  /** Columns returned by every operation */
  outputFields: string[];
  operations: OperationIR[];
}

export type ActionReturnsIR = { kind: "entity" } | { kind: "none" } | { kind: "fields"; fields: ColumnIR[] };

export interface ActionIR {
  name: string;
  description?: string;
  /** The resource and entity a row or collection action belongs to */
  resource?: string;
  entity?: string;
  /** row: POST <resource>/{id}/<name> with the row loaded. collection: POST <resource>/<name>. global: POST /api/actions/<name>. */
  scope: "row" | "collection" | "global";
  method: "POST";
  /** With `{id}` for row actions */
  path: string;
  input: ColumnIR[];
  rule: RuleIR;
  returns: ActionReturnsIR;
  /** The user-owned handler module name under src/actions */
  handler: string;
}

export type ProviderIR =
  | { kind: "credentials" }
  | { kind: "magic_link" }
  | { kind: "oauth"; provider: (typeof OAUTH_PRESETS)[number] | "oidc"; name: string; issuer?: string };

export interface TenancyIR {
  entity: string;
  table: string;
  membership: string;
  membershipTable: string;
  /** Membership columns pointing at the identity and the tenant */
  userColumn: string;
  tenantColumn: string;
  roleColumn: string;
  /** Roles from most to least privileged, as declared on the membership's enum */
  roles: string[];
  creatorRole: string;
}

export interface AuthIR {
  identity: string;
  identityTable: string;
  /** 1.0 field: the first provider; `providers` has them all */
  provider: "credentials" | "magic_link" | "oauth";
  providers: ProviderIR[];
  emailColumn: string;
  /** The hidden hash column; only added to the identity when credentials are a provider */
  passwordColumn: string;
  sessionDays: number;
  /** Columns register accepts besides email and password */
  registerFields: string[];
  /** Whether magic links and OAuth may create a user: no required identity column besides email and name */
  registerable: boolean;
  /** A string `name` column on the identity, filled from an OAuth profile */
  nameColumn?: string;
  tenancy?: TenancyIR;
}

export interface FilesIR {
  upload: RuleIR;
  read: RuleIR;
}

export interface EventIR {
  name: string;
  handler: string;
  delivery: "inline" | "queue";
  kind: "entity" | "action";
  /** entity events: the entity and what happened; action events: the action's entity when it has one */
  entity?: string;
  action?: "created" | "updated" | "deleted";
  /** action events */
  resource?: string;
  actionName?: string;
}

export interface StepIR {
  name?: string;
  as?: string;
  op: string;
  kind: "resource" | "action" | "auth" | "file";
  resource?: string;
  /** resource steps: the operation; action steps: the action name; auth and file steps: their operation */
  operation: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path with `{param}` placeholders */
  pathTemplate: string;
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  expect: { status: number; body?: unknown };
  capture: Record<string, string>;
}

export type SeedStepIR = Omit<StepIR, "expect">;

export interface ActorIR {
  email: string;
  password: string;
  /** What register accepts besides email and password */
  fields: Record<string, unknown>;
  /** Identity columns register refuses (role): the harness and seed write them straight into the database after registering */
  provisioned: Record<string, unknown>;
}

export interface ExamplesIR {
  actors: Record<string, ActorIR>;
  scenarios: { name: string; steps: StepIR[] }[];
  seed: SeedStepIR[];
}

export interface TileIR {
  resource: string;
  label: string;
  filter: Record<string, string | number | boolean>;
  icon?: string;
}

export interface PageIR {
  name: string;
  kind: "resource" | "dashboard" | "custom";
  /** Resource pages: the resource and its entity */
  resource?: string;
  entity?: string;
  /** Resource pages: how the rows are shown */
  layout?: "split" | "table" | "board";
  /** board layout: the enum column whose values are the columns */
  groupBy?: string;
  path: string;
  title: string;
  description?: string;
  /** Resource pages: columns of the master list */
  columns: string[];
  /** Resource pages: fields of the detail pane, in order */
  fields: string[];
  /** Dashboard pages */
  tiles: TileIR[];
  recent: { resource: string; limit: number }[];
}

export interface SidebarItemIR {
  page: string;
  path: string;
  label: string;
  /** lucide icon name in kebab-case */
  icon?: string;
}

export interface SidebarIR {
  items: SidebarItemIR[];
  /** `user` is false when the model has no auth, whatever the sidebar asked for */
  footer: { user: boolean; settings: boolean };
}

export interface AppIR {
  title: string;
  pages: PageIR[];
  sidebar?: SidebarIR;
}

export interface IR {
  version: "2.0";
  name: string;
  description?: string;
  dialect: "postgres";
  hash: string;
  auth?: AuthIR;
  /** Present when any entity has a file field */
  files?: FilesIR;
  enums: EnumIR[];
  entities: EntityIR[];
  resources: ResourceIR[];
  /** Every action, resource-bound ones with `resource` set */
  actions: ActionIR[];
  events: EventIR[];
  /** Present when any event is delivered through the queue */
  jobs?: { queue: true };
  examples: ExamplesIR;
  app?: AppIR;
}

const SCALARS = new Set<string>([
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
  "bytes"
]);

/**
 * Parse a rule. `hops` resolves the relation fields an owner or member path follows (every segment but the
 * last) from the entity the rule is on; without it a path is treated as a plain field.
 */
export function parseRule(rule: Rule | undefined, fallback: RuleIR, hops?: (path: string[]) => RuleHopIR[]): RuleIR {
  if (!rule) return fallback;
  const predicates = rulePredicates(rule);
  if (predicates.length > 1) return { kind: "any", rules: predicates.map(p => parsePredicate(p, hops)) };
  return parsePredicate(predicates[0], hops);
}

function parsePredicate(predicate: string, hops?: (path: string[]) => RuleHopIR[]): RuleIR {
  const parts = predicateParts(predicate);
  if (parts) {
    const field = parts.path[parts.path.length - 1];
    const via = parts.path.length > 1 && hops ? hops(parts.path.slice(0, -1)) : [];
    const out: RowRuleIR =
      parts.kind === "owner"
        ? { kind: "owner", field }
        : parts.role !== undefined
          ? { kind: "member", field, role: parts.role }
          : { kind: "member", field };
    if (via.length) out.via = via;
    return out;
  }
  if (predicate.startsWith("role:")) return { kind: "role", value: predicate.slice(5) };
  return { kind: predicate as "public" | "authenticated" | "none" };
}

function enumTypeName(entityName: string, fieldName: string): string {
  return `${toSnakeCase(entityName)}_${fieldName}`;
}

function columnType(entityName: string, fieldName: string, field: Field): TypeIR {
  if (field.type === "enum") return { kind: "enum", name: enumTypeName(entityName, fieldName) };
  if (field.type === "array") return { kind: "array", of: field.array_type as Scalar };
  if (field.type === "file") {
    const type: TypeIR = { kind: "file" };
    if (field.file?.accept) type.accept = field.file.accept;
    if (field.file?.max_size) type.maxSize = field.file.max_size;
    return type;
  }
  if (!SCALARS.has(field.type)) throw new Error(`unknown field type ${field.type}`);
  return { kind: "scalar", scalar: field.type as Scalar };
}

function columnDefault(field: Field): DefaultIR | undefined {
  if (field.default === undefined) return undefined;
  if (field.default === "now" && field.type === "datetime") return { kind: "now" };
  if (field.default === "uuid" && field.type === "uuid") return { kind: "uuid" };
  return { kind: "literal", value: field.default };
}

const NO_RULES = { read: "none", create: "none", update: "none", delete: "none" } as const;

/** The entities OSL owns for files and sign-in, present only when the model needs them */
export function systemEntities(model: Model): Record<string, Entity> {
  const out: Record<string, Entity> = {};
  const hasFiles = Object.values(model.entities).some(e => Object.values(e.fields).some(f => f.type === "file"));
  const identityName = model.auth?.identity;
  const identity = identityName ? model.entities[identityName] : undefined;
  const identityKeyType = identity ? identity.fields[primaryKeyFields(identity)[0]].type : "uuid";
  const userRelation = (name: string, onDelete: "cascade" | "set_null"): Field => ({
    type: identityKeyType,
    required: onDelete === "cascade",
    relation: { entity: identityName!, kind: "many_to_one", name, on_delete: onDelete }
  });
  const providers = model.auth?.providers ?? (model.auth ? ["credentials"] : []);
  const magicLink = providers.includes("magic_link");
  const oauth = providers.some(p => typeof p === "object");

  if (hasFiles) {
    out.OslFile = {
      table: "osl_files",
      description: "An uploaded file; file fields hold a snapshot of this row",
      fields: {
        id: { type: "uuid", primary: true },
        key: { type: "string", max_length: 500, required: true, unique: true },
        name: { type: "string", max_length: 255, required: true },
        size: { type: "integer", required: true },
        type: { type: "string", max_length: 255, required: true },
        status: { type: "enum", enum_values: ["pending", "ready"], required: true, default: "pending" },
        ...(identity ? { owner_id: userRelation("owner", "set_null") } : {}),
        created_at: { type: "datetime", required: true, default: "now" }
      },
      rules: { ...NO_RULES }
    };
  }
  if (magicLink) {
    out.OslAuthToken = {
      table: "osl_auth_tokens",
      description: "One-time sign-in tokens, stored hashed",
      fields: {
        id: { type: "uuid", primary: true },
        token_hash: { type: "string", max_length: 255, required: true, unique: true },
        email: { type: "string", max_length: 255, required: true },
        purpose: { type: "enum", enum_values: ["magic_link"], required: true },
        expires_at: { type: "datetime", required: true },
        created_at: { type: "datetime", required: true, default: "now" }
      },
      rules: { ...NO_RULES }
    };
  }
  if (oauth) {
    out.OslAuthState = {
      table: "osl_auth_states",
      description: "Pending OAuth authorisations, stored hashed",
      fields: {
        id: { type: "uuid", primary: true },
        state_hash: { type: "string", max_length: 255, required: true, unique: true },
        provider: { type: "string", max_length: 50, required: true },
        code_verifier: { type: "string", max_length: 255 },
        nonce: { type: "string", max_length: 255 },
        redirect_to: { type: "string", max_length: 500 },
        expires_at: { type: "datetime", required: true },
        created_at: { type: "datetime", required: true, default: "now" }
      },
      rules: { ...NO_RULES }
    };
    out.OslAuthAccount = {
      table: "osl_auth_accounts",
      description: "Which provider account signs in as which user",
      fields: {
        id: { type: "uuid", primary: true },
        provider: { type: "string", max_length: 50, required: true },
        provider_account_id: { type: "string", max_length: 255, required: true },
        user_id: userRelation("user", "cascade"),
        created_at: { type: "datetime", required: true, default: "now" }
      },
      unique: [["provider", "provider_account_id"]],
      rules: { ...NO_RULES }
    };
  }
  return out;
}

/** Compile a validated model into IR. Throws ModelError on an invalid model. */
export function compile(input: Model): IR {
  const model = loadModel(input);
  const enums: EnumIR[] = [];
  const entities: EntityIR[] = [];
  const system = systemEntities(model);
  const allEntities: Record<string, Entity> = { ...model.entities, ...system };

  const defaultRules: EntityIR["rules"] = model.auth
    ? {
        read: { kind: "public" },
        create: { kind: "authenticated" },
        update: { kind: "authenticated" },
        delete: { kind: "authenticated" }
      }
    : { read: { kind: "public" }, create: { kind: "public" }, update: { kind: "public" }, delete: { kind: "public" } };

  const tableOf = (name: string) => allEntities[name].table ?? defaultTableName(name);
  const pkOf = (name: string) => primaryKeyFields(allEntities[name]);
  /** The hops a rule path takes from `entityName` through its relation fields */
  const hopsFrom = (entityName: string, path: string[]): RuleHopIR[] => {
    const out: RuleHopIR[] = [];
    let current = entityName;
    for (const column of path) {
      const target = allEntities[current].fields[column].relation!.entity;
      out.push({ column, entity: target, table: tableOf(target), targetColumn: pkOf(target)[0] });
      current = target;
    }
    return out;
  };
  const providers = model.auth?.providers ?? (model.auth ? ["credentials"] : []);
  const hasCredentials = providers.includes("credentials");

  /** Compile a field into a column; `stored` false for action fields, whose enums are not database types */
  const compileColumn = (
    owner: string,
    fieldName: string,
    field: Field,
    primaryKey: string[],
    stored: boolean
  ): ColumnIR => {
    const isPrimary = primaryKey.includes(fieldName);
    const type = columnType(owner, fieldName, field);
    if (type.kind === "enum" && stored)
      enums.push({ name: type.name, entity: owner, field: fieldName, values: field.enum_values! });
    const column: ColumnIR = {
      name: fieldName,
      type,
      nullable: !isPrimary && !field.required,
      unique: Boolean(field.unique) && !isPrimary,
      primary: isPrimary,
      hidden: Boolean(field.hidden)
    };
    if (type.kind === "enum" && !stored) column.enumValues = field.enum_values!;
    const def = columnDefault(field);
    if (def) column.default = def;
    if (isPrimary && primaryKey.length === 1 && !def) {
      if (field.type === "uuid") column.default = { kind: "uuid" };
      else if (field.type === "integer" || field.type === "bigint") column.generated = "identity";
    }
    if (field.max_length) column.maxLength = field.max_length;
    else if (field.type === "string") column.maxLength = 255;
    if (field.validate) column.validate = field.validate;
    if (field.description) column.description = field.description;
    return column;
  };

  for (const [entityName, entity] of Object.entries(allEntities)) {
    const table = tableOf(entityName);
    const primaryKey = pkOf(entityName);
    const columns: ColumnIR[] = [];
    const foreignKeys: ForeignKeyIR[] = [];
    const relations: RelationIR[] = [];
    const isSystem = entityName in system;

    for (const [fieldName, field] of Object.entries(entity.fields)) {
      const column = compileColumn(entityName, fieldName, field, primaryKey, true);
      if (field.relation) {
        const targetTable = tableOf(field.relation.entity);
        const targetColumn = pkOf(field.relation.entity)[0];
        const relationName = field.relation.name ?? relationNameFromColumn(fieldName);
        column.relation = relationName;
        foreignKeys.push({
          name: `${table}_${fieldName}_fkey`,
          column: fieldName,
          targetEntity: field.relation.entity,
          targetTable,
          targetColumn,
          onDelete: field.relation.on_delete
        });
        relations.push({
          name: relationName,
          kind: "one",
          direction: "forward",
          target: field.relation.entity,
          column: fieldName,
          targetColumn
        });
      }
      columns.push(column);
    }

    if (model.auth?.identity === entityName && hasCredentials) {
      columns.push({
        name: model.auth.password_field,
        type: { kind: "scalar", scalar: "string" },
        nullable: true,
        unique: false,
        primary: false,
        hidden: true,
        maxLength: 255,
        description: "Password hash managed by auth"
      });
    }

    const uniques = (entity.unique ?? []).map(cols => ({ name: `${table}_${cols.join("_")}_key`, columns: cols }));
    const indexes = (entity.indexes ?? []).map(i => ({
      name: i.name ?? `${table}_${i.fields.join("_")}_idx`,
      columns: i.fields,
      unique: i.unique
    }));
    for (const fk of foreignKeys) {
      const covered =
        indexes.some(i => i.columns.length === 1 && i.columns[0] === fk.column) ||
        columns.find(c => c.name === fk.column)?.unique;
      if (!covered) indexes.push({ name: `${table}_${fk.column}_idx`, columns: [fk.column], unique: false });
    }

    const compiled: EntityIR = {
      name: entityName,
      table,
      description: entity.description,
      primaryKey,
      columns,
      foreignKeys,
      uniques,
      indexes,
      relations,
      rules: {
        read: parseRule(entity.rules?.read, defaultRules.read, path => hopsFrom(entityName, path)),
        create: parseRule(entity.rules?.create, defaultRules.create, path => hopsFrom(entityName, path)),
        update: parseRule(entity.rules?.update, defaultRules.update, path => hopsFrom(entityName, path)),
        delete: parseRule(entity.rules?.delete, defaultRules.delete, path => hopsFrom(entityName, path))
      },
      display: displayColumn(columns, primaryKey, foreignKeys)
    };
    if (isSystem) compiled.system = true;
    entities.push(compiled);
  }

  // Reverse relations
  for (const source of entities) {
    for (const fk of source.foreignKeys) {
      const field = allEntities[source.name].fields[fk.column];
      if (!field.relation?.reverse) continue;
      const target = entities.find(e => e.name === fk.targetEntity)!;
      target.relations.push({
        name: field.relation.reverse,
        kind: field.relation.kind === "one_to_one" ? "one" : "many",
        direction: "reverse",
        target: source.name,
        column: fk.column,
        targetColumn: fk.targetColumn
      });
    }
  }

  const entityByName = (name: string) => entities.find(e => e.name === name)!;

  let auth: AuthIR | undefined;
  if (model.auth) {
    const identity = entityByName(model.auth.identity);
    const providerIRs: ProviderIR[] = providers.map(p => {
      if (p === "credentials") return { kind: "credentials" };
      if (p === "magic_link") return { kind: "magic_link" };
      const oauth: ProviderIR = {
        kind: "oauth",
        provider: p.oauth,
        name: p.oauth === "oidc" ? (p.name ?? "oidc") : p.oauth
      };
      if (p.issuer) oauth.issuer = p.issuer;
      return oauth;
    });
    const registerFields = identity.columns
      .filter(
        c =>
          !c.primary &&
          !c.hidden &&
          !isBytes(c) &&
          c.type.kind !== "file" &&
          c.name !== model.auth!.email_field &&
          c.name !== "role" &&
          !isGeneratedDefault(c)
      )
      .map(c => c.name);
    const nameColumn = identity.columns.find(
      c => c.name === "name" && c.type.kind === "scalar" && c.type.scalar === "string"
    );
    const blocking = identity.columns.filter(
      c =>
        !c.nullable &&
        !c.primary &&
        !c.hidden &&
        c.default === undefined &&
        !c.generated &&
        c.name !== model.auth!.email_field &&
        c.name !== "name"
    );
    auth = {
      identity: model.auth.identity,
      identityTable: identity.table,
      provider: providerIRs[0].kind,
      providers: providerIRs,
      emailColumn: model.auth.email_field,
      passwordColumn: model.auth.password_field,
      sessionDays: model.auth.session_days,
      registerFields,
      registerable: blocking.length === 0
    };
    if (nameColumn) auth.nameColumn = nameColumn.name;
    if (model.auth.tenancy) {
      const t = model.auth.tenancy;
      const membership = allEntities[t.membership];
      const userColumn = Object.entries(membership.fields).find(
        ([, f]) => f.relation?.entity === model.auth!.identity
      )![0];
      const tenantColumn = Object.entries(membership.fields).find(([, f]) => f.relation?.entity === t.entity)![0];
      auth.tenancy = {
        entity: t.entity,
        table: tableOf(t.entity),
        membership: t.membership,
        membershipTable: tableOf(t.membership),
        userColumn,
        tenantColumn,
        roleColumn: t.role_field,
        roles: membership.fields[t.role_field].enum_values!,
        creatorRole: t.creator_role
      };
    }
  }

  let files: FilesIR | undefined;
  if (system.OslFile) {
    const uploadDefault: RuleIR = model.auth ? { kind: "authenticated" } : { kind: "public" };
    files = {
      upload: parseRule(model.files?.upload, uploadDefault),
      read: parseRule(model.files?.read, { kind: "public" })
    };
  }

  const resources: ResourceIR[] = [];
  const actions: ActionIR[] = [];
  const compileAction = (
    name: string,
    action: Action,
    resource: { name: string; entity: EntityIR; path: string } | null
  ): ActionIR => {
    const owner = resource ? `${resource.name}_${name}` : name;
    const scope: ActionIR["scope"] = resource ? (action.scope ?? "row") : "global";
    const inputFields = Object.entries(action.input ?? {}).map(([f, field]) =>
      compileColumn(owner, f, field, [], false)
    );
    let returns: ActionReturnsIR;
    if (action.returns === undefined) returns = scope === "row" ? { kind: "entity" } : { kind: "none" };
    else if (action.returns === "entity") returns = { kind: "entity" };
    else if (action.returns === "none") returns = { kind: "none" };
    else
      returns = {
        kind: "fields",
        fields: Object.entries(action.returns).map(([f, field]) =>
          compileColumn(`${owner}_result`, f, field, [], false)
        )
      };
    const fallback: RuleIR = resource
      ? scope === "row"
        ? resource.entity.rules.update
        : resource.entity.rules.create
      : model.auth
        ? { kind: "authenticated" }
        : { kind: "public" };
    const out: ActionIR = {
      name,
      description: action.description,
      scope,
      method: "POST",
      path: resource
        ? scope === "row"
          ? `${resource.path}/{id}/${name}`
          : `${resource.path}/${name}`
        : `/api/actions/${name}`,
      input: inputFields,
      rule: parseRule(action.rule, fallback, resource ? path => hopsFrom(resource.entity.name, path) : undefined),
      returns,
      handler: owner
    };
    if (resource) {
      out.resource = resource.name;
      out.entity = resource.entity.name;
    }
    return out;
  };

  for (const [resourceName, resource] of Object.entries(model.resources)) {
    const entity = entityByName(resource.entity);
    const path = resource.path ?? `/api/${resourceName}`;
    const writable = entity.columns
      .filter(c => !c.primary && !c.hidden && !isBytes(c) && !isGeneratedDefault(c))
      .map(c => c.name);
    const operations: OperationIR[] = [];
    for (const kind of resource.operations) {
      switch (kind) {
        case "list":
          operations.push({
            kind,
            method: "GET",
            path,
            filters: resource.list?.filters ?? [],
            order: resource.list?.order ?? defaultOrder(entity),
            pageSize: resource.list?.page_size ?? 20,
            include: resource.list?.include ?? [],
            sortable: resource.list?.sortable ?? [],
            search: resource.list?.search ?? [],
            rule: entity.rules.read
          });
          break;
        case "get":
          operations.push({
            kind,
            method: "GET",
            path: `${path}/{id}`,
            include: resource.get?.include ?? [],
            rule: entity.rules.read
          });
          break;
        case "create": {
          const rule = entity.rules.create;
          const ownerField = directOwnerOf(rule);
          const fields = (resource.create?.fields ?? writable).filter(f => f !== ownerField);
          operations.push({ kind, method: "POST", path, fields, ownerField, rule });
          break;
        }
        case "update": {
          // A plain owner rule keeps the owner column out of update, so a row cannot be handed to someone else;
          // with alternatives (an admin may reassign) the column stays writable
          const rule = entity.rules.update;
          const ownerField = ruleAlternatives(rule).length === 1 ? directOwnerOf(rule) : undefined;
          const fields = (resource.update?.fields ?? writable).filter(f => f !== ownerField);
          operations.push({ kind, method: "PATCH", path: `${path}/{id}`, fields, rule });
          break;
        }
        case "delete":
          operations.push({ kind, method: "DELETE", path: `${path}/{id}`, rule: entity.rules.delete });
          break;
      }
    }
    resources.push({
      name: resourceName,
      entity: resource.entity,
      path,
      description: resource.description,
      outputFields: entity.columns.filter(c => !c.hidden && !isBytes(c)).map(c => c.name),
      operations
    });
    for (const [actionName, action] of Object.entries(resource.actions ?? {}))
      actions.push(compileAction(actionName, action, { name: resourceName, entity, path }));
  }
  for (const [actionName, action] of Object.entries(model.actions))
    actions.push(compileAction(actionName, action, null));

  const events: EventIR[] = model.events.map(e => {
    const m = e.on.match(EVENT_ON_PATTERN)!;
    if (m[1]) {
      return {
        name: e.on,
        handler: e.handler,
        delivery: e.delivery,
        kind: "entity",
        entity: m[1],
        action: m[2] as EventIR["action"]
      };
    }
    const action = actions.find(a =>
      m[3] === "actions" ? !a.resource && a.name === m[4] : a.resource === m[3] && a.name === m[4]
    )!;
    const out: EventIR = {
      name: e.on,
      handler: e.handler,
      delivery: e.delivery,
      kind: "action",
      actionName: action.name
    };
    if (action.resource) out.resource = action.resource;
    if (action.entity) out.entity = action.entity;
    return out;
  });

  const compileStep = (step: {
    name?: string;
    as?: string;
    op: string;
    path?: Record<string, string>;
    query?: Record<string, string>;
    body?: unknown;
    capture?: Record<string, string>;
  }): SeedStepIR => {
    const target = resolveStepOp(model, step.op);
    let resolved: Pick<StepIR, "kind" | "resource" | "operation" | "method" | "pathTemplate">;
    switch (target.kind) {
      case "resource": {
        const resource = resources.find(r => r.name === target.resource)!;
        const op = resource.operations.find(o => o.kind === target.operation)!;
        resolved = {
          kind: "resource",
          resource: resource.name,
          operation: op.kind,
          method: op.method,
          pathTemplate: op.path
        };
        break;
      }
      case "action": {
        const action = actions.find(a => a.name === target.action && a.resource === target.resource)!;
        resolved = {
          kind: "action",
          resource: action.resource,
          operation: action.name,
          method: "POST",
          pathTemplate: action.path
        };
        break;
      }
      case "auth": {
        const paths: Record<(typeof AUTH_STEP_OPS)[number], string> = {
          register: "/api/auth/register",
          login: "/api/auth/login",
          logout: "/api/auth/logout",
          me: "/api/auth/me",
          magic_link: "/api/auth/magic-link",
          magic_link_verify: "/api/auth/magic-link/verify"
        };
        resolved = {
          kind: "auth",
          operation: target.operation,
          method: target.operation === "me" ? "GET" : "POST",
          pathTemplate: paths[target.operation]
        };
        break;
      }
      case "file":
        resolved =
          target.operation === "upload"
            ? { kind: "file", operation: "upload", method: "POST", pathTemplate: "/api/files" }
            : { kind: "file", operation: "get", method: "GET", pathTemplate: "/api/files/{id}" };
        break;
      case "unknown":
        throw new Error(`step ${step.op}: ${target.reason}`);
    }
    return {
      name: step.name,
      as: step.as,
      op: step.op,
      ...resolved,
      pathParams: step.path ?? {},
      query: step.query ?? {},
      body: step.body,
      capture: step.capture ?? {}
    };
  };

  const examples: ExamplesIR = { actors: {}, scenarios: [], seed: [] };
  const registerable = new Set(auth?.registerFields ?? []);
  for (const [name, actor] of Object.entries(model.examples?.actors ?? {})) {
    const { email, password, ...rest } = actor;
    const fields: Record<string, unknown> = {};
    const provisioned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rest)) (registerable.has(key) ? fields : provisioned)[key] = value;
    examples.actors[name] = { email, password, fields, provisioned };
  }
  for (const scenario of model.examples?.scenarios ?? []) {
    examples.scenarios.push({
      name: scenario.name,
      steps: scenario.steps.map(step => ({ ...compileStep(step), expect: step.expect }))
    });
  }
  for (const step of model.examples?.seed ?? []) examples.seed.push(compileStep(step));

  let app: AppIR | undefined;
  if (model.app) {
    const titleOf = (resourceName: string) => toTitleCase(resourceName);
    const pages: PageIR[] = Object.entries(model.app.pages).map(([name, page]) => {
      const common = {
        name,
        kind: page.kind,
        path: page.path ?? defaultPagePath(name),
        title: page.title ?? toTitleCase(name),
        description: page.description,
        tiles: [] as TileIR[],
        recent: [] as PageIR["recent"]
      };
      if (page.kind === "custom") return { ...common, columns: [], fields: [] };
      if (page.kind === "dashboard") {
        return {
          ...common,
          columns: [],
          fields: [],
          tiles: (page.tiles ?? []).map(t => {
            const tile: TileIR = {
              resource: t.resource,
              label: t.label ?? titleOf(t.resource),
              filter: t.filter ?? {}
            };
            if (t.icon) tile.icon = t.icon;
            return tile;
          }),
          recent: (page.recent ?? []).map(r => ({ resource: r.resource, limit: r.limit }))
        };
      }
      const resource = resources.find(r => r.name === page.resource)!;
      const entity = entityByName(resource.entity);
      const out: PageIR = {
        ...common,
        resource: resource.name,
        entity: entity.name,
        layout: page.layout ?? "split",
        columns: page.columns ?? defaultColumns(entity, resource.outputFields),
        fields: page.fields ?? resource.outputFields
      };
      if (page.group_by) out.groupBy = page.group_by;
      return out;
    });
    app = { title: model.app.title ?? model.name, pages };
    if (model.app.sidebar) {
      app.sidebar = {
        items: model.app.sidebar.items.map(item => {
          const page = pages.find(p => p.name === item.page)!;
          const out: SidebarItemIR = { page: page.name, path: page.path, label: item.label ?? page.title };
          if (item.icon) out.icon = item.icon;
          return out;
        }),
        footer: {
          user: model.app.sidebar.footer.user && Boolean(model.auth),
          settings: model.app.sidebar.footer.settings
        }
      };
    }
  }

  const ir: IR = {
    version: "2.0",
    name: model.name,
    description: model.description,
    dialect: "postgres",
    hash: "",
    auth,
    files,
    enums,
    entities,
    resources,
    actions,
    events,
    jobs: events.some(e => e.delivery === "queue") ? { queue: true } : undefined,
    examples,
    app
  };
  ir.hash = hashValue({ ...ir, hash: undefined });
  return ir;
}

/** Binary columns never cross the HTTP API in 1.0 */
function isBytes(column: ColumnIR): boolean {
  return column.type.kind === "scalar" && column.type.scalar === "bytes";
}

function isGeneratedDefault(column: ColumnIR): boolean {
  return column.generated === "identity" || column.default?.kind === "now" || column.default?.kind === "uuid";
}

function defaultOrder(entity: EntityIR): [string, "asc" | "desc"][] {
  if (entity.columns.some(c => c.name === "created_at")) return [["created_at", "desc"]];
  return entity.primaryKey.map(pk => [pk, "asc"]);
}

function isShortScalar(column: ColumnIR): boolean {
  return (
    column.type.kind === "enum" ||
    (column.type.kind === "scalar" && !["text", "json", "bytes"].includes(column.type.scalar))
  );
}

/** The first string column that is not a key names the row; falling back to the primary key. */
function displayColumn(columns: ColumnIR[], primaryKey: string[], foreignKeys: ForeignKeyIR[]): string {
  const isKey = (c: ColumnIR) => primaryKey.includes(c.name) || foreignKeys.some(fk => fk.column === c.name);
  const pick = (test: (c: ColumnIR) => boolean) => columns.find(c => !c.hidden && !isKey(c) && test(c));
  const named = pick(c => ["title", "name", "label"].includes(c.name));
  if (named) return named.name;
  const text = pick(c => c.type.kind === "scalar" && c.type.scalar === "string");
  if (text) return text.name;
  const any = pick(c => c.type.kind === "scalar" && c.type.scalar === "text");
  if (any) return any.name;
  return primaryKey[0];
}

/** Master list columns when a page declares none: the display column, then up to three more short columns. */
function defaultColumns(entity: EntityIR, outputFields: string[]): string[] {
  const shorts = entity.columns.filter(
    c =>
      outputFields.includes(c.name) &&
      !c.primary &&
      !entity.foreignKeys.some(fk => fk.column === c.name) &&
      isShortScalar(c)
  );
  const out = [entity.display, ...shorts.map(c => c.name).filter(n => n !== entity.display)].slice(0, 4);
  return out.length ? out : [entity.primaryKey[0]];
}

export function entityOf(ir: IR, name: string): EntityIR {
  const entity = ir.entities.find(e => e.name === name);
  if (!entity) throw new Error(`entity ${name} not in IR`);
  return entity;
}

export function columnOf(entity: EntityIR, name: string): ColumnIR {
  const column = entity.columns.find(c => c.name === name);
  if (!column) throw new Error(`column ${entity.name}.${name} not in IR`);
  return column;
}

export function relationOf(entity: EntityIR, name: string): RelationIR {
  const relation = entity.relations.find(r => r.name === name);
  if (!relation) throw new Error(`relation ${entity.name}.${name} not in IR`);
  return relation;
}

/** The actions of a resource, in declared order */
export function actionsOf(ir: IR, resource: string): ActionIR[] {
  return ir.actions.filter(a => a.resource === resource);
}

/** Actions not tied to a resource */
export function globalActions(ir: IR): ActionIR[] {
  return ir.actions.filter(a => !a.resource);
}

/** Entities the model declares (not OSL's own) */
export function userEntities(ir: IR): EntityIR[] {
  return ir.entities.filter(e => !e.system);
}

/** File columns of an entity */
export function fileColumns(entity: EntityIR): ColumnIR[] {
  return entity.columns.filter(c => c.type.kind === "file");
}

export { type Entity as ModelEntity, type Field as ModelField };
