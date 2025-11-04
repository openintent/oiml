import { z } from "zod";
import { ISODate, OIMLVersion } from "../util";
import { FieldSpec,FieldAttribute, ForeignKey, RelationKind, ReverseRelation } from "../data";

/** Provenance block (optional but recommended) */
export const Provenance = z
  .object({
    created_by: z
      .object({
        type: z.enum(["human", "agent", "system"]).default("human"),
        name: z.string().optional(),
        id: z.string().optional()
      })
      .optional(),
    created_at: ISODate.optional(),
    source: z.string().optional(), // e.g., "builder-ui", "api"
    model: z.string().optional() // e.g., model name if generated
  })
  .strict();

/** AI Context block (optional, for AI agent instructions) */
export const AIContext = z
  .object({
    purpose: z.string().optional().describe("Purpose or context for the AI agent"),
    instructions: z.string().optional().describe("Instructions for the AI agent (multiline string)"),
    references: z
      .array(
        z.object({
          kind: z.enum(["file"]).describe("Type of reference"),
          path: z.string().describe("Path to the referenced resource")
        })
      )
      .optional()
      .describe("References to external resources (e.g., documentation files)")
  })
  .strict();

/** ---- Intent Kinds ---- */
export const Intent_AddEntity = z
  .object({
    kind: z.literal("add_entity"),
    scope: z.literal("data"),
    entity: z.string().min(1),
    fields: z.array(FieldSpec).min(1)
  })
  .strict();

export const Intent_AddField = z
  .object({
    kind: z.literal("add_field"),
    scope: z.literal("data"),
    entity: z.string().min(1),
    fields: z.array(FieldSpec).min(1)
  })
  .strict();

export const Intent_RemoveField = z
  .object({
    kind: z.literal("remove_field"),
    scope: z.literal("data"),
    entity: z.string().min(1),
    fields: z.array(z.string().min(1)).min(1).describe("Array of field names to remove from the entity")
  })
  .strict();

export const Intent_AddEndpoint = z
  .object({
    kind: z.literal("add_endpoint"),
    scope: z.literal("api"),
    method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
    path: z.string().regex(/^\//, "must start with '/'"),
    description: z.string().optional(),
    entity: z.string().optional(),
    fields: z.array(FieldSpec).optional(),
    auth: z
      .object({
        required: z.boolean().default(false),
        roles: z.array(z.string()).optional()
      })
      .optional()
  })
  .strict();

export const Intent_AddComponent = z
  .object({
    kind: z.literal("add_component"),
    scope: z.literal("ui"),
    component: z.string().min(1), // file/component name (no extension)
    template: z.enum(["List", "Form", "Custom"]).default("Custom"),
    entity: z.string().optional(),
    display_fields: z.array(z.string()).optional(),
    route: z.string().optional() // optional page route
  })
  .strict();

/** Future extension slot: vendor or project-specific intents under namespaced key */
export const Intent_Extension = z
  .object({
    kind: z.string().regex(/^x-[a-z0-9_.-]+$/),
    scope: z.string(),
    payload: z.record(z.any())
  })
  .strict();

/** Core payload for add_relation */
export const Intent_AddRelation = z
  .object({
    kind: z.literal("add_relation"),
    scope: z.literal("schema"),

    relation: z.object({
      /** Where we are adding the relation field */
      source_entity: z.string().min(1), // e.g., "Order"
      /** The target entity we relate to */
      target_entity: z.string().min(1), // e.g., "Customer"

      /** The relationship semantics from the source's perspective */
      kind: RelationKind, // e.g., "many_to_one"

      /** Name of the relation field on the source entity */
      field_name: z.string().min(1), // e.g., "customer"

      /** Optional scalar FK wiring (required for *_to_one kinds) */
      foreign_key: ForeignKey.optional(),

      /** Source field-level attributes (indexing, nullable, etc.) */
      attributes: z.array(FieldAttribute).default([]),

      /**
       * Reverse/virtual side declaration (optional). If omitted, adapters may:
       *  - add nothing, or
       *  - synthesize a conventional name if project policy says so.
       */
      reverse: ReverseRelation.optional(),

      /**
       * Emit migrations/artifacts (true in prod/CI), or patch schema only (dev).
       * Adapters should respect this flag per provider.
       */
      emit_migration: z.boolean().default(true)
    })
  })
  // Validation: *_to_one relations should specify FK wiring
  .refine(
    i => {
      const kind = i.relation.kind as z.infer<typeof RelationKind>;
      return !["many_to_one", "one_to_one"].includes(kind) || !!i.relation.foreign_key;
    },
    {
      path: ["relation", "foreign_key"],
      message: "foreign_key is required for *_to_one relations"
    }
  )
  // Validation: reverse.kind (when provided) must be the logical inverse
  .refine(
    i => {
      const kind = i.relation.kind as z.infer<typeof RelationKind>;
      const reverse = i.relation.reverse;
      if (!reverse?.kind) return true;
      const reverseKind = reverse.kind as z.infer<typeof RelationKind>;
      const inverseMap: Record<z.infer<typeof RelationKind>, z.infer<typeof RelationKind>> = {
        one_to_one: "one_to_one",
        many_to_one: "one_to_many",
        one_to_many: "many_to_one",
        many_to_many: "many_to_many"
      };
      return inverseMap[kind] === reverseKind;
    },
    {
      path: ["relation", "reverse", "kind"],
      message: "reverse.kind must be the inverse of relation.kind"
    }
  );

export const Intent = z.union([
  Intent_AddEntity,
  Intent_AddField,
  Intent_RemoveField,
  Intent_AddEndpoint,
  Intent_AddComponent,
  Intent_AddRelation
]);

/** Top-level document */
export const IntentDoc = z
  .object({
    version: OIMLVersion.describe("OIML schema version"),
    ai_context: AIContext.optional(),
    provenance: Provenance.optional(),
    intents: z.array(Intent).min(1)
  })
  .strict();
export type IntentDoc = z.infer<typeof IntentDoc>;

/** Helper types */
export type Intent_AddEntity = z.infer<typeof Intent_AddEntity>;
export type Intent_AddField = z.infer<typeof Intent_AddField>;
export type Intent_RemoveField = z.infer<typeof Intent_RemoveField>;
export type Intent_AddEndpoint = z.infer<typeof Intent_AddEndpoint>;
export type Intent_AddComponent = z.infer<typeof Intent_AddComponent>;
export type Intent_AddRelation = z.infer<typeof Intent_AddRelation>;
