/**
 * Common type definitions for IR schemas
 * These represent resolved, normalized field types
 * Version: 1.0.0
 */

import { z } from "zod";

export const ScalarTypeIR = z
  .object({
    kind: z.literal("Scalar"),
    scalar: z.enum([
      "String",
      "Text",
      "Int",
      "BigInt",
      "Float",
      "Decimal",
      "Boolean",
      "DateTime",
      "Date",
      "Time",
      "UUID",
      "Bytes"
    ])
  })
  .strict();

export type ScalarTypeIR = z.infer<typeof ScalarTypeIR>;

export const EnumTypeIR = z
  .object({
    kind: z.literal("Enum"),
    /** Enum type name, e.g. "IssueStatus" */
    name: z.string().min(1),
    /** Enum values, e.g. ["backlog","todo","in_progress","done"] */
    values: z.array(z.string().min(1)).min(1),
    /** Where the enum is defined */
    source: z.enum(["Inline", "Shared"])
  })
  .strict();

export type EnumTypeIR = z.infer<typeof EnumTypeIR>;

export const ReverseRelationIR = z
  .object({
    enabled: z.boolean(),
    fieldName: z.string().min(1),
    cardinality: z.enum(["One", "Many"])
  })
  .strict();

export type ReverseRelationIR = z.infer<typeof ReverseRelationIR>;

export const ReferenceTypeIR = z
  .object({
    kind: z.literal("Reference"),
    /** Target entity logical name, e.g. "User" */
    targetEntity: z.string().min(1),
    /** Target field; defaults to target PK if omitted */
    targetField: z.string().optional(),
    /** Cardinality from this side */
    cardinality: z.enum(["One", "Many"]),
    /** Whether this reference can be null */
    nullable: z.boolean(),
    /** Semantic relation name, e.g. "assignee" */
    relationName: z.string().optional(),
    /** Deletion behavior */
    onDelete: z.enum(["Restrict", "Cascade", "SetNull"]).optional(),
    /** Reverse relation configuration */
    reverse: ReverseRelationIR.optional()
  })
  .strict();

export type ReferenceTypeIR = z.infer<typeof ReferenceTypeIR>;

/**
 * JSON/blob field.
 * Optional schemaRef may reference an external JSON schema.
 */
export const JsonTypeIR = z
  .object({
    kind: z.literal("Json"),
    schemaRef: z.string().optional()
  })
  .strict();

export type JsonTypeIR = z.infer<typeof JsonTypeIR>;

/**
 * Array field type
 */
export const ArrayTypeIR = z
  .object({
    kind: z.literal("Array"),
    /** Element type of the array */
    elementType: z.enum(["String", "Text", "Int", "BigInt", "Float", "Decimal", "Boolean", "UUID"])
  })
  .strict();

export type ArrayTypeIR = z.infer<typeof ArrayTypeIR>;

/**
 * All supported field types in IR v1.
 */
export const FieldTypeIR = z.union([ScalarTypeIR, EnumTypeIR, ReferenceTypeIR, JsonTypeIR, ArrayTypeIR]);

export type FieldTypeIR = z.infer<typeof FieldTypeIR>;

/**
 * Default value semantics.
 */
export const DefaultValueIR = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("Literal"),
      value: z.union([z.string(), z.number(), z.boolean()])
    })
    .strict(),
  z.object({ kind: z.literal("Now") }).strict(),
  z.object({ kind: z.literal("UUIDv4") }).strict(),
  z.object({ kind: z.literal("AutoIncrement") }).strict()
]);

export type DefaultValueIR = z.infer<typeof DefaultValueIR>;

/**
 * Generated value semantics (beyond defaults).
 */
export const GeneratedIR = z
  .object({
    strategy: z.enum(["AutoIncrement", "UUID", "Timestamp", "Custom"]),
    /** Optional expression for custom/generated values */
    expr: z.string().optional()
  })
  .strict();

export type GeneratedIR = z.infer<typeof GeneratedIR>;

/**
 * Validation hints for higher-level tooling / packs.
 */
export const ValidationIR = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("MinLength"),
      min: z.number().int().nonnegative()
    })
    .strict(),
  z.object({ kind: z.literal("MaxLength"), max: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("Pattern"), regex: z.string() }).strict(),
  z.object({ kind: z.literal("Min"), min: z.number() }).strict(),
  z.object({ kind: z.literal("Max"), max: z.number() }).strict()
]);

export type ValidationIR = z.infer<typeof ValidationIR>;
