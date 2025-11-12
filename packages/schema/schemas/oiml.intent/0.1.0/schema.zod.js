/**
 * Open Intent Modeling Language (OIML) Intent Schema - Zod Export
 * Version: 0.1.0
 * 
 * This file provides Zod schema definitions for validation engines that use Zod.
 * For JSON Schema validation, use schema.json instead.
 */

import { z } from "zod";

// Utility schemas
export const OIMLVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "semver required");
export const ISODate = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, "ISO8601 UTC required");

// Field type definitions
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
    "foreign_key"
  ]),
  args: z.record(z.any()).optional()
});

export const ForeignKey = z.object({
  local_field: z.string().min(1),
  target_field: z.string().min(1),
  constraint_name: z.string().optional()
});

export const RelationKind = z.enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"]);

export const ReverseRelation = z.object({
  enabled: z.boolean().default(true),
  field_name: z.string().min(1),
  kind: RelationKind.optional(),
  attributes: z.array(FieldAttribute).default([])
});

export const FieldRelation = z.object({
  target_entity: z.string().min(1),
  kind: RelationKind,
  foreign_key: ForeignKey.optional(),
  attributes: z.array(FieldAttribute).default([]),
  reverse: ReverseRelation.optional(),
  emit_migration: z.boolean().default(true)
});

export const Field = z
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
          .describe("Specific endpoints to include this field in")
      })
      .optional()
      .describe("API endpoint configuration for this field"),
    relation: FieldRelation.optional()
  })
  .refine(
    data => {
      if (data.type === "array" && !data.array_type) return false;
      if (data.type !== "array" && data.array_type) return false;
      if (data.type === "enum" && (!data.enum_values || data.enum_values.length === 0)) return false;
      if (data.type !== "enum" && data.enum_values) return false;
      return true;
    },
    {
      message: "array_type is required when type is 'array', and enum_values is required when type is 'enum'"
    }
  )
  .refine(
    data =>
      !data.relation || !["many_to_one", "one_to_one"].includes(data.relation.kind) || !!data.relation.foreign_key,
    {
      path: ["relation", "foreign_key"],
      message: "foreign_key is required for *_to_one relations"
    }
  )
  .refine(
    data => {
      if (!data.relation?.reverse?.kind) return true;
      const { kind, reverse } = data.relation;
      const inverseMap = {
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

// Provenance block
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
    source: z.string().optional(),
    model: z.string().optional()
  })
  .strict();

// AI Context block
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
      .describe("References to external resources")
  })
  .strict();

// Intent definitions
export const AddEntity = z
  .object({
    kind: z.literal("add_entity"),
    scope: z.literal("data"),
    entity: z.string().min(1),
    fields: z.array(Field).min(1)
  })
  .strict();

export const AddField = z
  .object({
    kind: z.literal("add_field"),
    scope: z.literal("data"),
    entity: z.string().min(1),
    fields: z.array(Field).min(1)
  })
  .strict();

export const RemoveField = z
  .object({
    kind: z.literal("remove_field"),
    scope: z.literal("data"),
    entity: z.string().min(1),
    fields: z.array(z.string().min(1)).min(1).describe("Array of field names to remove from the entity")
  })
  .strict();

export const AddRelation = z
  .object({
    kind: z.literal("add_relation"),
    scope: z.literal("data"),
    relation: z.object({
      source_entity: z.string().min(1),
      target_entity: z.string().min(1),
      kind: RelationKind,
      field_name: z.string().min(1),
      foreign_key: ForeignKey.optional(),
      attributes: z.array(FieldAttribute).default([]),
      reverse: ReverseRelation.optional(),
      emit_migration: z.boolean().default(true)
    })
  })
  .refine(
    i => {
      const kind = i.relation.kind;
      return !["many_to_one", "one_to_one"].includes(kind) || !!i.relation.foreign_key;
    },
    {
      path: ["relation", "foreign_key"],
      message: "foreign_key is required for *_to_one relations"
    }
  )
  .refine(
    i => {
      const kind = i.relation.kind;
      const reverse = i.relation.reverse;
      if (!reverse?.kind) return true;
      const reverseKind = reverse.kind;
      const inverseMap = {
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

export const AddEndpoint = z
  .object({
    kind: z.literal("add_endpoint"),
    scope: z.literal("api"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().regex(/^\//, "must start with '/'"),
    description: z.string().optional(),
    entity: z.string().optional(),
    fields: z.array(Field).optional(),
    auth: z
      .object({
        required: z.boolean().default(false),
        roles: z.array(z.string()).optional()
      })
      .optional()
  })
  .strict();

export const AddComponent = z
  .object({
    kind: z.literal("add_component"),
    scope: z.literal("ui"),
    component: z.string().min(1),
    template: z.enum(["List", "Form", "Custom"]).default("Custom"),
    entity: z.string().optional(),
    display_fields: z.array(z.string()).optional(),
    route: z.string().optional()
  })
  .strict();

const FieldSource = z
  .object({
    type: z.enum(["relation", "field", "computed"]).describe("Type of field source"),
    relation: z
      .string()
      .min(1)
      .optional()
      .describe("Relation name (required when type is 'relation')"),
    entity: z
      .string()
      .min(1)
      .optional()
      .describe("Entity name (required when type is 'field' or when selecting a field from a relation)"),
    field: z
      .string()
      .min(1)
      .optional()
      .describe("Field name to select (when type is 'field' or when selecting a specific field from a relation)"),
    join: z
      .object({
        foreign_key: z.string().min(1).describe("Foreign key field name to join on"),
        target_entity: z.string().min(1).describe("Target entity to join with"),
        target_field: z.string().min(1).describe("Target field to select from joined entity")
      })
      .optional()
      .describe("Join configuration for foreign key relationships")
  })
  .refine(
    data => {
      if (data.type === "relation") {
        return !!data.relation;
      }
      if (data.type === "field") {
        return !!data.entity && !!data.field;
      }
      return true;
    },
    {
      message: "relation is required when type is 'relation', entity and field are required when type is 'field'"
    }
  );

export const UpdateEndpoint = z
  .object({
    kind: z.literal("update_endpoint"),
    scope: z.literal("api"),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    path: z.string().regex(/^\//, "must start with '/'"),
    description: z.string().optional(),
    updates: z
      .object({
        add_field: z
          .array(
            z.object({
              name: z.string().min(1).describe("Name of the field in the response"),
              source: FieldSource.describe("Source configuration for the field")
            })
          )
          .optional()
          .describe("Fields to add to the endpoint response (relations, specific fields, or computed values)")
      })
      .strict()
      .refine(data => Object.keys(data).length > 0, {
        message: "updates object must have at least one property"
      })
      .describe("Object specifying what to update in the endpoint")
  })
  .strict();

export const AddCapability = z
  .object({
    kind: z.literal("add_capability"),
    scope: z.literal("capability"),
    capability: z.enum(["auth", "file_upload", "file_stream", "sse", "websocket"]).describe("Type of capability to add"),
    framework: z.string().min(1).describe("Target framework (e.g., 'gin', 'next', 'express')"),
    provider: z.string().min(1).optional().describe("Provider/library name (e.g., 'jwt', 'next-auth', 'passport')"),
    config: z.record(z.any()).optional().describe("Capability-specific configuration options"),
    endpoints: z
      .array(
        z.object({
          method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).optional(),
          path: z.string().regex(/^\//, "must start with '/'").optional(),
          description: z.string().optional(),
          group: z
            .string()
            .optional()
            .describe("Route group name (supports wildcard '*' to match all endpoints in a group, e.g., '/api/v1/*')")
        }).refine(
          (data) => {
            // Either group is provided (without method/path), OR both method and path are provided (without group)
            const hasGroup = !!data.group;
            const hasMethodAndPath = !!data.method && !!data.path;
            const hasMethodOrPath = !!data.method || !!data.path;
            
            // If group is provided, method and path must NOT be provided
            if (hasGroup && hasMethodOrPath) {
              return false;
            }
            
            // Either group alone, or method+path together
            return hasGroup || hasMethodAndPath;
          },
          {
            message: "Either 'group' must be provided alone, or both 'method' and 'path' must be provided together (but not both group and method/path)"
          }
        )
      )
      .optional()
      .describe("Additional endpoints to create for this capability")
  })
  .strict();

export const IntentUnion = z.union([
  AddEntity,
  AddField,
  RemoveField,
  AddEndpoint,
  AddComponent,
  AddRelation,
  UpdateEndpoint,
  AddCapability
]);

// Top-level document
export const Intent = z
  .object({
    $schema: z.string().optional().describe("JSON Schema reference URI"),
    type: z.literal("oiml.intent").optional().describe("Document type identifier"),
    version: OIMLVersion.describe("OIML schema version"),
    ai_context: AIContext.optional(),
    provenance: Provenance.optional(),
    intents: z.array(IntentUnion).min(1)
  })
  .strict();

