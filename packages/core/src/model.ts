/**
 * The OSL 1.0 model: the declared state of an application.
 * `.osl/model.yaml` is written by `osl apply`, never by hand.
 */
import { z } from "zod";
import { toSnakeCase } from "./naming.js";

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

/** The conditions of a count: `done = false`, `done = false and archived_at = null` */
const COUNT_WHERE_PATTERN =
  /^[a-z][a-z0-9_]* (?:=|!=) [A-Za-z0-9_.+-]+(?: and [a-z][a-z0-9_]* (?:=|!=) [A-Za-z0-9_.+-]+)*$/;

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
    /**
     * Integer fields only: the row's place among the rows that share `within`, a required relation field of the
     * entity. The server owns it: create appends, the resource's `move` action reorders, lists follow it.
     */
    position: z.object({ within: Identifier }).strict().optional(),
    /**
     * Integer fields only: how many rows a reverse relation of the entity holds (`count_of: comments`, where
     * Comment.post_id declares `reverse: comments`). The database keeps it with a trigger; nothing writes it.
     */
    count_of: Identifier.optional(),
    /** With count_of: only the related rows these conditions hold for count, in the rules' spelling, joined with " and " */
    where: z
      .string()
      .regex(
        COUNT_WHERE_PATTERN,
        "<field> = <value> or <field> != <value> on fields of the counted entity, joined with ' and '"
      )
      .optional(),
    description: z.string().optional()
  })
  .strict()
  .superRefine((field, ctx) => {
    if (field.count_of && field.type !== "integer")
      ctx.addIssue({ code: "custom", message: "count_of only applies to integer fields" });
    if (
      field.count_of &&
      (field.primary ||
        field.unique ||
        field.hidden ||
        field.relation ||
        field.default !== undefined ||
        field.validate ||
        field.position)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "a count_of field is a plain integer the database keeps: no primary, unique, hidden, relation, default, validate or position"
      });
    if (field.where !== undefined && !field.count_of)
      ctx.addIssue({ code: "custom", message: "where only applies to a count_of field" });
    if (field.position && field.type !== "integer")
      ctx.addIssue({ code: "custom", message: "position only applies to integer fields" });
    if (
      field.position &&
      (field.primary || field.unique || field.hidden || field.relation || field.default !== undefined || field.validate)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "a position field is a plain integer the server numbers: no primary, unique, hidden, relation, default or validate"
      });
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

/** How a tenant table reaches its tenant under `isolation: database` */
export interface TenantLink {
  /** The column holding the row's tenant: the tenant's own key, the declared relation, or the column the compiler derives */
  field: string;
  /** The required relation a derived column copies the tenant through; absent when the model declares the column */
  through?: string;
  /** The member path a rule follows from a row to its tenant: `id`, `team_id`, `project_id.team_id` */
  path: string[];
}

/** Why an entity cannot be placed under `isolation: database`, as validation reports it */
export interface TenantLinkProblem {
  entity: string;
  code: "M115" | "M116" | "M118";
  level: "error" | "warning";
  message: string;
}

/** Whether the model asks for the database backstop */
export function isolated(model: Model): boolean {
  return model.auth?.tenancy?.isolation === "database";
}

/** The column the compiler derives on a tenant table that does not declare its tenant: `team_id` for a tenant Team */
export function derivedTenantField(tenantEntity: string): string {
  return `${toSnakeCase(tenantEntity)}_id`;
}

/**
 * The tenant tables of a model under `isolation: database`: the tenant entity, and every entity that reaches it
 * through a chain of required relations. An entity with one required relation to the tenant carries the tenant in
 * that field; one that reaches it through exactly one required relation to another tenant table gets a derived
 * column. Anything else is a problem (two ways to the tenant) or stays shared (only an optional relation).
 * Empty without `isolation: database`.
 */
export function tenantLinks(model: Model): { links: Record<string, TenantLink>; problems: TenantLinkProblem[] } {
  const links: Record<string, TenantLink> = {};
  const problems: TenantLinkProblem[] = [];
  const tenancy = model.auth?.tenancy;
  if (!tenancy || !isolated(model) || !model.entities[tenancy.entity]) return { links, problems };
  const tenant = tenancy.entity;
  const relationsOf = (name: string, required: boolean) =>
    Object.entries(model.entities[name].fields).filter(
      ([, f]) => f.relation && model.entities[f.relation.entity] && Boolean(f.required || f.primary) === required
    );
  // Which entities reach the tenant through required relations, whatever the order they are declared in
  const reaching = new Set<string>([tenant]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const name of Object.keys(model.entities)) {
      if (reaching.has(name)) continue;
      if (relationsOf(name, true).some(([, f]) => reaching.has(f.relation!.entity))) {
        reaching.add(name);
        grew = true;
      }
    }
  }
  const tenantKey = primaryKeyFields(model.entities[tenant])[0] ?? "id";
  links[tenant] = { field: tenantKey, path: [tenantKey] };
  const derived = derivedTenantField(tenant);
  const pending = new Map<string, string>();
  for (const name of Object.keys(model.entities)) {
    if (name === tenant) continue;
    if (!reaching.has(name)) {
      const optional = relationsOf(name, false).filter(([, f]) => reaching.has(f.relation!.entity));
      if (optional.length && name !== model.auth?.identity)
        problems.push({
          entity: name,
          code: "M116",
          level: "warning",
          message: `${name} reaches ${tenant} only through an optional relation (${optional.map(([n]) => n).join(", ")}), so it stays shared and no policy guards it; say required: true to make it a tenant table`
        });
      continue;
    }
    if (name === model.auth?.identity) {
      problems.push({
        entity: name,
        code: "M118",
        level: "error",
        message: `${name} is the identity and reaches ${tenant} through a required relation; under isolation: database the identity stays shared, since signing in reads it before any tenant is known`
      });
      continue;
    }
    const required = relationsOf(name, true).filter(([, f]) => reaching.has(f.relation!.entity));
    const direct = required.filter(([, f]) => f.relation!.entity === tenant);
    const indirect = required.filter(([, f]) => f.relation!.entity !== tenant && f.relation!.entity !== name);
    if (direct.length === 1) links[name] = { field: direct[0][0], path: [direct[0][0]] };
    else if (direct.length > 1)
      problems.push({
        entity: name,
        code: "M115",
        level: "error",
        message: `${name} has ${direct.length} required relations to ${tenant} (${direct.map(([n]) => n).join(", ")}); under isolation: database a row belongs to one tenant, so keep one of them required`
      });
    else if (indirect.length === 1) {
      if (model.entities[name].fields[derived])
        problems.push({
          entity: name,
          code: "M115",
          level: "error",
          message: `${name} reaches ${tenant} through ${indirect[0][0]}, and its own field ${derived} is not a required relation to ${tenant}; make it one or rename it, since the compiler derives a column of that name`
        });
      else pending.set(name, indirect[0][0]);
    } else
      problems.push({
        entity: name,
        code: "M115",
        level: "error",
        message: `${name} reaches ${tenant} through ${indirect.length} required relations (${indirect.map(([n]) => n).join(", ")}); declare a required relation to ${tenant} on ${name} itself so its tenant is one column`
      });
  }
  // A derived column copies its parent's tenant, so parents resolve first; a parent with a problem leaves its children out
  for (let resolved = true; resolved && pending.size; ) {
    resolved = false;
    for (const [name, through] of pending) {
      const parent = links[model.entities[name].fields[through].relation!.entity];
      if (!parent) continue;
      links[name] = { field: derived, through, path: [through, ...parent.path] };
      pending.delete(name);
      resolved = true;
    }
  }
  return { links, problems };
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
/** The position field of an entity and the relation field its rows are ordered within; undefined without one */
export function positionOf(entity: Entity | undefined): { field: string; within: string } | undefined {
  for (const [name, field] of Object.entries(entity?.fields ?? {}))
    if (field.position) return { field: name, within: field.position.within };
  return undefined;
}

/** A relation through a junction, resolved: the junction, its two relation fields and the entity on the far side */
export interface ThroughLink {
  junction: string;
  /** The junction's relation field pointing at the entity the relation is declared on */
  from: string;
  /** The junction's relation field pointing at the far entity */
  to: string;
  target: string;
}

/**
 * The relation `name` declared under `relations` on `entityName`, resolved against its junction. Null when the
 * entity declares no such relation; a problem when the junction does not link the two sides unambiguously.
 */
export function throughRelation(
  model: Model,
  entityName: string,
  name: string
): ThroughLink | { problem: string } | null {
  const declared = model.entities[entityName]?.relations?.[name];
  if (!declared) return null;
  const junction = model.entities[declared.through];
  if (!junction) return { problem: `junction ${declared.through} does not exist` };
  const relationFields = Object.entries(junction.fields).filter(([, f]) => f.relation);
  let from = declared.from;
  if (from) {
    if (junction.fields[from]?.relation?.entity !== entityName)
      return { problem: `from ${from} is not a relation field of ${declared.through} to ${entityName}` };
  } else {
    const near = relationFields.filter(([n, f]) => f.relation!.entity === entityName && n !== declared.to);
    if (near.length === 0) return { problem: `${declared.through} has no relation field to ${entityName}` };
    if (near.length > 1)
      return {
        problem: `${declared.through} has ${near.length} relation fields to ${entityName} (${near.map(([n]) => n).join(", ")}); name one with from`
      };
    from = near[0][0];
  }
  let to = declared.to;
  if (to) {
    if (!junction.fields[to]?.relation) return { problem: `to ${to} is not a relation field of ${declared.through}` };
    if (to === from)
      return { problem: `from and to are both ${to}; a relation through a junction links two of its relation fields` };
  } else {
    const far = relationFields.filter(([n]) => n !== from);
    if (far.length === 0) return { problem: `${declared.through} has no second relation field for the far side` };
    if (far.length > 1)
      return {
        problem: `${declared.through} has ${far.length} relation fields besides ${from} (${far.map(([n]) => n).join(", ")}); name one with to`
      };
    to = far[0][0];
  }
  return { junction: declared.through, from, to, target: junction.fields[to].relation!.entity };
}

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

/** A relation to the rows on the far side of a junction entity: a track's genres through TrackGenre */
export const ThroughRelation = z
  .object({
    /** The junction: an entity with a relation field to this entity and one to the far entity */
    through: EntityName,
    /** The junction's relation field pointing at this entity; needed only when it has several */
    from: Identifier.optional(),
    /** The junction's relation field pointing at the far entity; needed only when it has several others */
    to: Identifier.optional()
  })
  .strict();
export type ThroughRelation = z.infer<typeof ThroughRelation>;

/** The field `archive: true` adds and reads when the entity names no other */
export const ARCHIVE_FIELD = "archived_at";

/** How an entity archives when `true` does not say it all */
export const ArchiveOptions = z
  .object({
    /** The nullable datetime that holds when the row was archived; default archived_at, added when the entity lacks it */
    field: Identifier.optional(),
    /** Who may archive and restore; default the entity's update rule */
    rule: Rule.optional()
  })
  .strict();
export type ArchiveOptions = z.infer<typeof ArchiveOptions>;

export const Entity = z
  .object({
    table: Identifier.optional(),
    description: z.string().optional(),
    fields: z.record(Identifier, Field),
    /** Many-to-many: relations to the rows a junction entity links this one to, by name */
    relations: z.record(Identifier, ThroughRelation).optional(),
    /**
     * Rows can be archived: a server-owned datetime says when, lists leave archived rows out unless asked
     * (`?archived=true`), and every resource over the entity gets the row actions `archive` and `restore`.
     */
    archive: z.union([z.literal(true), ArchiveOptions]).optional(),
    rules: Rules.optional(),
    indexes: z.array(Index).optional(),
    /** Multi-column unique constraints */
    unique: z.array(z.array(Identifier).min(1)).optional()
  })
  .strict()
  // The archive field is the compiler's to add: a model that says `archive: true` is written back with the field
  // spelled out, so everything that reads the model (rules, pages, filters, diffs) sees an ordinary read-only field
  .transform(entity => {
    if (!entity.archive) return entity;
    const name = (entity.archive === true ? undefined : entity.archive.field) ?? ARCHIVE_FIELD;
    if (entity.fields[name]) return entity;
    return { ...entity, fields: { ...entity.fields, [name]: { type: "datetime" as const, read_only: true } } };
  });
export type Entity = z.infer<typeof Entity>;

/** The archive of an entity, resolved: the field that holds when, and the rule of archive and restore when it names one */
export function archiveOf(entity: Entity | undefined): { field: string; rule?: string } | undefined {
  if (!entity?.archive) return undefined;
  const options = entity.archive === true ? {} : entity.archive;
  const out: { field: string; rule?: string } = { field: options.field ?? ARCHIVE_FIELD };
  if (options.rule) out.rule = options.rule;
  return out;
}

/** The row actions the compiler writes on a resource over an archiving entity */
export const ARCHIVE_ACTIONS = ["archive", "restore"] as const;
export type ArchiveAction = (typeof ARCHIVE_ACTIONS)[number];

/** The list parameter of an archiving entity: `?archived=true` answers the archived rows instead of the live ones */
export const ARCHIVED_PARAM = "archived";

/** A count_of field resolved against the model: the entity whose rows it counts and the relation field they point with */
export interface CountLink {
  entity: string;
  /** The counted entity's relation field that declares the reverse relation */
  field: string;
  /** The conditions of `where`, as written */
  where: RuleCondition[];
}

/**
 * The reverse relation `count_of` names on `entityName`, resolved. A problem when no other entity's relation field
 * declares that reverse name towards this entity, or when it is a one-to-one (at most one row: nothing to count).
 */
export function countLink(model: Model, entityName: string, field: Field): CountLink | { problem: string } | null {
  if (!field.count_of) return null;
  const where = (field.where ?? "")
    .split(" and ")
    .map(part => splitCondition(part.trim()))
    .filter((c): c is RuleCondition => Boolean(c));
  for (const [otherName, other] of Object.entries(model.entities))
    for (const [fieldName, f] of Object.entries(other.fields)) {
      if (f.relation?.entity !== entityName || f.relation.reverse !== field.count_of) continue;
      if (f.relation.kind === "one_to_one")
        return {
          problem: `${field.count_of} is a one-to-one relation (${otherName}.${fieldName}): there is at most one row to count`
        };
      return { entity: otherName, field: fieldName, where };
    }
  if (model.entities[entityName]?.relations?.[field.count_of])
    return {
      problem: `${field.count_of} is a relation through a junction; count the junction's rows instead: give its relation field to ${entityName} a reverse name and count that`
    };
  return {
    problem: `${field.count_of} is not a reverse relation of ${entityName}: no relation field of another entity points at ${entityName} with reverse: ${field.count_of}`
  };
}

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
    creator_role: z.string().min(1),
    /**
     * `database` adds a backstop behind the rules: row-level security on every tenant table, composite keys so no
     * row points at another tenant's parent, and a database role for the web process that the policies bind.
     * Absent or `none`: the rules alone, as before.
     */
    isolation: z.enum(["none", "database"]).optional()
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

/** A duration a timer waits after its field's time: 15m, 48h, 30d */
export const DURATION_PATTERN = /^(\d+)(m|h|d)$/;
export const Duration = z.string().regex(DURATION_PATTERN, "a duration like 15m, 48h or 30d");

export function durationSeconds(text: string): number {
  const m = text.match(DURATION_PATTERN)!;
  const n = Number(m[1]);
  return n * (m[2] === "m" ? 60 : m[2] === "h" ? 3600 : 86400);
}

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
export const AUTH_STEP_OPS = ["register", "login", "logout", "me", "magic_link", "magic_link_verify"] as const;
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
  return isWritable(field) && !field.read_only && !field.position && !field.count_of;
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

  /**
   * `isolation: database`: which entities are tenant tables (M115, M116, M118), and what their rules may say. A
   * caller without a session reaches a tenant table only through its read rule (M117), and every alternative that
   * needs a session also needs a membership of the row's tenant: the compiler adds it, and M119 says where.
   */
  const checkIsolation = (tenantName: string, tenant: Entity) => {
    const { links, problems } = tenantLinks(model);
    for (const p of problems) (p.level === "error" ? error : warn)(p.code, p.message, `entities.${p.entity}`);
    const keyName = primaryKeyFields(tenant)[0];
    const key = keyName ? tenant.fields[keyName] : undefined;
    if (key && (key.type !== "uuid" || (key.default !== undefined && key.default !== "uuid")))
      error(
        "M118",
        `${tenantName}.${keyName} must be a uuid the app can generate (type: uuid, no literal default): under isolation: database a new ${tenantName} is bound to its creator before the insert`,
        `entities.${tenantName}.fields.${keyName}`
      );
    const check = (
      rule: string,
      entityName: string,
      rpath: string,
      op: "read" | "create" | "update" | "delete" | "action"
    ) => {
      const link = links[entityName];
      if (!link) return;
      const member = `member:${link.path.join(".")}`;
      const narrowed: string[] = [];
      for (const alternative of ruleAlternativeTexts(rule)) {
        const bases = conjunctionParts(alternative).map(part => splitWhen(part).base);
        const open = bases.filter(b => b === "public").length;
        if (open === bases.length) {
          if (op !== "read")
            error(
              "M117",
              `"${alternative}" lets a caller without a session ${op === "action" ? "run this action on" : op} a ${entityName}, a tenant table under isolation: database; only its read rule may have a public alternative`,
              rpath
            );
          continue;
        }
        if (open > 0) {
          error(
            "M117",
            `"${alternative}": under isolation: database put the condition on the predicate that needs a session instead of joining public to it`,
            rpath
          );
          continue;
        }
        if (bases.includes("none")) continue;
        if (bases.some(b => b === member || b.startsWith(`${member}:`))) continue;
        if (entityName === tenantName && op === "create") continue;
        narrowed.push(alternative);
      }
      if (narrowed.length)
        warn(
          "M119",
          `under isolation: database a signed-in caller reaches a ${entityName} only as a member of its ${tenantName}: ${narrowed.map(a => `"${a}" is compiled as "${a} and ${member}"`).join(", ")}`,
          rpath
        );
    };
    for (const [entityName, entity] of Object.entries(model.entities)) {
      for (const op of RULE_OPERATIONS)
        check(
          entity.rules?.[op] ?? (op === "read" ? "public" : "authenticated"),
          entityName,
          `entities.${entityName}.rules.${op}`,
          op
        );
    }
    for (const [resourceName, resource] of Object.entries(model.resources)) {
      for (const [actionName, action] of Object.entries(resource.actions ?? {})) {
        if (action.rule && (action.scope ?? "row") === "row")
          check(action.rule, resource.entity, `resources.${resourceName}.actions.${actionName}.rule`, "action");
      }
    }
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
        !field.position &&
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
    const positions = Object.entries(entity.fields).filter(([, f]) => f.position);
    if (positions.length > 1)
      error(
        "M141",
        `${entityName} has ${positions.length} position fields (${positions.map(([n]) => n).join(", ")}); a row has one place in one parent`,
        base
      );
    for (const [fieldName, field] of positions) {
      const fpath = `${base}.fields.${fieldName}.position`;
      const within = entity.fields[field.position!.within];
      if (!within?.relation || !within.required || within.primary || within.relation.kind === "one_to_one")
        error(
          "M140",
          `position within ${field.position!.within}: it must be a required many_to_one relation field of ${entityName}, the parent whose rows are ordered`,
          fpath
        );
      else if (within.relation.entity === entityName)
        error(
          "M140",
          `position within ${field.position!.within}: an order within the entity's own rows is a tree, which has no construct; order within another entity`,
          fpath
        );
      if (primaries.length > 1 || (primaries.length === 0 && !entity.fields.id))
        error(
          "M142",
          `${entityName} has a position field, so it needs a single-column primary key (an id) to move a row by`,
          fpath
        );
    }
    const ownRelationNames = new Set(fieldRelationNamesOf(model, entityName));
    for (const name of Object.keys(entity.relations ?? {})) {
      const rpath = `${base}.relations.${name}`;
      const link = throughRelation(model, entityName, name)!;
      if ("problem" in link) error("M014", `relation ${name}: ${link.problem}`, rpath);
      if (fieldNames.has(name) || ownRelationNames.has(name))
        error(
          "M015",
          `relation ${name} is already a field or a relation of ${entityName}; give it another name`,
          rpath
        );
    }
    const archive = archiveOf(entity);
    if (archive) {
      const apath = `${base}.archive`;
      const field = entity.fields[archive.field];
      if (
        !field ||
        field.type !== "datetime" ||
        field.required ||
        field.primary ||
        field.unique ||
        field.hidden ||
        field.default !== undefined ||
        !field.read_only
      )
        error(
          "M150",
          `archive field ${archive.field} must be a nullable datetime with read_only: true and no default: the server sets it when a row is archived and clears it when it is restored`,
          apath
        );
      if (archive.rule) checkRule(archive.rule, entityName, `${apath}.rule`, true);
      const tenancy = model.auth?.tenancy;
      const special =
        entityName === model.auth?.identity
          ? "the identity: an archived user leaves the lists but still signs in and keeps its sessions"
          : entityName === tenancy?.entity
            ? `the tenant: an archived ${entityName} leaves the lists, while its memberships and the rows under it stay as they are`
            : entityName === tenancy?.membership
              ? "the membership: an archived membership leaves the lists but still makes its user a member"
              : undefined;
      if (special) warn("M152", `${entityName} is ${special}; archive only takes rows out of lists`, apath);
    }
    for (const [fieldName, field] of Object.entries(entity.fields)) {
      if (!field.count_of) continue;
      const fpath = `${base}.fields.${fieldName}`;
      const link = countLink(model, entityName, field)!;
      if ("problem" in link) {
        error("M153", `count_of ${link.problem}`, `${fpath}.count_of`);
        continue;
      }
      if (primaries.length > 1 || (primaries.length === 0 && !entity.fields.id))
        error(
          "M153",
          `${entityName} has a count_of field, so it needs a single-column primary key (an id) for the database to find the row a count belongs to`,
          `${fpath}.count_of`
        );
      const counted = model.entities[link.entity];
      for (const condition of link.where) {
        const tested = counted.fields[condition.field];
        if (!tested) {
          error("M154", `where names ${condition.field}, which is not a field of ${link.entity}`, `${fpath}.where`);
          continue;
        }
        if (tested.type === "bytes" || tested.type === "file")
          error(
            "M154",
            `where cannot compare ${link.entity}.${condition.field}: it is a ${tested.type}`,
            `${fpath}.where`
          );
        const problem = conditionProblem(tested, condition.value);
        if (problem)
          error(
            "M154",
            `where compares ${link.entity}.${condition.field} with ${condition.value}, which ${problem}`,
            `${fpath}.where`
          );
      }
      if (field.read_only === false || field.required === false)
        warn(
          "M155",
          `${fieldName} is a count: it is never null and never accepted from a client, whatever read_only and required say; drop them`,
          fpath
        );
      const tenants = tenantLinks(model).links;
      if (isolated(model) && tenants[link.entity] && !tenants[entityName])
        warn(
          "M156",
          `${entityName} is shared by every ${model.auth!.tenancy!.entity} while ${link.entity} rows belong to one: ${fieldName} adds up the rows of all of them, and whoever reads a ${entityName} reads that number`,
          fpath
        );
    }
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
        if (tenancy.isolation === "database") checkIsolation(tenancy.entity, tenant);
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
    if (archiveOf(entity) && (resource.list?.filters ?? []).includes(ARCHIVED_PARAM))
      error(
        "M157",
        `${resource.entity} archives, so the list parameter ${ARCHIVED_PARAM} is the compiler's (?${ARCHIVED_PARAM}=true answers the archived rows); drop the field ${ARCHIVED_PARAM} from list.filters or rename it`,
        `${base}.list.filters`
      );
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
        else if (entity.fields[f].position)
          error(
            "M064",
            `${key} field ${f} is a position: the server numbers it and ${resourceName}.move changes it; drop it from ${key}.fields`,
            `${base}.${key}.fields`
          );
        else if (entity.fields[f].count_of)
          error(
            "M064",
            `${key} field ${f} is a count: the database keeps it; drop it from ${key}.fields`,
            `${base}.${key}.fields`
          );
        else if (entity.fields[f].read_only)
          error(
            "M064",
            `${key} field ${f} is read_only: only server code sets it; drop it from ${key}.fields or the read_only`,
            `${base}.${key}.fields`
          );
        else if (key === "update" && positionOf(entity)?.within === f)
          error(
            "M144",
            `update field ${f} is what ${resource.entity} is ordered within: a row keeps its parent; delete it and create it under the other one`,
            `${base}.update.fields`
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
      if (actionName === MOVE_ACTION && positionOf(entity))
        error(
          "M143",
          `${resource.entity} has a position field, so ${resourceName}.move is the compiler's: it takes { to } under the update rule; give your action another name`,
          apath
        );
      if ((ARCHIVE_ACTIONS as readonly string[]).includes(actionName) && archiveOf(entity))
        error(
          "M151",
          archiveNameClash(resourceName, resource.entity, archiveOf(entity)!.field, "action", actionName),
          apath
        );
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
      else if (!resource.actions?.[m[4]] && !isArchiveAction(model, resource, m[4]))
        error(
          "M061",
          m[4] === MOVE_ACTION && hasMoveAction(model, resource)
            ? `${m[3]}.move is the compiler's reorder and emits no event; a handler on ${resource.entity}.updated sees the row after it`
            : `resource ${m[3]} has no action ${m[4]}`,
          `events[${i}]`
        );
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
    const [runResource, runName] = timer.run.split(".");
    if (!target && model.resources[runResource] && isArchiveAction(model, model.resources[runResource], runName))
      error(
        "M133",
        `run ${timer.run} is the compiler's ${runName}, which a timer cannot run yet; declare a row action whose handler sets ${archiveOf(model.entities[model.resources[runResource].entity])!.field} and run that`,
        `${tpath}.run`
      );
    else if (!target || !target.resource || (target.action.scope ?? "row") !== "row" || resourceEntity !== timer.on)
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
          // The archive parameter of the list: `archived: true` shows or counts the archived rows instead
          if (key === ARCHIVED_PARAM && archiveOf(entity) && !(resource.list?.filters ?? []).includes(key)) {
            if (typeof value !== "boolean") error("M089", `filter ${key} must be true or false`, where);
            continue;
          }
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
          if (!field && entity.relations?.[f]) {
            // A relation through a junction shows the far rows' names, which the operation has to include
            const op = key === "columns" ? "list" : "get";
            if (!(resource[op]?.include ?? []).includes(f))
              error(
                "M083",
                `${key} names the relation ${f}, which ${page.resource}.${op} does not include; add it to ${op}.include`,
                `${base}.${key}`
              );
            continue;
          }
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
  if (name === MOVE_ACTION && hasMoveAction(model, resource)) return { kind: "action", resource: ns, action: name };
  if (isArchiveAction(model, resource, name)) return { kind: "action", resource: ns, action: name };
  return { kind: "unknown", reason: `resource ${ns} has no operation or action ${name}` };
}

/** The row action the compiler writes on a resource over an entity with a position field */
export const MOVE_ACTION = "move";

/** Whether a resource has the compiler's `move` action: its entity has a position field and its update rule is not none */
export function hasMoveAction(model: Model, resource: Resource): boolean {
  const entity = model.entities[resource.entity];
  return Boolean(positionOf(entity)) && entity.rules?.update !== "none";
}

/**
 * Whether `name` is one of the compiler's `archive` and `restore` on a resource: its entity archives, and the rule
 * they run under (the archive's own, else the entity's update rule) is not none.
 */
export function isArchiveAction(model: Model, resource: Resource, name: string): boolean {
  if (!(ARCHIVE_ACTIONS as readonly string[]).includes(name)) return false;
  const entity = model.entities[resource.entity];
  const archive = archiveOf(entity);
  return Boolean(archive) && (archive!.rule ?? entity.rules?.update) !== "none";
}

/**
 * What a declared name is told when an entity's `archive:` already took it. Written for an action today; a
 * transition named `archive` or `restore` (state machines) clashes the same way and gets the same sentence.
 */
export function archiveNameClash(
  resourceName: string,
  entityName: string,
  field: string,
  what: "action" | "transition",
  name: string
): string {
  return `${entityName} has archive:, so ${resourceName}.archive and ${resourceName}.restore are the compiler's: they set and clear ${field} and answer 409 when there is nothing to do. Give your ${what} another name than ${name}, or drop archive: from ${entityName} if this ${what} is how its rows are archived`;
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
/** The relations an include may name: those of the entity's fields, the reverse sides, and the ones through a junction */
export function relationNamesOf(model: Model, entityName: string): string[] {
  const entity = model.entities[entityName];
  return [...fieldRelationNamesOf(model, entityName), ...Object.keys(entity?.relations ?? {})];
}

/** The relations that come from relation fields: forward ones on the entity, reverse ones declared on others */
function fieldRelationNamesOf(model: Model, entityName: string): string[] {
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
