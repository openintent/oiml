/**
 * IR v2: the fully resolved, framework-neutral form of a model.
 * Every default is explicit here so backends never infer anything.
 */
import { hashValue, sha256 } from "./canonical.js";
import {
  AUTH_STEP_OPS,
  conjunctionParts,
  pagePathOf,
  takenOverPage,
  durationSeconds,
  EVENT_ON_PATTERN,
  expandInvites,
  invitePlans,
  loadModel,
  OAUTH_PRESETS,
  predicateParts,
  primaryKeyFields,
  resolveStepOp,
  ruleAlternativeTexts,
  membershipRelation,
  MOVE_ACTION,
  ARCHIVE_ACTIONS,
  ARCHIVED_PARAM,
  archiveOf,
  countLink,
  positionOf,
  sequencesOf,
  tenantLinks,
  throughRelation,
  transitionsOf,
  splitCondition,
  splitWhen,
  type Action,
  type Entity,
  type Field,
  type Model,
  type Rule,
  type CountLink,
  type ThroughLink,
  type Validate
} from "./model.js";
import { defaultTableName, relationNameFromColumn, toSnakeCase, toTitleCase } from "./naming.js";
import { sqlType } from "./migrations.js";
import { compileShape, shapeByOf, type ShapeByIR, type ShapeKeyIR } from "./shapes.js";

export type Scalar =
  | "string"
  | "text"
  | "integer"
  | "bigint"
  | "float"
  | "decimal"
  /** An amount: numeric(19, 4) in the database, a decimal string everywhere else, never a float */
  | "money"
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

/** A column's validation as the backends read it: numeric bounds only; a money column's bounds are in `money` */
export type ColumnValidate = Omit<Validate, "min" | "max"> & { min?: number; max?: number };

/** What a money column's amounts are in, and the bounds they are held to: decimal strings, compared exactly */
export interface MoneyIR {
  /** The ISO 4217 code of every amount, when the field names one */
  currency?: string;
  /** The enum column of the same entity holding each row's code, when the field names that instead */
  currencyField?: string;
  min?: string;
  max?: string;
}

export interface ColumnIR {
  name: string;
  type: TypeIR;
  nullable: boolean;
  unique: boolean;
  primary: boolean;
  hidden: boolean;
  /** Returned by the API but never accepted from it: register, create and update leave it out */
  readOnly?: boolean;
  default?: DefaultIR;
  /** Database-generated integer identity */
  generated?: "identity";
  maxLength?: number;
  validate?: ColumnValidate;
  description?: string;
  /** Present on a money column (`type.scalar` is `money`) */
  money?: MoneyIR;
  /** A number the database assigns on insert (`EntityIR.sequences`): a string, never null, read-only to clients */
  sequence?: { prefix: string; width: number };
  /**
   * Encrypted at rest (`sealed: true`): the column is `bytea` whatever `type` says, and `type` is what a writer
   * sends and an allowed reader gets back. `read` is always set on a sealed column that is not hidden (`none`
   * unless the field names its readers), and the server as a viewer never carries the value: not in an event,
   * not in the user a session keeps.
   */
  sealed?: true;
  /** A JSON column's keys (`shape:`): every write is held to them */
  shape?: ShapeKeyIR[];
  /** A JSON column's keys per value of an enum column of the same entity (`shape_by:`) */
  shapeBy?: ShapeByIR;
  /** Relation name when this column is a foreign key */
  relation?: string;
  /** Enum values for columns that are not stored (action inputs and results), where no database enum exists */
  enumValues?: string[];
  /** The row's place within its parent (`EntityIR.order`): numbered by the database, read-only to clients */
  position?: true;
  /** A count the database keeps (`EntityIR.counts`): never null, read-only to clients and to handlers */
  count?: true;
  /**
   * Who may read the field (`read:` on a field): the key is in a response only for a caller this rule allows on
   * that row. It reads the row's own columns and the caller, never a path, and is compiled as written: on a tenant
   * table under `isolation: database` nothing is added to it, since no policy stands behind a field.
   */
  read?: RuleIR;
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
  /** A reverse relation through the field its target is ordered within: the target's position column, the order its rows come in */
  orderBy?: string;
}

/** A relation through a junction entity: the rows on the far side, as an include returns them */
export interface ThroughIR {
  name: string;
  junction: string;
  junctionTable: string;
  /** The junction column pointing at this entity, and this entity's key it holds */
  from: string;
  sourceColumn: string;
  /** The junction column pointing at the far entity, the far entity and its key */
  to: string;
  target: string;
  targetColumn: string;
  /**
   * The junction's position column when the junction is ordered within `from`: the far rows come in that order.
   * Without one they come by the far entity's display column, then its key.
   */
  orderBy?: string;
}

/** An archiving entity: the column that says when a row was archived, and who may archive and restore */
export interface ArchiveIR {
  /** A nullable datetime only the server sets: null while the row is live */
  column: string;
  /** The rule of `archive` and `restore`: the archive's own, else the entity's update rule */
  rule: RuleIR;
}

/** One step of a state machine, resolved */
export interface TransitionIR {
  name: string;
  /** The values of the column a row may hold when the step runs */
  from: string[];
  /** The value the column holds afterwards */
  to: string;
  /** A nullable datetime column set to the time the step ran */
  stamp?: string;
  /** Who may run it: the transition's own rule, else the entity's update rule. `none`: only a timer runs it */
  rule: RuleIR;
}

/** The state machine of an entity: the enum column it moves and its steps, in declared order */
export interface TransitionsIR {
  /** A read-only enum column: only the steps below change it for a client */
  column: string;
  /** The column's values in declared order: the columns of a board grouped by it */
  values: string[];
  steps: TransitionIR[];
}

/** A count over a reverse relation: an integer column the database keeps with triggers on the counted table */
export interface CountIR {
  /** The integer column on this entity */
  column: string;
  /** The reverse relation counted */
  relation: string;
  /** The counted entity, its table, and its column pointing at this entity's key */
  entity: string;
  table: string;
  fk: string;
  /** This entity's key, which `fk` holds */
  key: string;
  /** Only rows these hold for count; empty counts every row */
  where: RuleConditionIR[];
  /** The trigger function on the counted table, and the name its triggers share */
  function: string;
  trigger: string;
  /**
   * Present when the counted table is ordered within `fk`: the function that takes the parent the way the order's
   * own writers do before a row is added, so that a count never waits for a parent whose rows are half taken.
   */
  hold?: string;
}

/** A sequence field: the counter each new row takes its number from, and how the number is written */
export interface SequenceIR {
  /** The string column on this entity */
  column: string;
  /** The counter's name in the counter table: `<table>.<column>` */
  key: string;
  prefix: string;
  /** The digits a number is padded to; a longer one keeps all its digits */
  width: number;
  /** The columns a number counts within; empty for one counter for the whole table */
  scope: string[];
  /** UNIQUE (scope..., column) */
  unique: { name: string; columns: string[] };
  /** The trigger function that numbers a new row, and its trigger */
  function: string;
  trigger: string;
}

/** The table every sequence's counters live in: one row per sequence and scope, holding the last number given */
export const SEQUENCE_TABLE = "osl_sequences";

/** An ordered collection: rows that hold a place among the rows sharing a parent */
export interface OrderIR {
  /** The position column: 1 for the first row of a parent, no two rows of one parent alike */
  column: string;
  /** The required relation column naming the parent */
  within: string;
  parentEntity: string;
  parentTable: string;
  parentKey: string;
  /** UNIQUE (within, position), deferrable so that one statement may renumber a parent */
  unique: { name: string; columns: string[] };
  /** The trigger function that appends a new row at the end of its parent */
  assign: string;
  /** The trigger function that closes the gap rows leave when they are deleted */
  close: string;
  /** move(id, to): puts the row at place `to` of its parent, the last place when `to` is beyond it */
  move: string;
  /** remove(id): deletes the row holding its parent's lock, so that the gap closes whatever else is writing */
  remove: string;
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

/**
 * A row condition on a predicate: it allows only rows whose `column` compares to `value` as `op` says. With `via`,
 * `column` is on the row the hops reach from the row being checked (`project_id.public`).
 */
export interface RuleConditionIR {
  column: string;
  op: "eq" | "ne";
  /** The literal, typed by the column: boolean, number, string (enum values included) or null */
  value: string | number | boolean | null;
  via?: RuleHopIR[];
  /**
   * Under `isolation: database`, on a path of a public alternative of a tenant table's read rule: the database
   * function that reads the value for the first hop's key whatever the caller's tenants, since the policies of the
   * tables the path crosses would hide it from a caller who is not a member.
   */
  reader?: string;
}

/** The junction a member path ends in: the caller is a member when a row of it points at the row reached and at them */
export interface MembershipIR {
  /** The reverse relation's name, as the rule spells it */
  relation: string;
  entity: string;
  table: string;
  /** The junction's column pointing at the row the path reached */
  column: string;
  /** The junction's column pointing at the identity */
  memberColumn: string;
  /** The ranked enum and its values from most to least privileged, when the junction has one */
  roleColumn?: string;
  roles?: string[];
}

export type RuleIR =
  | { kind: "public"; when?: RuleConditionIR }
  | { kind: "authenticated"; when?: RuleConditionIR }
  | { kind: "none" }
  /** The row's `field` is the session's user; with `via`, `field` is on the row the hops reach */
  | { kind: "owner"; field: string; via?: RuleHopIR[]; when?: RuleConditionIR }
  | { kind: "role"; value: string; when?: RuleConditionIR }
  /**
   * The user has a membership of the tenant in `field` (with at least `role`, by the membership's enum order); with
   * `via`, `field` is on the row the hops reach. With `through`, the membership is a row of that junction pointing
   * at the row reached (whose primary key `field` names) and at the user, ranked by the junction's own enum.
   */
  | { kind: "member"; field: string; role?: string; via?: RuleHopIR[]; through?: MembershipIR; when?: RuleConditionIR }
  /** Every part allows (a conjunction, `member:project_id.team_id and owner:author_id`) */
  | { kind: "all"; rules: PredicateIR[] }
  /** Any of the alternatives allows */
  | { kind: "any"; rules: RuleIR[] };

export type RowRuleIR = Extract<RuleIR, { kind: "owner" | "member" }>;
/** A single predicate: neither `any` nor `all` */
export type PredicateIR = Exclude<RuleIR, { kind: "any" | "all" }>;
/** An alternative of a rule: a predicate, or a conjunction of predicates */
export type AlternativeIR = Exclude<RuleIR, { kind: "any" }>;
/** A predicate that may carry a row condition */
export type ConditionedRuleIR = Exclude<PredicateIR, { kind: "none" }>;

/** The predicates that carry a row condition, in order, looking inside conjunctions */
export function conditionedRules(rule: RuleIR): ConditionedRuleIR[] {
  return ruleParts(rule).filter((r): r is ConditionedRuleIR => r.kind !== "none" && r.when !== undefined);
}

/** Whether a predicate's verdict needs the row: owner and member rules, and any predicate with a condition */
export function isRowDependent(rule: PredicateIR): boolean {
  return rule.kind === "owner" || rule.kind === "member" || (rule.kind !== "none" && rule.when !== undefined);
}

/** The alternatives whose verdict needs the row: a row predicate, or a conjunction with a row-dependent part */
export function rowDependentRules(rule: RuleIR): AlternativeIR[] {
  return ruleAlternatives(rule).filter(r => (r.kind === "all" ? r.rules.some(isRowDependent) : isRowDependent(r)));
}

/** The key a condition's value sits under in a checked row: the column, or the dotted path through its hops */
export function conditionKey(when: RuleConditionIR): string {
  return [...(when.via ?? []).map(h => h.column), when.column].join(".");
}

/** ` when published = true`, as the model writes a condition */
export function conditionText(when: RuleConditionIR): string {
  return ` when ${conditionKey(when)} ${when.op === "eq" ? "=" : "!="} ${when.value === null ? "null" : String(when.value)}`;
}

/** The alternatives of a rule: the rule itself, or the rules an `any` lists; a conjunction is one alternative */
export function ruleAlternatives(rule: RuleIR): AlternativeIR[] {
  return rule.kind === "any" ? rule.rules.flatMap(ruleAlternatives) : [rule];
}

/** The parts of an alternative: the predicate itself, or the predicates a conjunction joins */
export function alternativeParts(rule: AlternativeIR): PredicateIR[] {
  return rule.kind === "all" ? rule.rules : [rule];
}

/** Every predicate of a rule, across alternatives and inside conjunctions */
export function ruleParts(rule: RuleIR): PredicateIR[] {
  return ruleAlternatives(rule).flatMap(alternativeParts);
}

/** The predicates that are about a row (owner and member), in order, looking inside conjunctions */
export function rowRules(rule: RuleIR): RowRuleIR[] {
  return ruleParts(rule).filter((r): r is RowRuleIR => r.kind === "owner" || r.kind === "member");
}

/** The alternatives a session can satisfy without a row: public, authenticated and role, without a condition */
export function openRules(rule: RuleIR): RuleIR[] {
  return ruleAlternatives(rule).filter(
    r => (r.kind === "public" || r.kind === "authenticated" || r.kind === "role") && !r.when
  );
}

/**
 * The key the generated code keeps a row rule's value under when it checks a row: the column, or the dotted path;
 * for a membership, the path ending in the relation's name, so the value never collides with a column of the row.
 */
export function ruleKey(rule: RowRuleIR): string {
  const last = rule.kind === "member" && rule.through ? rule.through.relation : rule.field;
  return [...(rule.via ?? []).map(h => h.column), last].join(".");
}

/** The member predicates that end in a membership relation, by their key: resolved as the caller's membership row, not a value */
export function ruleMemberships(rule: RuleIR): Map<string, { via: RuleHopIR[]; field: string; through: MembershipIR }> {
  const out = new Map<string, { via: RuleHopIR[]; field: string; through: MembershipIR }>();
  for (const r of rowRules(rule))
    if (r.kind === "member" && r.through) out.set(ruleKey(r), { via: r.via ?? [], field: r.field, through: r.through });
  return out;
}

/** Every value a row check reads through relations: owner and member paths, and conditions with a path, by their dotted key */
export function rulePaths(rule: RuleIR): Map<string, { via: RuleHopIR[]; field: string; reader?: string }> {
  const out = new Map<string, { via: RuleHopIR[]; field: string; reader?: string }>();
  for (const r of rowRules(rule))
    if (r.via?.length && !(r.kind === "member" && r.through)) out.set(ruleKey(r), { via: r.via, field: r.field });
  for (const r of conditionedRules(rule)) {
    if (!r.when!.via?.length) continue;
    const key = conditionKey(r.when!);
    const reader = r.when!.reader ?? out.get(key)?.reader;
    out.set(
      key,
      reader ? { via: r.when!.via!, field: r.when!.column, reader } : { via: r.when!.via!, field: r.when!.column }
    );
  }
  return out;
}

/** Whether an alternative needs no session: every part is `public`, with or without a condition */
export function isSessionFree(alternative: AlternativeIR): boolean {
  return alternativeParts(alternative).every(p => p.kind === "public");
}

/** The alternatives of a rule a caller without a session can satisfy: what a tenant table's public-read policy compiles */
export function sessionFreeAlternatives(rule: RuleIR): AlternativeIR[] {
  return ruleAlternatives(rule).filter(isSessionFree);
}

/** The field an owner predicate without a path names (an alternative or a conjunction part): set from the session on create, never written by a client */
export function directOwnerOf(rule: RuleIR): string | undefined {
  const owner = ruleParts(rule).find(r => r.kind === "owner" && !r.via);
  return owner?.kind === "owner" ? owner.field : undefined;
}

/** The rule as the model writes it */
export function ruleText(rule: RuleIR): string {
  const when =
    rule.kind !== "any" && rule.kind !== "all" && rule.kind !== "none" && rule.when ? conditionText(rule.when) : "";
  switch (rule.kind) {
    case "none":
      return rule.kind;
    case "public":
    case "authenticated":
      return `${rule.kind}${when}`;
    case "owner":
      return `owner:${ruleKey(rule)}${when}`;
    case "role":
      return `role:${rule.value}${when}`;
    case "member":
      return `member:${ruleKey(rule)}${rule.role ? `:${rule.role}` : ""}${when}`;
    case "all":
      return rule.rules.map(ruleText).join(" and ");
    case "any":
      return rule.rules.map(ruleText).join(" or ");
  }
}

/** A composite key that keeps a row and the row it points at in one tenant: (tenant, relation) to the target's (tenant, key) */
export interface TenantKeyIR {
  name: string;
  /** The tenant column and the relation column on this table */
  columns: [string, string];
  targetTable: string;
  /** The target's tenant column and its primary key */
  targetColumns: [string, string];
  onDelete: "restrict" | "cascade" | "set_null";
  /** The key a derived tenant column is kept by: when the parent changes tenant, the row follows */
  cascade?: true;
}

/** What makes an entity a tenant table under `isolation: database` */
export interface TenantIR {
  /** The column holding the row's tenant: the tenant entity's own key, the declared relation, or the derived column */
  column: string;
  /** SQL type of a tenant id, as the policy casts the bound setting */
  type: string;
  /**
   * Set when the model does not declare the column: the compiler adds it to the table (never to `columns`, so no
   * backend reads or writes it), a trigger copies it from the parent on insert and when `through` changes, and a
   * composite key keeps it equal.
   */
  derived?: {
    column: ColumnIR;
    /** The required relation column the tenant comes through */
    through: string;
    parentTable: string;
    parentKey: string;
    /** The parent's own tenant column */
    parentColumn: string;
    /** The trigger function that keeps the column */
    trigger: string;
    index: { name: string; columns: string[]; unique: false };
  };
  /** Composite keys to every tenant table this one points at, the tenant entity excepted */
  keys: TenantKeyIR[];
  /** UNIQUE (tenant, key), present when another table's composite key points here */
  unique?: { name: string; columns: string[] };
  /**
   * The function that says whether a row with this key exists whatever the caller's tenants: how a handler tells
   * another tenant's row (the rule's refusal) from a missing one (404). Absent under `hidden: not_found`, where
   * both answer 404.
   */
  exists?: string;
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
  /** What a row the read rule hides answers when addressed by id: a refusal, or the 404 a missing row gets */
  hidden: "forbidden" | "not_found";
  /** The column that names a row to a person: the first short string column, else the primary key */
  display: string;
  /** Owned by OSL (files, auth tokens): migrated and checked for drift, never exposed as a resource or page */
  system?: boolean;
  /** Under `isolation: database`: present on a tenant table, absent on a shared one */
  tenant?: TenantIR;
  /** Present when the entity has a position field */
  order?: OrderIR;
  /** Relations through a junction, as `relations` declares them; absent without any */
  through?: ThroughIR[];
  /** Present when the entity archives */
  archive?: ArchiveIR;
  /** Present when the entity declares transitions */
  transitions?: TransitionsIR;
  /** The count_of fields of the entity; absent without any */
  counts?: CountIR[];
  /** The sequence fields of the entity; absent without any */
  sequences?: SequenceIR[];
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
      /** Relations through a junction to embed in each row (`EntityIR.through`); absent without any */
      through?: string[];
    }
  | { kind: "get"; method: "GET"; path: string; include: string[]; rule: RuleIR; through?: string[] }
  | {
      kind: "create";
      method: "POST";
      path: string;
      fields: string[];
      ownerField?: string;
      rule: RuleIR;
      /** On an invite resource: the membership entity its invites are for. The create sends an invite (see InviteIR) */
      invite?: string;
    }
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
  /**
   * Written by the compiler, with no handler of yours: `move` on a resource over an ordered entity, `archive` and
   * `restore` on one over an archiving entity, `transition` for each step of the entity's state machine
   * (`EntityIR.transitions` has the step by the action's name)
   */
  builtin?: "move" | "archive" | "restore" | "transition";
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
  /** Present under `isolation: database` */
  isolation?: IsolationIR;
}

/** The database backstop: what a request binds, the role it connects as, and how a session's memberships are read */
export interface IsolationIR {
  /** The role the web process connects as: no BYPASSRLS, granted the tables, bound by every policy */
  appRole: string;
  /** The setting a request binds its caller's tenants to, as an array literal; unset or empty shows no row */
  setting: string;
  /** SQL type of a tenant id */
  tenantType: string;
  /** The function that answers a user's memberships (tenant, role) before any tenant is bound */
  memberships: string;
}

/**
 * Invites to one membership entity (auth.invites). Creating a row of the invite resource mails a link to an address;
 * whoever proves the address becomes a member, and the invite is deleted.
 */
export interface InviteIR {
  /** The membership entity an accepted invite becomes a row of */
  membership: string;
  membershipTable: string;
  /** The entity people join (the tenant, a channel, an article), its table and its key column */
  parent: string;
  parentTable: string;
  parentKey: string;
  /** The membership's columns pointing at the parent and at the identity; the invite names its parent the same way */
  parentColumn: string;
  userColumn: string;
  /** The role column, on the membership and on the invite, and its values from most to least privileged; absent where memberships have no rank */
  roleColumn?: string;
  roles?: string[];
  /** Who may invite, revoke and read the pending list */
  rule: RuleIR;
  /** Seconds a link lasts */
  expires: number;
  /** The entity, table and resource the compiler wrote for the invite */
  entity: string;
  table: string;
  resource: string;
  /** With tenancy: the required relations from the parent to its tenant, none when the parent is the tenant; absent when it reaches no tenant */
  tenantPath?: ForeignKeyIR[];
  /**
   * Under `isolation: database`, where the invite is a tenant table: the two functions that see past its policy.
   * An invite belongs to a tenant its invitee is not a member of yet. `byToken(token_hash)` answers the tenant of
   * the invite holding that hash, which a token route binds before it reads the invite; `byEmail(email, at)` the
   * tenants of the invites to that address live at that time, which acceptance binds once the address is proven.
   */
  isolation?: { byToken: string; byEmail: string };
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
  /** Present when auth.invites is declared */
  invites?: InviteIR[];
}

export interface FilesIR {
  upload: RuleIR;
  read: RuleIR;
}

/** A handler the queue runs as the system: the action's handler, resolved */
export interface SystemRunIR {
  /** Resource of a collection or row action; absent for a global action */
  resource?: string;
  action: string;
  handler: string;
}

export interface ScheduleIR {
  /** Unique within the model: the handler name, numbered when scheduled twice */
  name: string;
  cron: string;
  run: SystemRunIR;
  input: Record<string, string | number | boolean>;
}

export interface TimerIR {
  /** Unique within the model */
  name: string;
  entity: string;
  table: string;
  /** The datetime column the due time comes from */
  column: string;
  afterSeconds: number;
  run: SystemRunIR;
  /** Checked again when the job fires */
  when?: RuleConditionIR;
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
  kind: "resource" | "action" | "auth" | "file" | "timer" | "schedule" | "email";
  resource?: string;
  /** resource steps: the operation; action steps: the action name; auth and file steps: their operation */
  operation: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path with `{param}` placeholders */
  pathTemplate: string;
  pathParams: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  expect: { status: number; body?: unknown; absent?: string[] };
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

/** A fixed filter value on a page or tile; `{ actor: "id" }` is the signed-in user's id, resolved by the page */
/**
 * A fixed filter value: a literal, or a value the page takes from its context. actor: the signed-in user's key.
 * row: the key of the row a detail page shows (sections only). tenant: the key of the tenant chosen in the shell.
 */
export type PageFilterValue = string | number | boolean | { actor: "id" } | { row: "id" } | { tenant: "id" };

/** A list from another resource on a detail page, filtered by the page's row */
export interface SectionIR {
  resource: string;
  entity: string;
  title: string;
  /** At least one value is { row: "id" } */
  filter: Record<string, PageFilterValue>;
  columns: string[];
  /** The one sortable field the list is sorted by; absent: the resource's own order */
  order?: [string, "asc" | "desc"];
  /** Rows per page of the section */
  limit: number;
  /** End the section with the resource's create form, the filter's context values preset */
  create: boolean;
}

/** The tenant context: present when any page filter uses { tenant: "id" } */
export interface TenantContextIR {
  /** The resource whose list gives the signed-in user's tenants */
  resource: string;
  entity: string;
  /** The column the switcher shows a tenant by */
  labelColumn: string;
}

/** One tile per value of an enum, or per row of a related resource, each counting with that filter */
export type TileGroupIR =
  | { field: string; kind: "enum"; values: string[] }
  | { field: string; kind: "relation"; resource: string; entity: string; key: string; display: string };

export interface TileIR {
  resource: string;
  label: string;
  filter: Record<string, PageFilterValue>;
  icon?: string;
  groupBy?: TileGroupIR;
}

export interface PageIR {
  name: string;
  kind: "resource" | "dashboard" | "custom" | "detail";
  /** Resource and detail pages: the resource and its entity */
  resource?: string;
  entity?: string;
  /** Resource pages: how the rows are shown */
  layout?: "split" | "table" | "board";
  /** board layout: the enum column whose values are the columns */
  groupBy?: string;
  /** A detail page's path ends in the parameter, spelled /:id; each target writes its own spelling */
  path: string;
  title: string;
  description?: string;
  /** Resource pages: columns of the master list */
  columns: string[];
  /** Resource pages: relations through a junction the master list shows after its columns, by the far rows' names */
  relations?: string[];
  /** Resource and detail pages: fields of the detail, in order */
  fields: string[];
  /** Dashboard pages */
  tiles: TileIR[];
  recent: { resource: string; limit: number; filter: Record<string, PageFilterValue> }[];
  /** Detail pages: the lists under the row; they replace the included reverse relations */
  sections: SectionIR[];
  /** Detail pages: the resource page whose generated detail this page takes over; it renders inside that page */
  listPage?: string;
  /** Resource pages: the detail page that takes over this page's generated detail */
  detailPage?: string;
  /** Who may open the page: public, authenticated or role. A detail page inside a list carries the list's. */
  access: RuleIR;
  /** Resource pages: filters the list always carries */
  filter?: Record<string, PageFilterValue>;
  /** Refetch interval in seconds while the page is open */
  refresh?: number;
}

export interface SidebarItemIR {
  page: string;
  path: string;
  label: string;
  /** lucide icon name in kebab-case */
  icon?: string;
  /** The page's access, so the sidebar lists only what the user may open */
  access: RuleIR;
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
  tenant?: TenantContextIR;
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
  schedules: ScheduleIR[];
  timers: TimerIR[];
  /** Present when any event is delivered through the queue, or a schedule or timer exists */
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
  "money",
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
/**
 * How a compile turns a when literal into a typed condition, knowing the entity's fields: `field` may be a dotted
 * path, in which case the literal is typed by the field the path reaches and the hops are compiled into `via`.
 */
export type ConditionParser = (field: string, op: "eq" | "ne", raw: string) => RuleConditionIR;

/** How a compile resolves a member path: the field tested on the row reached, its hops, and the junction when the path ends in a membership relation */
export type MemberPathResolver = (path: string[]) => { field: string; via: RuleHopIR[]; through?: MembershipIR };

export function parseRule(
  rule: Rule | undefined,
  fallback: RuleIR,
  hops?: (path: string[]) => RuleHopIR[],
  condition?: ConditionParser,
  memberPath?: MemberPathResolver
): RuleIR {
  if (!rule) return fallback;
  const alternatives = ruleAlternativeTexts(rule).map(a => parseAlternative(a, hops, condition, memberPath));
  if (alternatives.length > 1) return { kind: "any", rules: alternatives };
  return alternatives[0];
}

/** A predicate, or a conjunction of predicates joined with " and " */
function parseAlternative(
  text: string,
  hops?: (path: string[]) => RuleHopIR[],
  condition?: ConditionParser,
  memberPath?: MemberPathResolver
): AlternativeIR {
  const parts = conjunctionParts(text).map(p => parsePredicate(p, hops, condition, memberPath));
  return parts.length > 1 ? { kind: "all", rules: parts } : parts[0];
}

function parsePredicate(
  full: string,
  hops?: (path: string[]) => RuleHopIR[],
  condition?: ConditionParser,
  memberPath?: MemberPathResolver
): PredicateIR {
  const { base: predicate, when } = splitWhen(full);
  const out = parseBase(predicate, hops, memberPath);
  if (when && out.kind !== "none") out.when = parseCondition(when, hops, condition);
  return out;
}

/** A condition as written into its IR: typed by the field it reaches when the parser knows the entity, with its hops */
export function parseCondition(
  when: { field: string; op: "=" | "!="; value: string },
  hops?: (path: string[]) => RuleHopIR[],
  condition?: ConditionParser
): RuleConditionIR {
  const op = when.op === "=" ? "eq" : "ne";
  if (condition) return condition(when.field, op, when.value);
  const path = when.field.split(".");
  const out: RuleConditionIR = { column: path[path.length - 1], op, value: when.value };
  if (path.length > 1 && hops) out.via = hops(path.slice(0, -1));
  return out;
}

function parseBase(
  predicate: string,
  hops?: (path: string[]) => RuleHopIR[],
  memberPath?: MemberPathResolver
): PredicateIR {
  const parts = predicateParts(predicate);
  if (parts) {
    if (parts.kind === "member" && memberPath) {
      const resolved = memberPath(parts.path);
      const out: RowRuleIR =
        parts.role !== undefined
          ? { kind: "member", field: resolved.field, role: parts.role }
          : { kind: "member", field: resolved.field };
      if (resolved.via.length) out.via = resolved.via;
      if (resolved.through) out.through = resolved.through;
      return out;
    }
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

/** A database identifier OSL makes up, within PostgreSQL's 63 bytes: a long one keeps its start and gains a hash of the whole */
export function sqlName(name: string): string {
  return name.length <= 63 ? name : `${name.slice(0, 54)}_${sha256(name).slice(0, 8)}`;
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
  // A sequence is a string to everything that reads it; the database writes it
  if (field.type === "sequence") return { kind: "scalar", scalar: "string" };
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

/**
 * The chain of required relations from an entity to the tenant, none for the tenant itself, or null when the entity
 * never reaches it. An invite's parent is placed in its tenant by it, and the conformance walks find a row's tenant.
 */
export function tenantChain(
  entities: EntityIR[],
  tenant: string,
  entity: EntityIR,
  seen = new Set<string>()
): ForeignKeyIR[] | null {
  if (entity.name === tenant) return [];
  seen.add(entity.name);
  for (const fk of entity.foreignKeys) {
    const column = entity.columns.find(c => c.name === fk.column);
    if (!column || column.nullable || seen.has(fk.targetEntity)) continue;
    if (fk.targetEntity === tenant) return [fk];
    const target = entities.find(e => e.name === fk.targetEntity);
    if (!target) continue;
    const rest = tenantChain(entities, tenant, target, new Set(seen));
    if (rest) return [fk, ...rest];
  }
  return null;
}

/** Compile a validated model into IR. Throws ModelError on an invalid model. */
export function compile(input: Model): IR {
  return compileValid(loadModel(input));
}

/**
 * Compile a model that validateModel has already passed, without validating it again: validateModel itself compiles
 * through this to hold the scenarios to what the model compiles to (`scenarioContradictions`).
 */
export function compileValid(validated: Model): IR {
  // The stored model never holds what auth.invites stands for; from here on the invite entities are entities
  const model = expandInvites(validated);
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
  /** A member path from `entityName`: the field tested on the row reached, or the junction when it ends in a membership relation */
  const memberPathFrom = (entityName: string, path: string[]): ReturnType<MemberPathResolver> => {
    const via = hopsFrom(entityName, path.slice(0, -1));
    const reached = via.length ? via[via.length - 1].entity : entityName;
    const last = path[path.length - 1];
    if (allEntities[reached].fields[last]) return { field: last, via };
    const membership = membershipRelation(model, reached, last);
    if (!membership || "problem" in membership) return { field: last, via };
    const through: MembershipIR = {
      relation: last,
      entity: membership.entity,
      table: tableOf(membership.entity),
      column: membership.fkField,
      memberColumn: membership.memberField
    };
    if (membership.roleField) {
      through.roleColumn = membership.roleField;
      through.roles = membership.roles;
    }
    return { field: pkOf(reached)[0], via, through };
  };
  /**
   * A when literal typed by the field it tests: null, a boolean, a number, or the string as written. A dotted field
   * follows relation fields from the entity; the literal is typed by the field reached and the hops are kept.
   */
  const conditionOn =
    (entityName: string): ConditionParser =>
    (field, op, raw) => {
      const path = field.split(".");
      const via = path.length > 1 ? hopsFrom(entityName, path.slice(0, -1)) : [];
      const target = via.length ? via[via.length - 1].entity : entityName;
      const column = path[path.length - 1];
      const f = allEntities[target]?.fields[column];
      let value: RuleConditionIR["value"] = raw;
      if (raw === "null") value = null;
      else if (f?.type === "boolean") value = raw === "true";
      else if (f && ["integer", "bigint", "float", "decimal"].includes(f.type)) value = Number(raw);
      const out: RuleConditionIR = { column, op, value };
      if (via.length) out.via = via;
      return out;
    };
  // Under isolation: database, the tenant tables and the path a rule follows from each to its tenant
  const tenantOf = tenantLinks(model).links;
  const tenantEntityName = model.auth?.tenancy?.entity;
  /** The member predicate that says "a member of this row's tenant", any role */
  const tenantMember = (entityName: string): RowRuleIR => {
    const path = tenantOf[entityName].path;
    const via = hopsFrom(entityName, path.slice(0, -1));
    const out: RowRuleIR = { kind: "member", field: path[path.length - 1] };
    if (via.length) out.via = via;
    return out;
  };
  /**
   * A rule on a tenant table as isolation: database compiles it: every alternative that needs a session also needs
   * a membership of the row's tenant, so what the rule allows is what the policy lets the caller reach. An
   * alternative that already asks for that membership (any role), a public one and `none` are left as written.
   */
  const withinTenant = (entityName: string, rule: RuleIR): RuleIR => {
    if (!tenantOf[entityName]) return rule;
    const member = tenantMember(entityName);
    const key = ruleKey(member);
    const alternatives = ruleAlternatives(rule).map((alternative): AlternativeIR => {
      const parts = alternativeParts(alternative);
      if (isSessionFree(alternative) || parts.some(p => p.kind === "none")) return alternative;
      if (parts.some(p => p.kind === "member" && !p.through && ruleKey(p) === key)) return alternative;
      return { kind: "all", rules: [...parts, member] };
    });
    return alternatives.length > 1 ? { kind: "any", rules: alternatives } : alternatives[0];
  };
  /** Name the reader function of every path a public alternative of a tenant table's read rule tests */
  const withReaders = (entityName: string, rule: RuleIR): RuleIR => {
    if (!tenantOf[entityName]) return rule;
    for (const alternative of sessionFreeAlternatives(rule))
      for (const part of alternativeParts(alternative))
        if (part.kind === "public" && part.when?.via?.length)
          part.when.reader = sqlName(`osl_read_${tableOf(entityName)}_${conditionKey(part.when).replace(/\./g, "_")}`);
    return rule;
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
    if (field.read_only) column.readOnly = true;
    if (type.kind === "enum" && !stored) column.enumValues = field.enum_values!;
    const def = columnDefault(field);
    if (def) column.default = def;
    if (field.position && stored) {
      // The database numbers it: a trigger overwrites the default on every insert, and no client writes it
      column.nullable = false;
      column.readOnly = true;
      column.default = { kind: "literal", value: 0 };
      column.position = true;
    }
    if (field.count_of && stored) {
      // The database counts: triggers on the counted table keep it, and no client or handler writes it
      column.nullable = false;
      column.readOnly = true;
      column.default = { kind: "literal", value: 0 };
      column.count = true;
    }
    if (isPrimary && primaryKey.length === 1 && !def) {
      if (field.type === "uuid") column.default = { kind: "uuid" };
      else if (field.type === "integer" || field.type === "bigint") column.generated = "identity";
    }
    if (field.type === "sequence" && stored) {
      // The database numbers it: a trigger overwrites the default on every insert, and no client writes it
      column.nullable = false;
      column.readOnly = true;
      column.default = { kind: "literal", value: "" };
      column.sequence = { prefix: field.prefix ?? "", width: field.width ?? 1 };
    }
    if (field.max_length) column.maxLength = field.max_length;
    else if (field.type === "string" || field.type === "sequence") column.maxLength = 255;
    if (field.sealed && stored) column.sealed = true;
    if (field.shape !== undefined) column.shape = compileShape(field.shape);
    const shapedBy = stored ? shapeByOf(field) : undefined;
    if (shapedBy)
      column.shapeBy = {
        column: shapedBy.by,
        // In the enum's declared order, whatever order the shapes were written in
        shapes: (allEntities[owner]?.fields[shapedBy.by]?.enum_values ?? Object.keys(shapedBy.shapes))
          .filter(value => shapedBy.shapes[value] !== undefined)
          .map(value => ({ value, keys: compileShape(shapedBy.shapes[value]) }))
      };
    if (field.type === "money") {
      const money: MoneyIR = field.currency !== undefined ? { currency: field.currency } : {};
      if (field.currency_field !== undefined) money.currencyField = field.currency_field;
      // Bounds on an amount are decimal strings, held apart from the numeric bounds the other types carry
      if (typeof field.validate?.min === "string") money.min = field.validate.min;
      if (typeof field.validate?.max === "string") money.max = field.validate.max;
      column.money = money;
    } else if (field.validate) column.validate = field.validate as ColumnValidate;
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
      // A sealed field leaves the server for the callers its read rule names, and for nobody when it names none
      if (field.sealed && !field.hidden && !field.read) column.read = { kind: "none" };
      if (field.read)
        column.read = parseRule(
          field.read,
          { kind: "public" },
          path => hopsFrom(entityName, path),
          conditionOn(entityName),
          path => memberPathFrom(entityName, path)
        );
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
        read: parseRule(
          entity.rules?.read,
          defaultRules.read,
          path => hopsFrom(entityName, path),
          conditionOn(entityName),
          path => memberPathFrom(entityName, path)
        ),
        create: parseRule(
          entity.rules?.create,
          defaultRules.create,
          path => hopsFrom(entityName, path),
          conditionOn(entityName),
          path => memberPathFrom(entityName, path)
        ),
        update: parseRule(
          entity.rules?.update,
          defaultRules.update,
          path => hopsFrom(entityName, path),
          conditionOn(entityName),
          path => memberPathFrom(entityName, path)
        ),
        delete: parseRule(
          entity.rules?.delete,
          defaultRules.delete,
          path => hopsFrom(entityName, path),
          conditionOn(entityName),
          path => memberPathFrom(entityName, path)
        )
      },
      hidden: entity.rules?.hidden ?? "forbidden",
      display: displayColumn(columns, primaryKey, foreignKeys)
    };
    if (isSystem) compiled.system = true;
    const sequences = sequencesOf(entity);
    if (sequences.length) {
      compiled.sequences = sequences.map(sequence => {
        const columns = [...sequence.scope, sequence.field];
        const unique = { name: sqlName(`${table}_${columns.join("_")}_key`), columns };
        // Unique within its scope, like any unique the model lists; one the model lists itself is not repeated
        if (!compiled.uniques.some(u => u.columns.join(",") === columns.join(","))) compiled.uniques.push(unique);
        return {
          column: sequence.field,
          key: `${table}.${sequence.field}`,
          prefix: sequence.prefix,
          width: sequence.width,
          scope: sequence.scope,
          unique: compiled.uniques.find(u => u.columns.join(",") === columns.join(","))!,
          function: sqlName(`osl_sequence_${table}_${sequence.field}`),
          trigger: sqlName(`osl_sequence_${sequence.field}`)
        };
      });
    }
    const position = positionOf(entity);
    if (position) {
      const parentEntity = entity.fields[position.within].relation!.entity;
      compiled.order = {
        column: position.field,
        within: position.within,
        parentEntity,
        parentTable: tableOf(parentEntity),
        parentKey: pkOf(parentEntity)[0],
        unique: {
          name: sqlName(`${table}_${position.within}_${position.field}_key`),
          columns: [position.within, position.field]
        },
        assign: sqlName(`osl_position_${table}`),
        close: sqlName(`osl_close_${table}`),
        move: sqlName(`osl_move_${table}`),
        remove: sqlName(`osl_remove_${table}`)
      };
    }
    if (tenantOf[entityName]) {
      compiled.rules = {
        read: withReaders(entityName, withinTenant(entityName, compiled.rules.read)),
        // Whoever creates a tenant becomes its first member: no membership can be asked of them before
        create:
          entityName === tenantEntityName ? compiled.rules.create : withinTenant(entityName, compiled.rules.create),
        update: withinTenant(entityName, compiled.rules.update),
        delete: withinTenant(entityName, compiled.rules.delete)
      };
    }
    entities.push(compiled);
  }

  // Tenant tables: the tenant column (declared or derived), the composite keys, and the existence probe
  if (tenantEntityName && Object.keys(tenantOf).length) {
    const byName = (name: string) => entities.find(e => e.name === name)!;
    const tenantEntity = byName(tenantEntityName);
    const tenantKey = tenantEntity.columns.find(c => c.name === tenantEntity.primaryKey[0])!;
    const tenantType = sqlType(tenantKey);
    for (const entity of entities) {
      const link = tenantOf[entity.name];
      if (!link) continue;
      const tenant: TenantIR = { column: link.field, type: tenantType, keys: [] };
      if (link.through) {
        const parent = byName(allEntities[entity.name].fields[link.through].relation!.entity);
        tenant.derived = {
          column: {
            name: link.field,
            type: tenantKey.type,
            nullable: false,
            unique: false,
            primary: false,
            hidden: true,
            description: `The row's ${tenantEntityName}, kept by the database from ${link.through}`
          },
          through: link.through,
          parentTable: parent.table,
          parentKey: parent.primaryKey[0],
          parentColumn: tenantOf[parent.name].field,
          trigger: sqlName(`osl_tenant_${entity.table}`),
          index: { name: sqlName(`${entity.table}_${link.field}_idx`), columns: [link.field], unique: false }
        };
      }
      for (const fk of entity.foreignKeys) {
        const target = tenantOf[fk.targetEntity];
        if (!target || fk.targetEntity === tenantEntityName) continue;
        const key: TenantKeyIR = {
          name: sqlName(`${entity.table}_${link.field}_${fk.column}_fkey`),
          columns: [link.field, fk.column],
          targetTable: fk.targetTable,
          targetColumns: [target.field, fk.targetColumn],
          onDelete: fk.onDelete
        };
        if (link.through === fk.column) key.cascade = true;
        tenant.keys.push(key);
      }
      if (entity.hidden === "forbidden") tenant.exists = sqlName(`osl_exists_${entity.table}`);
      entity.tenant = tenant;
    }
    for (const entity of entities)
      for (const key of entity.tenant?.keys ?? []) {
        const target = entities.find(e => e.table === key.targetTable)!;
        target.tenant!.unique ??= {
          name: sqlName(`${target.table}_${key.targetColumns.join("_")}_key`),
          columns: [...key.targetColumns]
        };
      }
  }

  // Reverse relations
  for (const source of entities) {
    for (const fk of source.foreignKeys) {
      const field = allEntities[source.name].fields[fk.column];
      if (!field.relation?.reverse) continue;
      const target = entities.find(e => e.name === fk.targetEntity)!;
      const reverse: RelationIR = {
        name: field.relation.reverse,
        kind: field.relation.kind === "one_to_one" ? "one" : "many",
        direction: "reverse",
        target: source.name,
        column: fk.column,
        targetColumn: fk.targetColumn
      };
      // The children of the parent they are ordered within come in that order
      if (source.order?.within === fk.column && reverse.kind === "many") reverse.orderBy = source.order.column;
      target.relations.push(reverse);
    }
  }

  // Relations through a junction
  for (const entity of entities) {
    const declared = Object.keys(allEntities[entity.name].relations ?? {});
    if (!declared.length) continue;
    entity.through = declared.map(name => {
      const link = throughRelation(model, entity.name, name) as ThroughLink;
      const junction = entities.find(e => e.name === link.junction)!;
      const through: ThroughIR = {
        name,
        junction: link.junction,
        junctionTable: junction.table,
        from: link.from,
        sourceColumn: entity.primaryKey[0],
        to: link.to,
        target: link.target,
        targetColumn: pkOf(link.target)[0]
      };
      if (junction.order?.within === link.from) through.orderBy = junction.order.column;
      return through;
    });
  }

  // Counts over reverse relations: the column sits on the entity, the triggers on the table whose rows it counts
  for (const entity of entities) {
    const declared = Object.entries(allEntities[entity.name].fields).filter(([, f]) => f.count_of);
    if (!declared.length) continue;
    entity.counts = declared.map(([name, field]) => {
      const link = countLink(model, entity.name, field) as CountLink;
      const counted = entities.find(e => e.name === link.entity)!;
      const parse = conditionOn(link.entity);
      const count: CountIR = {
        column: name,
        relation: field.count_of!,
        entity: link.entity,
        table: counted.table,
        fk: link.field,
        key: entity.primaryKey[0],
        where: link.where.map(c => parse(c.field, c.op === "=" ? "eq" : "ne", c.value)),
        function: sqlName(`osl_count_${entity.table}_${name}`),
        trigger: sqlName(`osl_count_${entity.table}_${name}`)
      };
      // Rows ordered within the relation they are counted by: an append takes the parent as a move does
      if (counted.order?.within === link.field) count.hold = sqlName(`osl_count_hold_${counted.table}`);
      return count;
    });
  }

  // Archiving entities: the column, and the rule archive and restore run under
  for (const entity of entities) {
    const archive = archiveOf(allEntities[entity.name]);
    if (!archive) continue;
    const rule = archive.rule
      ? parseRule(
          archive.rule,
          entity.rules.update,
          path => hopsFrom(entity.name, path),
          conditionOn(entity.name),
          path => memberPathFrom(entity.name, path)
        )
      : entity.rules.update;
    entity.archive = { column: archive.field, rule: archive.rule ? withinTenant(entity.name, rule) : rule };
  }

  // State machines: the column, its values, and each step with the rule it runs under
  for (const entity of entities) {
    const machine = transitionsOf(allEntities[entity.name]);
    if (!machine) continue;
    entity.transitions = {
      column: machine.field,
      values: allEntities[entity.name].fields[machine.field].enum_values ?? [],
      steps: machine.steps.map(step => {
        const rule = step.rule
          ? withinTenant(
              entity.name,
              parseRule(
                step.rule,
                entity.rules.update,
                path => hopsFrom(entity.name, path),
                conditionOn(entity.name),
                path => memberPathFrom(entity.name, path)
              )
            )
          : entity.rules.update;
        const out: TransitionIR = { name: step.name, from: step.from, to: step.to, rule };
        if (step.stamp) out.stamp = step.stamp;
        return out;
      })
    };
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
          !c.readOnly &&
          !isBytes(c) &&
          // A sealed field, and a value whose shape follows an enum, are written through the resource or a handler
          !c.sealed &&
          !c.shapeBy &&
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
      if (t.isolation === "database") {
        const tenantEntity = entityByName(t.entity);
        auth.tenancy.isolation = {
          appRole: sqlName(`${toSnakeCase(model.name).replace(/[^a-z0-9_]/g, "_")}_app`),
          setting: `app.${toSnakeCase(t.entity)}_ids`,
          tenantType: sqlType(tenantEntity.columns.find(c => c.name === tenantEntity.primaryKey[0])!),
          memberships: "osl_memberships"
        };
      }
    }
    const plans = invitePlans(model);
    if (plans.length)
      auth.invites = plans.map(plan => {
        const parent = entityByName(plan.parent);
        const invite: InviteIR = {
          membership: plan.membership,
          membershipTable: tableOf(plan.membership),
          parent: plan.parent,
          parentTable: parent.table,
          parentKey: parent.primaryKey[0],
          parentColumn: plan.parentField,
          userColumn: plan.memberField,
          rule: entityByName(plan.entity).rules.create,
          expires: durationSeconds(plan.expires),
          entity: plan.entity,
          table: plan.table,
          resource: plan.resource
        };
        if (plan.roleField) {
          invite.roleColumn = plan.roleField;
          invite.roles = plan.roles;
        }
        const path = auth!.tenancy ? tenantChain(entities, auth!.tenancy.entity, parent) : null;
        if (path) invite.tenantPath = path;
        if (auth!.tenancy?.isolation && entityByName(plan.entity).tenant)
          invite.isolation = {
            byToken: sqlName(`osl_invite_${plan.table}`),
            byEmail: sqlName(`osl_invites_${plan.table}`)
          };
        return invite;
      });
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
      rule: parseRule(
        action.rule,
        fallback,
        resource ? path => hopsFrom(resource.entity.name, path) : undefined,
        resource ? conditionOn(resource.entity.name) : undefined,
        resource ? path => memberPathFrom(resource.entity.name, path) : undefined
      ),
      returns,
      handler: owner
    };
    // A row action on a tenant table reaches its row as a member of the row's tenant, like update and delete
    if (resource && scope === "row") out.rule = withinTenant(resource.entity.name, out.rule);
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
      .filter(c => !c.primary && !c.hidden && !c.readOnly && !isBytes(c) && !isGeneratedDefault(c))
      .map(c => c.name);
    const throughNames = new Set((entity.through ?? []).map(t => t.name));
    /** An include list as the model wrote it, split into the relations of fields and the ones through a junction */
    const includes = (names: string[] | undefined): { include: string[]; through?: string[] } => {
      const through = (names ?? []).filter(n => throughNames.has(n));
      const include = (names ?? []).filter(n => !throughNames.has(n));
      return through.length ? { include, through } : { include };
    };
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
            ...includes(resource.list?.include),
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
            ...includes(resource.get?.include),
            rule: entity.rules.read
          });
          break;
        case "create": {
          const rule = entity.rules.create;
          const ownerField = directOwnerOf(rule);
          const fields = (resource.create?.fields ?? writable).filter(f => f !== ownerField);
          const invite = auth?.invites?.find(i => i.resource === resourceName);
          operations.push({
            kind,
            method: "POST",
            path,
            fields,
            ownerField,
            rule,
            ...(invite ? { invite: invite.membership } : {})
          });
          break;
        }
        case "update": {
          // A plain owner rule keeps the owner column out of update, so a row cannot be handed to someone else;
          // with alternatives (an admin may reassign) the column stays writable
          const rule = entity.rules.update;
          const ownerField = ruleAlternatives(rule).length === 1 ? directOwnerOf(rule) : undefined;
          // An ordered row keeps its parent: its place is among that parent's rows. A numbered row keeps the
          // scope its number was counted in.
          const scoped = new Set((entity.sequences ?? []).flatMap(s => s.scope));
          const fields = (resource.update?.fields ?? writable).filter(
            f => f !== ownerField && f !== entity.order?.within && !scoped.has(f)
          );

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
    // The compiler's own row action on an ordered entity: no handler of the user's, the database reorders
    if (entity.order && entity.rules.update.kind !== "none") {
      const move = compileAction(
        MOVE_ACTION,
        {
          description: `Moves the row to place \`to\` among the rows of its ${entity.order.within} (1 is first; past the end is last)`,
          input: { to: { type: "integer", required: true, validate: { min: 1 } } }
        },
        { name: resourceName, entity, path }
      );
      move.builtin = "move";
      actions.push(move);
    }
    // The compiler's own row actions on an archiving entity: a conditional update each, no handler of the user's
    if (entity.archive && entity.archive.rule.kind !== "none") {
      const declared = allEntities[entity.name].archive;
      const rule = declared === true ? undefined : declared?.rule;
      for (const name of ARCHIVE_ACTIONS) {
        const action = compileAction(
          name,
          {
            description:
              name === "archive"
                ? `Archives the row: sets ${entity.archive.column}, and lists leave it out unless asked with ?${ARCHIVED_PARAM}=true. 409 when it is archived already`
                : `Restores an archived row: clears ${entity.archive.column}. 409 when it is not archived`,
            ...(rule ? { rule } : {})
          },
          { name: resourceName, entity, path }
        );
        action.builtin = name;
        actions.push(action);
      }
    }
    // The compiler's own row action per step of a state machine: one conditional update, no handler of the user's.
    // A step whose rule is none has no route; it stays an action so a timer can run it
    for (const step of entity.transitions?.steps ?? []) {
      const declared = transitionsOf(allEntities[entity.name])!.steps.find(s => s.name === step.name)!;
      const action = compileAction(
        step.name,
        {
          description: `Moves the row's ${entity.transitions!.column} from ${step.from.join(" or ")} to ${step.to}${step.stamp ? ` and sets ${step.stamp}` : ""}. 409 (invalid_transition) when the row is in another state`,
          ...(declared.rule ? { rule: declared.rule } : {})
        },
        { name: resourceName, entity, path }
      );
      action.builtin = "transition";
      actions.push(action);
    }
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
          magic_link_verify: "/api/auth/magic-link/verify",
          invite: "/api/auth/invites/{token}",
          invite_accept: "/api/auth/invites/{token}/accept"
        };
        resolved = {
          kind: "auth",
          operation: target.operation,
          method: target.operation === "me" || target.operation === "invite" ? "GET" : "POST",
          pathTemplate: paths[target.operation]
        };
        break;
      }
      case "timer":
        resolved = { kind: "timer", operation: "run", method: "POST", pathTemplate: "/api/osl-hooks/timers/run" };
        break;
      case "schedule":
        resolved = { kind: "schedule", operation: "run", method: "POST", pathTemplate: "/api/osl-hooks/schedules/run" };
        break;
      case "email":
        resolved = { kind: "email", operation: "sent", method: "GET", pathTemplate: "/api/osl-hooks/emails" };
        break;
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
    const filterIR = (filter: Record<string, string | number | boolean> | undefined) =>
      Object.fromEntries(
        Object.entries(filter ?? {}).map(([k, v]): [string, PageFilterValue] => [
          k,
          v === "{actor.id}"
            ? { actor: "id" }
            : v === "{row.id}"
              ? { row: "id" }
              : v === "{tenant.id}"
                ? { tenant: "id" }
                : v
        ])
      );
    const modelPages = model.app.pages;
    const pages: PageIR[] = Object.entries(model.app.pages).map(([name, page]) => {
      const common = {
        name,
        kind: page.kind,
        path: pagePathOf(name, page),
        title: page.title ?? toTitleCase(name),
        description: page.description,
        tiles: [] as TileIR[],
        recent: [] as PageIR["recent"],
        sections: [] as SectionIR[],
        access: parseRule(page.access ?? (model.auth ? "authenticated" : "public"), { kind: "public" }),
        ...(page.refresh ? { refresh: page.refresh } : {})
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
              filter: filterIR(t.filter)
            };
            if (t.icon) tile.icon = t.icon;
            if (t.group_by) {
              const tileResource = resources.find(r => r.name === t.resource)!;
              const tileEntity = entityByName(tileResource.entity);
              const column = tileEntity.columns.find(c => c.name === t.group_by)!;
              if (column.type.kind === "enum") {
                const enumName = column.type.name;
                tile.groupBy = {
                  field: t.group_by,
                  kind: "enum",
                  values: enums.find(e => e.name === enumName)!.values
                };
              } else {
                const fk = tileEntity.foreignKeys.find(f => f.column === t.group_by)!;
                const target = entityByName(fk.targetEntity);
                const targetResource = resources.find(
                  r => r.entity === fk.targetEntity && r.operations.some(o => o.kind === "list")
                )!;
                tile.groupBy = {
                  field: t.group_by,
                  kind: "relation",
                  resource: targetResource.name,
                  entity: fk.targetEntity,
                  key: fk.targetColumn,
                  display: target.display
                };
              }
            }
            return tile;
          }),
          recent: (page.recent ?? []).map(r => ({ resource: r.resource, limit: r.limit, filter: filterIR(r.filter) }))
        };
      }
      const resource = resources.find(r => r.name === page.resource)!;
      const entity = entityByName(resource.entity);
      const isThrough = (name: string) => Boolean(entity.through?.some(t => t.name === name));
      if (page.kind === "detail") {
        const out: PageIR = {
          ...common,
          resource: resource.name,
          entity: entity.name,
          columns: [],
          fields: page.fields ?? resource.outputFields,
          sections: (page.sections ?? []).map(s => {
            const listed = resources.find(r => r.name === s.resource)!;
            const listedEntity = entityByName(listed.entity);
            const section: SectionIR = {
              resource: listed.name,
              entity: listedEntity.name,
              title: s.title ?? titleOf(s.resource),
              filter: filterIR(s.filter),
              columns: s.columns ?? sectionColumns(listedEntity, listed.outputFields, Object.keys(s.filter)),
              limit: s.limit ?? 10,
              create: s.create ?? false
            };
            if (s.order?.length) section.order = s.order[0];
            return section;
          })
        };
        // Inside a list the page is behind the list's gate: it opens for whoever the list opens for
        const listPage = takenOverPage(modelPages, name);
        if (listPage) {
          out.listPage = listPage;
          out.access = parseRule(modelPages[listPage].access ?? (model.auth ? "authenticated" : "public"), {
            kind: "public"
          });
        }
        return out;
      }
      const out: PageIR = {
        ...common,
        resource: resource.name,
        entity: entity.name,
        layout: page.layout ?? "split",
        columns: (page.columns ?? defaultColumns(entity, resource.outputFields)).filter(c => !isThrough(c)),
        fields: (page.fields ?? resource.outputFields).filter(f => !isThrough(f)),
        ...((page.columns ?? []).some(isThrough) ? { relations: (page.columns ?? []).filter(isThrough) } : {})
      };
      if (page.group_by) out.groupBy = page.group_by;
      if (page.filter && Object.keys(page.filter).length) out.filter = filterIR(page.filter);
      const detailPage = Object.keys(modelPages).find(other => takenOverPage(modelPages, other) === name);
      if (detailPage) out.detailPage = detailPage;
      return out;
    });
    app = { title: model.app.title ?? model.name, pages };
    const tenancyEntity = model.auth?.tenancy?.entity;
    const usesTenant = pages.some(page =>
      [
        page.filter,
        ...page.tiles.map(t => t.filter),
        ...page.recent.map(r => r.filter),
        ...page.sections.map(s => s.filter)
      ]
        .flatMap(filter => Object.values(filter ?? {}))
        .some(value => typeof value === "object" && "tenant" in value)
    );
    if (usesTenant && tenancyEntity) {
      const listing = resources.find(r => r.entity === tenancyEntity && r.operations.some(o => o.kind === "list"))!;
      app.tenant = { resource: listing.name, entity: tenancyEntity, labelColumn: entityByName(tenancyEntity).display };
    }
    if (model.app.sidebar) {
      app.sidebar = {
        items: model.app.sidebar.items.map(item => {
          const page = pages.find(p => p.name === item.page)!;
          const out: SidebarItemIR = {
            page: page.name,
            path: page.path,
            label: item.label ?? page.title,
            access: page.access
          };
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

  // Schedules and timers run action handlers as the system through the job queue
  const systemRun = (run: string): SystemRunIR => {
    const [ns, name] = run.split(".");
    const action = actions.find(a => a.name === name && (ns === "actions" ? !a.resource : a.resource === ns))!;
    return action.resource
      ? { resource: action.resource, action: action.name, handler: action.handler }
      : { action: action.name, handler: action.handler };
  };
  const scheduleNames = new Map<string, number>();
  const schedules: ScheduleIR[] = model.schedules.map(sch => {
    const run = systemRun(sch.run);
    const seen = (scheduleNames.get(run.handler) ?? 0) + 1;
    scheduleNames.set(run.handler, seen);
    return { name: seen === 1 ? run.handler : `${run.handler}_${seen}`, cron: sch.cron, run, input: sch.input ?? {} };
  });
  const timerNames = new Map<string, number>();
  const timers: TimerIR[] = model.timers.map(t => {
    const run = systemRun(t.run);
    const base = `${toSnakeCase(t.on)}_${t.at}`;
    const seen = (timerNames.get(base) ?? 0) + 1;
    timerNames.set(base, seen);
    const timer: TimerIR = {
      name: seen === 1 ? base : `${base}_${seen}`,
      entity: t.on,
      table: tableOf(t.on),
      column: t.at,
      afterSeconds: t.after ? durationSeconds(t.after) : 0,
      run
    };
    if (t.when) {
      const when = splitCondition(t.when)!;
      timer.when = conditionOn(t.on)(when.field, when.op === "=" ? "eq" : "ne", when.value);
    }
    return timer;
  });

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
    schedules,
    timers,
    jobs: events.some(e => e.delivery === "queue") || schedules.length || timers.length ? { queue: true } : undefined,
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
  // An ordered entity lists in its own order: parent by parent, each in place
  if (entity.order)
    return [
      [entity.order.within, "asc"],
      [entity.order.column, "asc"]
    ];
  // A field with a read rule never orders a list: the order would tell what the rule keeps back
  if (entity.columns.some(c => c.name === "created_at" && !c.read)) return [["created_at", "desc"]];
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
  // A row is named by a column every reader of it gets, so one with a read rule is passed over
  const pick = (test: (c: ColumnIR) => boolean) => columns.find(c => !c.hidden && !c.read && !isKey(c) && test(c));
  const named = pick(c => ["title", "name", "label"].includes(c.name));
  if (named) return named.name;
  const text = pick(c => c.type.kind === "scalar" && c.type.scalar === "string");
  if (text) return text.name;
  const any = pick(c => c.type.kind === "scalar" && c.type.scalar === "text");
  if (any) return any.name;
  return primaryKey[0];
}

/** Master list columns when a page declares none: the display column, then up to three more short columns. */
/** A section's columns when it declares none: a list's default columns without the fields its filter fixes. */
function sectionColumns(entity: EntityIR, outputFields: string[], fixed: string[]): string[] {
  const free = outputFields.filter(f => !fixed.includes(f));
  const out = defaultColumns(entity, free).filter(c => !fixed.includes(c));
  return out.length ? out : [entity.primaryKey[0]];
}

function defaultColumns(entity: EntityIR, outputFields: string[]): string[] {
  const shorts = entity.columns.filter(
    c =>
      outputFields.includes(c.name) &&
      !c.primary &&
      !c.sealed &&
      !entity.foreignKeys.some(fk => fk.column === c.name) &&
      isShortScalar(c)
  );
  const out = [entity.display, ...shorts.map(c => c.name).filter(n => n !== entity.display)].slice(0, 4);
  return out.length ? out : [entity.primaryKey[0]];
}

/** The columns of an entity that carry a read rule: present in a response only for a caller the rule allows */
export function ruledColumns(entity: EntityIR): ColumnIR[] {
  return entity.columns.filter(c => c.read !== undefined && !c.hidden);
}

/** The sealed columns of an entity: bytea in the database, a string to a writer and to a reader the rule allows */
export function sealedColumns(entity: EntityIR): ColumnIR[] {
  return entity.columns.filter(c => c.sealed);
}

/** Whether the model has a sealed field, so the app needs OSL_SEAL_KEY and refuses to start without it */
export function hasSealed(ir: IR): boolean {
  return ir.entities.some(e => sealedColumns(e).length > 0);
}

/** The names sealed values are bound to, `<table>.<column>`, in model order */
export function sealedNames(ir: IR): string[] {
  return ir.entities.flatMap(e => sealedColumns(e).map(c => `${e.table}.${c.name}`));
}

/** The JSON columns of an entity whose value has a declared shape, one or one per enum value */
export function shapedColumns(entity: EntityIR): ColumnIR[] {
  return entity.columns.filter(c => c.shape !== undefined || c.shapeBy !== undefined);
}

/** Whether any entity has a field with a read rule, so presenters take a viewer and the session answers `fields` */
export function hasFieldRules(ir: IR): boolean {
  return ir.entities.some(e => ruledColumns(e).length > 0);
}

/**
 * Whether a caller without a session could read a field under this rule on some row: an alternative made of public
 * predicates. What the pages assume of a visitor, for whom the session answers no `fields`.
 */
export function anonymousCouldRead(rule: RuleIR): boolean {
  return sessionFreeAlternatives(rule).length > 0;
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
/** The actions whose handler the user owns in src/actions: every one but the compiler's own (`move`, `archive`, `restore`, a transition) */
export function userActions(ir: IR): ActionIR[] {
  return ir.actions.filter(a => !a.builtin);
}

/**
 * The compiler's own row actions that are one statement on the row and take no input: `archive`, `restore` and the
 * transitions. A request runs them after the rule; a timer runs them as the system, as it runs a handler.
 */
export function statementActions(ir: IR): ActionIR[] {
  return ir.actions.filter(a => a.builtin === "archive" || a.builtin === "restore" || a.builtin === "transition");
}

/** The step of the entity's state machine behind a transition action */
export function transitionOf(ir: IR, action: ActionIR): TransitionIR {
  const step =
    action.builtin === "transition"
      ? entityOf(ir, action.entity!).transitions?.steps.find(s => s.name === action.name)
      : undefined;
  if (!step) throw new Error(`action ${action.resource}.${action.name} is not a transition`);
  return step;
}

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
