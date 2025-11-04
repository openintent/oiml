import { z } from "zod";

export const ForeignKey = z.object({
  /** Source-side FK details (local entity) */
  local_field: z.string().min(1), // e.g., "customerId"
  /** Target-side PK/UK field name */
  target_field: z.string().min(1), // e.g., "id"
  /** Optional explicit constraint name; adapters may derive if absent */
  constraint_name: z.string().optional()
});
export type ForeignKey = z.infer<typeof ForeignKey>;

/** Field types supported by initial OpenIntent spec */
export const FieldType = z.enum([
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
  "bytes"
]);
export type FieldType = z.infer<typeof FieldType>;

/**
 * Optional, portable field attributes that map to provider-specific syntax.
 * (Adapters may ignore unknown attributes without failing.)
 */
export const FieldAttribute = z.object({
  name: z.enum([
    "indexed",
    "unique",
    "nullable",
    "optional",
    "default_now",
    "id",
    "primary",
    "auto_increment",
    "updated_at",
    "foreign_key" // semantic hint; FK details live below
  ]),
  args: z.record(z.any()).optional()
});

export const RelationKind = z.enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"]);

/** Reverse side declaration */
export const ReverseRelation = z.object({
  enabled: z.boolean().default(true),
  field_name: z.string().min(1), // e.g., "orders"
  /** Reverse kind must be the logical inverse (validated below) */
  kind: RelationKind.optional(),
  attributes: z.array(FieldAttribute).default([])
});

/** Simplified relation for field-level relations (used in add_field) */
export const FieldRelation = z.object({
  /** The target entity we relate to */
  target_entity: z.string().min(1), // e.g., "Customer"

  /** The relationship semantics from the source's perspective */
  kind: RelationKind, // e.g., "many_to_one"

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
});
export type FieldRelation = z.infer<typeof FieldRelation>;

export const FieldSpec = z
  .object({
    name: z.string().min(1),
    type: FieldType,
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    default: z.any().optional(),
    max_length: z.number().int().positive().optional(),
    array_type: z.enum(["string", "text", "integer", "bigint", "float", "decimal", "boolean", "uuid"]).optional(),
    enum_values: z.array(z.string()).optional(),
    api: z
      .object({
        include: z.boolean().describe("Whether to include this field in API endpoints"),
        endpoints: z
          .array(z.string())
          .optional()
          .describe(
            "Specific endpoints to include this field in. Can be: method + path (e.g., 'GET /api/customers'), just path (e.g., '/api/customers'), just method (e.g., 'GET'), or '*' for all endpoints. If omitted, applies to all endpoints for the entity."
          )
      })
      .optional()
      .describe("API endpoint configuration for this field"),
    /** Optional relation to attach to this field (for foreign key fields) */
    relation: FieldRelation.optional()
  })
  .refine(
    data => {
      // If type is "array", array_type must be specified
      if (data.type === "array" && !data.array_type) {
        return false;
      }
      // If type is not "array", array_type should not be specified
      if (data.type !== "array" && data.array_type) {
        return false;
      }
      // If type is "enum", enum_values must be specified
      if (data.type === "enum" && (!data.enum_values || data.enum_values.length === 0)) {
        return false;
      }
      // If type is not "enum", enum_values should not be specified
      if (data.type !== "enum" && data.enum_values) {
        return false;
      }
      return true;
    },
    {
      message: "array_type is required when type is 'array', and enum_values is required when type is 'enum'"
    }
  )
  // Validation: *_to_one relations should specify FK wiring
  .refine(
    data =>
      !data.relation || !["many_to_one", "one_to_one"].includes(data.relation.kind) || !!data.relation.foreign_key,
    {
      path: ["relation", "foreign_key"],
      message: "foreign_key is required for *_to_one relations"
    }
  )
  // Validation: reverse.kind (when provided) must be the logical inverse
  .refine(
    data => {
      if (!data.relation?.reverse?.kind) return true;
      const { kind, reverse } = data.relation;
      const inverseMap: Record<z.infer<typeof RelationKind>, z.infer<typeof RelationKind>> = {
        one_to_one: "one_to_one",
        many_to_one: "one_to_many",
        one_to_many: "many_to_one",
        many_to_many: "many_to_many"
      };
      return inverseMap[kind] === reverse.kind;
    },
    {
      path: ["relation", "reverse", "kind"],
      message: "reverse.kind must be the inverse of relation.kind"
    }
  );
export type FieldSpec = z.infer<typeof FieldSpec>;
