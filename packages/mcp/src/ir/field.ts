/**
 * Field IR definitions
 * Version: 1.0.0
 */

import { z } from "zod";
import { FieldTypeIR, DefaultValueIR, GeneratedIR, ValidationIR } from "./types.js";

/**
 * API configuration for a field
 */
export const FieldAPIConfigIR = z
  .object({
    /** Whether to include this field in API responses */
    include: z.boolean(),
    /** Specific endpoints to include/exclude this field in */
    endpoints: z.array(z.string()).optional()
  })
  .strict();

export type FieldAPIConfigIR = z.infer<typeof FieldAPIConfigIR>;

/**
 * Resolved field definition.
 */
export const FieldIRV1 = z
  .object({
    /** Field name, e.g. "title" */
    name: z.string().min(1),
    /** Resolved type */
    type: FieldTypeIR,
    /** Whether the DB column is nullable */
    nullable: z.boolean(),
    /** Whether a unique constraint is required */
    unique: z.boolean().optional(),
    /** Whether this is a primary key field */
    isPrimary: z.boolean().optional(),
    /** Default value, if any */
    default: DefaultValueIR.optional(),
    /** Generated behavior (autoincrement, UUID, etc.) */
    generated: GeneratedIR.optional(),
    /** Validation hints (length, pattern, etc.) */
    validations: z.array(ValidationIR).optional(),
    /** API configuration */
    api: FieldAPIConfigIR.optional(),
    /** Docs / tags */
    description: z.string().optional(),
    tags: z.array(z.string()).optional()
  })
  .strict();

export type FieldIRV1 = z.infer<typeof FieldIRV1>;
